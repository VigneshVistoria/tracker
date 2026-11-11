import { Injectable } from '@nestjs/common';
import { GraphAuthService } from '../teams-integration/graph-auth.service';
import { GraphAttendanceRecord, GraphInstance, GraphReport, GraphSeries } from './meeting-attendance';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MAX_PAGES = 20;

export class MeetingGraphError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// C6 Stage 2 - READ-ONLY Microsoft Graph calls (GET only): an organiser's
// recurring Teams meetings, the held instances of one series, and their
// attendance reports. Needs Calendars.Read, OnlineMeetings.Read.All and
// OnlineMeetingArtifact.Read.All plus the Tracker-C6 Teams access policy
// for the organiser. Tests replace these methods; nothing else calls Graph
// for C6.
@Injectable()
export class MeetingGraphClient {
  constructor(private readonly graphAuth: GraphAuthService) {}

  private async get(path: string): Promise<any> {
    const token = await this.graphAuth.getAccessToken();
    const res = await fetch(path.startsWith('http') ? path : `${GRAPH_BASE}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new MeetingGraphError(`Microsoft Graph ${res.status} on ${path.split('?')[0].replace(GRAPH_BASE, '')}: ${text}`, res.status);
    }
    return res.json();
  }

  // Every page of a list (bounded).
  private async all(path: string): Promise<any[]> {
    const out: any[] = [];
    let next: string | null = path;
    for (let i = 0; next && i < MAX_PAGES; i++) {
      const page = await this.get(next);
      out.push(...(page.value ?? []));
      next = page['@odata.nextLink'] ?? null;
    }
    return out;
  }

  // The organiser's Microsoft 365 id, from their email.
  async userId(email: string): Promise<string> {
    const u = await this.get(`/users/${encodeURIComponent(email)}?$select=id`);
    return u.id;
  }

  // Recurring Teams meetings the person organises.
  async listSeries(aadUserId: string): Promise<GraphSeries[]> {
    const rows = await this.all(
      `/users/${aadUserId}/events?$filter=${encodeURIComponent("type eq 'seriesMaster'")}&$select=id,subject,type,isOnlineMeeting,isOrganizer,isCancelled,recurrence,start,end,onlineMeeting&$top=100`,
    );
    return rows
      .filter((e) => e.type === 'seriesMaster' && e.isOnlineMeeting && e.isOrganizer !== false && !e.isCancelled)
      .map((e) => ({
        seriesId: e.id,
        subject: String(e.subject ?? '').slice(0, 255),
        pattern: e.recurrence?.pattern ?? null,
        rangeEnd: e.recurrence?.range?.type === 'endDate' ? e.recurrence.range.endDate : null,
        startTime: utc(e.start?.dateTime),
        endTime: utc(e.end?.dateTime),
        joinUrl: e.onlineMeeting?.joinUrl ?? null,
      }));
  }

  // Instances of one series between two instants (cancelled ones included).
  async listInstances(aadUserId: string, seriesId: string, from: Date, to: Date): Promise<GraphInstance[]> {
    const rows = await this.all(
      `/users/${aadUserId}/events/${encodeURIComponent(seriesId)}/instances?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$select=id,subject,start,end,isCancelled,attendees,onlineMeeting&$top=100`,
    );
    return rows.map((e) => ({
      eventId: e.id,
      subject: String(e.subject ?? '').slice(0, 255),
      startAt: utc(e.start?.dateTime)!,
      endAt: utc(e.end?.dateTime)!,
      cancelled: !!e.isCancelled,
      joinUrl: e.onlineMeeting?.joinUrl ?? null,
      invitees: (e.attendees ?? [])
        .filter((a: any) => a.type !== 'resource' && a.emailAddress?.address)
        .map((a: any) => String(a.emailAddress.address).toLowerCase()),
    }));
  }

  // The Teams meeting behind a join link (null if Teams does not know it).
  async onlineMeetingId(aadUserId: string, joinUrl: string): Promise<string | null> {
    const filter = encodeURIComponent(`JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`);
    const page = await this.get(`/users/${aadUserId}/onlineMeetings?$filter=${filter}`);
    return page.value?.[0]?.id ?? null;
  }

  // Every attendance report of a Teams meeting (a recurring meeting has one
  // per time it was held).
  async listReports(aadUserId: string, meetingId: string): Promise<GraphReport[]> {
    const rows = await this.all(`/users/${aadUserId}/onlineMeetings/${encodeURIComponent(meetingId)}/attendanceReports`);
    return rows.map((r) => ({ reportId: r.id, startAt: new Date(r.meetingStartDateTime), endAt: new Date(r.meetingEndDateTime) }));
  }

  async listRecords(aadUserId: string, meetingId: string, reportId: string): Promise<GraphAttendanceRecord[]> {
    const rows = await this.all(
      `/users/${aadUserId}/onlineMeetings/${encodeURIComponent(meetingId)}/attendanceReports/${encodeURIComponent(reportId)}/attendanceRecords`,
    );
    return rows.map((r) => ({
      email: r.emailAddress ? String(r.emailAddress).toLowerCase() : null,
      totalSeconds: Number(r.totalAttendanceInSeconds ?? 0),
      intervals: (r.attendanceIntervals ?? []).map((i: any) => ({
        joinAt: i.joinDateTime ? new Date(i.joinDateTime) : null,
        leaveAt: i.leaveDateTime ? new Date(i.leaveDateTime) : null,
      })),
    }));
  }
}

// Graph event times come back in UTC (Prefer header) without a zone mark.
function utc(dateTime: string | undefined): Date | null {
  if (!dateTime) return null;
  return new Date(`${dateTime.slice(0, 19)}Z`);
}

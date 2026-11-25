import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { StorageService } from '../storage/storage.service';
import { cleanFileName, detectAttachmentType } from '../client-portal/attachment-types';
import { SrsDocument } from './entities/srs-document.entity';
import { SrsClientItem } from './entities/srs-client-item.entity';
import { SrsClientItemStory } from './entities/srs-client-item-story.entity';
import { REQUIREMENTS_AUDIT, RESOLUTION_MIN, canCloseClientItems, canRecordClientSignOff, canTakeClientSignOff, canWrite, minTextProblem } from './requirements';
import { RequirementsService, dateOnly } from './requirements.service';
import { ClientSignOffDto, CloseClientItemDto, CreateClientItemDto, UpdateClientItemDto } from './dto/requirements.dto';

// Requirements traceability Stage 2 - client sign-off of an SRS (PM only,
// with the signed document) and the SRS's open client items (BA/PM/Admin
// create and edit, PM/Admin close). An open item blocks its stories.
export const SRS_FILES_BUCKET = 'srs-documents';
export const SIGNED_DOC_MAX_BYTES = 10 * 1024 * 1024;
// PDF, images, Word - checked by content, not just the file name.
export const SIGNED_DOC_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export interface UploadedSrsFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class RequirementsClientService {
  constructor(
    private requirements: RequirementsService,
    private dataSource: DataSource,
    private auditLogService: AuditLogService,
    private storage: StorageService,
  ) {}

  private audit(em: EntityManager, user: User, tenantId: number, action: string, entityType: string, entityId: number, details: Record<string, unknown>) {
    return this.auditLogService.recordWithin(em, { userId: user.id, userEmail: user.email, userRole: user.role, action, tenantId, entityType, entityId, details });
  }

  private async visibleSrs(srsId: number, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    return this.requirements.loadVisibleSrs(srsId, user, tenantId);
  }

  // ---- client sign-off ----

  async recordClientSignOff(srsId: number, dto: ClientSignOffDto, file: UploadedSrsFile | undefined, user: User, tenantId: number) {
    const srs = await this.visibleSrs(srsId, user, tenantId);
    if (!canRecordClientSignOff(user.role)) throw new ForbiddenException('Only a Program Manager can record the client sign-off.');
    if (srs.status === 'client_signed_off') throw new ConflictException('This SRS is already signed off by the client.');
    if (!canTakeClientSignOff(srs.status)) throw new BadRequestException('Client sign-off can be recorded only while the SRS is In review or Signed off.');
    const signedOn = dto.signedOn;
    const d = new Date(`${signedOn}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== signedOn) throw new BadRequestException('The sign-off date is not a real date.');
    if (d.getTime() > Date.now() + 24 * 3600 * 1000) throw new BadRequestException('The sign-off date cannot be in the future.');
    if (!file || !file.buffer?.length) throw new BadRequestException('Attach the signed document.');
    if (file.size > SIGNED_DOC_MAX_BYTES || file.buffer.length > SIGNED_DOC_MAX_BYTES) throw new BadRequestException('The signed document can be at most 10 MB.');
    const fileName = cleanFileName(file.originalname);
    const mime = detectAttachmentType(fileName, file.buffer);
    if (!mime || !SIGNED_DOC_TYPES.includes(mime)) throw new BadRequestException('The signed document must be a PDF, PNG, JPEG or Word (.docx) file.');
    const ext = fileName.toLowerCase().split('.').pop();
    const key = `tenant-${tenantId}/srs-${srs.id}/client-sign-off-${Date.now()}.${ext}`;
    await this.storage.put(SRS_FILES_BUCKET, key, file.buffer, mime);
    const now = new Date();
    try {
      return await this.dataSource.transaction(async (em) => {
        const [row] = await em.query(`SELECT status FROM srs_documents WHERE id = $1 FOR UPDATE`, [srs.id]);
        if (!canTakeClientSignOff(row.status)) throw new ConflictException('The SRS changed meanwhile - reload and try again.');
        await em.update(SrsDocument, { id: srs.id }, {
          status: 'client_signed_off',
          clientName: dto.clientName.trim(),
          clientSignedOn: signedOn,
          clientFileKey: key,
          clientFileName: fileName,
          clientFileMime: mime,
          clientFileSize: file.buffer.length,
          clientSignedByUserId: user.id,
          clientSignedAt: now,
          updatedAt: now,
        });
        await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.CLIENT_SIGNED_OFF, 'SrsDocument', srs.id, {
          name: srs.name,
          version: srs.version,
          statusBefore: row.status,
          clientName: dto.clientName.trim(),
          signedOn,
          file: fileName,
          size: file.buffer.length,
        });
        return { id: srs.id, status: 'client_signed_off' };
      });
    } catch (err) {
      await this.storage.remove(SRS_FILES_BUCKET, key).catch(() => undefined);
      throw err;
    }
  }

  async clientSignOffFile(srsId: number, user: User, tenantId: number) {
    const srs = await this.visibleSrs(srsId, user, tenantId);
    if (!srs.clientFileKey) throw new NotFoundException('No signed document on this SRS.');
    const data = await this.storage.get(SRS_FILES_BUCKET, srs.clientFileKey);
    return { data, fileName: srs.clientFileName!, mimeType: srs.clientFileMime! };
  }

  // ---- client items ----

  async listClientItems(srsId: number, user: User, tenantId: number) {
    const srs = await this.visibleSrs(srsId, user, tenantId);
    const items = await this.dataSource.query(
      `SELECT i.id, i.number, i.question, i.baseline, i.owner, i.status, i.resolution, i."closedAt", i."createdAt",
              cu."fullName" AS "closedBy",
              COALESCE(json_agg(json_build_object('id', s.id, 'code', s.code, 'title', s.title) ORDER BY s."sortOrder") FILTER (WHERE s.id IS NOT NULL), '[]') AS stories
         FROM srs_client_items i
         LEFT JOIN users cu ON cu.id = i."closedByUserId"
         LEFT JOIN srs_client_item_stories l ON l."itemId" = i.id
         LEFT JOIN srs_stories s ON s.id = l."storyId" AND s."deletedAt" IS NULL
        WHERE i."srsId" = $1 AND i."deletedAt" IS NULL
        GROUP BY i.id, cu."fullName" ORDER BY i.number`,
      [srs.id],
    );
    return {
      srs: { id: srs.id, name: srs.name, version: srs.version, status: srs.status, issuedOn: dateOnly(srs.issuedOn) },
      items,
      permissions: { canWrite: canWrite(user.role), canClose: canCloseClientItems(user.role) },
    };
  }

  private async checkStories(em: EntityManager, srsId: number, ids: number[]): Promise<number[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const found = await em.query(`SELECT id FROM srs_stories WHERE "srsId" = $1 AND id = ANY($2) AND "deletedAt" IS NULL`, [srsId, unique]);
    if (found.length !== unique.length) throw new BadRequestException('Some stories are not in this SRS.');
    return unique;
  }

  private async storyCodes(em: EntityManager, ids: number[]): Promise<string[]> {
    if (!ids.length) return [];
    return (await em.query(`SELECT code FROM srs_stories WHERE id = ANY($1) ORDER BY "sortOrder"`, [ids])).map((r: any) => r.code);
  }

  async createClientItem(srsId: number, dto: CreateClientItemDto, user: User, tenantId: number) {
    const srs = await this.visibleSrs(srsId, user, tenantId);
    if (!canWrite(user.role)) throw new ForbiddenException('Only BA, Program Manager or Admin can add client items.');
    const now = new Date();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT id FROM srs_documents WHERE id = $1 FOR UPDATE`, [srs.id]);
      const storyIds = await this.checkStories(em, srs.id, dto.storyIds ?? []);
      // Numbers are never reused (deleted items count too).
      const [{ max }] = await em.query(`SELECT COALESCE(max(number), 0)::int AS max FROM srs_client_items WHERE "srsId" = $1`, [srs.id]);
      const item = await em.save(
        em.create(SrsClientItem, {
          tenantId,
          srsId: srs.id,
          number: max + 1,
          question: dto.question.trim(),
          baseline: dto.baseline?.trim() || null,
          owner: dto.owner?.trim() || null,
          status: 'open',
          createdByUserId: user.id,
          createdAt: now,
          updatedAt: now,
        }),
      );
      if (storyIds.length) await em.insert(SrsClientItemStory, storyIds.map((storyId) => ({ itemId: item.id, storyId })));
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.CLIENT_ITEM_CREATED, 'SrsClientItem', item.id, {
        srsId: srs.id,
        number: item.number,
        question: item.question,
        stories: await this.storyCodes(em, storyIds),
      });
      return { id: item.id, number: item.number };
    });
  }

  private async liveItem(em: EntityManager, itemId: number, tenantId: number) {
    const item = await em.findOne(SrsClientItem, { where: { id: itemId, tenantId, deletedAt: IsNull() } });
    if (!item) throw new NotFoundException('Client item not found.');
    return item;
  }

  async updateClientItem(itemId: number, dto: UpdateClientItemDto, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    if (!canWrite(user.role)) throw new ForbiddenException('Only BA, Program Manager or Admin can change client items.');
    return this.dataSource.transaction(async (em) => {
      const item = await this.liveItem(em, itemId, tenantId);
      await this.requirements.loadVisibleSrs(item.srsId, user, tenantId);
      if (item.status !== 'open') throw new BadRequestException('A closed client item cannot be changed.');
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const patch: Partial<SrsClientItem> = {};
      for (const k of ['question', 'baseline', 'owner'] as const) {
        const v = dto[k];
        if (v === undefined) continue;
        const next = k === 'question' ? v.trim() : v.trim() || null;
        if (next !== item[k]) {
          before[k] = item[k];
          after[k] = next;
          (patch as any)[k] = next;
        }
      }
      if (dto.storyIds !== undefined) {
        const ids = await this.checkStories(em, item.srsId, dto.storyIds);
        const current = (await em.find(SrsClientItemStory, { where: { itemId: item.id } })).map((r) => r.storyId);
        if (!(current.length === ids.length && current.every((id) => ids.includes(id)))) {
          before.stories = await this.storyCodes(em, current);
          after.stories = await this.storyCodes(em, ids);
          await em.delete(SrsClientItemStory, { itemId: item.id });
          if (ids.length) await em.insert(SrsClientItemStory, ids.map((storyId) => ({ itemId: item.id, storyId })));
        }
      }
      if (!Object.keys(after).length) return { id: item.id, changed: false };
      if (Object.keys(patch).length) await em.update(SrsClientItem, { id: item.id }, { ...patch, updatedAt: new Date() });
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.CLIENT_ITEM_UPDATED, 'SrsClientItem', item.id, { number: item.number, before, after });
      return { id: item.id, changed: true };
    });
  }

  async closeClientItem(itemId: number, dto: CloseClientItemDto, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    if (!canCloseClientItems(user.role)) throw new ForbiddenException('Only a Program Manager or Admin can close client items.');
    const problem = minTextProblem(dto.resolution, RESOLUTION_MIN, 'the resolution');
    if (problem) throw new BadRequestException(problem);
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT id FROM srs_client_items WHERE id = $1 FOR UPDATE`, [itemId]);
      const item = await this.liveItem(em, itemId, tenantId);
      await this.requirements.loadVisibleSrs(item.srsId, user, tenantId);
      if (item.status !== 'open') throw new ConflictException('This client item is already closed.');
      const now = new Date();
      await em.update(SrsClientItem, { id: item.id }, { status: 'closed', resolution: dto.resolution.trim(), closedByUserId: user.id, closedAt: now, updatedAt: now });
      const stories = await this.storyCodes(em, (await em.find(SrsClientItemStory, { where: { itemId: item.id } })).map((r) => r.storyId));
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.CLIENT_ITEM_CLOSED, 'SrsClientItem', item.id, { number: item.number, resolution: dto.resolution.trim(), unblocks: stories });
      return { id: item.id, status: 'closed' };
    });
  }
}

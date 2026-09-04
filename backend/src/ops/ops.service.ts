import { BadRequestException, Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// This box's layout is fixed (single production server, no CI/deploy
// pipeline - see CLAUDE.md), so these are absolute, not derived.
const REPO_ROOT = '/home/ec2-user/tracker';
const RELEASES_DIR = '/home/ec2-user/tracker-releases';
const STATUS_FILE = path.join(REPO_ROOT, 'logs', 'last-rollback-status.json');
const OUTPUT_LOG = path.join(REPO_ROOT, 'logs', 'last-rollback-output.log');

export interface ReleaseSummary {
  index: number; // 1 = newest - matches rollback.sh's own numbering
  releaseId: string;
  timestamp: string;
  gitHead: string | null;
  gitDirty: boolean;
  description: string;
  migrations: string[];
}

export interface RollbackStatus {
  status: 'unknown' | 'running' | 'success' | 'smoke_check_failed' | 'refused' | 'error';
  smokeCheckPassed: boolean;
  reason: string;
  targetId: string;
  actor: string;
  finishedAt: string | null;
  shouldAuditLog: boolean;
}

@Injectable()
export class OpsService {
  listReleases(): ReleaseSummary[] {
    if (!fs.existsSync(RELEASES_DIR)) return [];

    const dirs = fs
      .readdirSync(RELEASES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest first, same ordering rollback.sh uses

    return dirs.map((name, i) => {
      const metaPath = path.join(RELEASES_DIR, name, 'meta.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      return {
        index: i + 1,
        releaseId: meta.releaseId,
        timestamp: meta.timestamp,
        gitHead: meta.gitHead ?? null,
        gitDirty: !!meta.gitDirty,
        description: meta.description ?? '',
        migrations: meta.migrations ?? [],
      };
    });
  }

  // rollback.sh's own job includes restarting tracker-backend - the very
  // process that would be awaiting it - so it can't run as a plain child
  // of this Node process: pm2 restarts by tree-killing every descendant
  // of the target PID (see pm2/lib/TreeKill.js, which walks `ps -e -o
  // pid=,ppid=`), and Node's `detached: true` only changes process-group
  // membership, not ppid - it does NOT protect against that. The only
  // thing that reliably escapes it is a process whose parent was never
  // tracker-backend in the first place. `systemd-run` launches rollback.sh
  // as a transient unit parented by systemd (PID 1) from the moment it
  // starts, so it's never in tracker-backend's descendant tree at all.
  //
  // Runs as ec2-user (not root - sudo is only needed to ask systemd to
  // create the unit) so file ownership and the pm2 daemon it talks to
  // stay identical to running it by hand from a terminal. Output redirect
  // is done inside the ec2-user-run bash itself (plain `>>`), not via a
  // systemd Standard(Output|Error)= property, because systemd opens those
  // as the manager (root) before dropping privileges, which would leave
  // the log file un-writable by ec2-user on the next run.
  //
  // The caller polls getStatus() instead of awaiting this - see the
  // status-file protocol in rollback.sh's write_status().
  startRollback(releaseId: string, confirmText: string, actor: string): { accepted: true; releaseId: string } {
    const releases = this.listReleases();
    const target = releases.find((r) => r.releaseId === releaseId);
    if (!target) {
      throw new BadRequestException(`Unknown release: ${releaseId}`);
    }
    if (confirmText !== 'ROLLBACK' && confirmText !== releaseId) {
      throw new BadRequestException('Confirmation text did not match');
    }

    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    if (fs.existsSync(STATUS_FILE)) fs.unlinkSync(STATUS_FILE);

    const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    const innerCommand = [
      'bash',
      sh(path.join(REPO_ROOT, 'rollback.sh')),
      '--release',
      String(target.index),
      '--confirm',
      'ROLLBACK',
      '--actor',
      sh(actor),
      '--status-file',
      sh(STATUS_FILE),
      '>>',
      sh(OUTPUT_LOG),
      '2>&1',
    ].join(' ');

    spawn(
      'sudo',
      [
        '-n',
        'systemd-run',
        `--unit=rollback-${Date.now()}`,
        '--collect',
        '--uid=ec2-user',
        '--gid=ec2-user',
        `--working-directory=${REPO_ROOT}`,
        '/bin/bash',
        '-c',
        innerCommand,
      ],
      { stdio: 'ignore' },
    );

    return { accepted: true, releaseId };
  }

  // Only ever flips auditLogged true->false->true once per completed run
  // (the file is deleted at the start of the next startRollback call), so
  // the controller can safely call this on every poll without risking a
  // duplicate AuditLog entry for the same rollback.
  getStatus(): RollbackStatus {
    if (!fs.existsSync(STATUS_FILE)) {
      return {
        status: 'unknown',
        smokeCheckPassed: false,
        reason: '',
        targetId: '',
        actor: '',
        finishedAt: null,
        shouldAuditLog: false,
      };
    }

    const raw = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    const isTerminal = raw.status !== 'running';
    const shouldAuditLog = isTerminal && !raw.auditLogged;

    if (shouldAuditLog) {
      fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...raw, auditLogged: true }));
    }

    return {
      status: raw.status,
      smokeCheckPassed: !!raw.smokeCheckPassed,
      reason: raw.reason ?? '',
      targetId: raw.targetId ?? '',
      actor: raw.actor ?? '',
      finishedAt: raw.finishedAt ?? null,
      shouldAuditLog,
    };
  }
}

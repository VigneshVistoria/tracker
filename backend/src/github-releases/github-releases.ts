// Performance Tracking P1/P2 from GitHub (2026-11-02, the user's
// decisions). Pure - no Nest/TypeORM imports.
//
//  * A GitHub App sends webhooks to POST /integrations/github/webhook.
//    Each is checked against X-Hub-Signature-256 (HMAC-SHA256 of the raw
//    body) with GITHUB_WEBHOOK_SECRET from backend/.env (and
//    GITHUB_WEBHOOK_SECRET_NEXT while rotating). Unsigned or wrongly signed
//    = refused. Only repositories mapped in Tracker are used. Every
//    delivery is logged (a summary, never the payload).
//  * Behind a switch, OFF by default: while OFF, signed deliveries are
//    logged as "ignored (switch off)" so the connection can be tested.
//  * What counts (per repository mapping, editable):
//      deployment_status success  -> environment name in the staging or
//                                    production list
//      workflow_run success       -> only the named deploy workflows; the
//                                    branch decides staging or production
//      release published          -> published = production, pre-release
//                                    = staging (the user's default)
//    A bare tag is not a release (publish a GitHub Release).
//  * Production: the Release Log entry for project + app + version is
//    created, or - if the PM already made it - only its EMPTY fields are
//    filled; GitHub never overwrites what the PM entered. Version = the tag
//    without a leading "v", else "sha-" + the first 7 of the commit.
//  * Staging: recorded; its date is suggested on the production release of
//    the same commit (or the same version, e.g. 1.2.0-rc.1 -> 1.2.0). The
//    PM still records who signed off (decision 3b), so P1 is unchanged.
//  * Released by = the GitHub user who started it, matched to a Tracker
//    user by their GitHub username (Admin sets it); not matched = nobody
//    charged, and a note for the PM.
//  * Tasks: TRK-<task number> in PR titles (required), branch names or
//    commit messages. A bare "#255" is never used - that is GitHub's own
//    numbering. Tasks that can't go in (no Resolution yet, other project,
//    Junk, not found) are skipped and listed for the PM (decision 5).
//  * The change ticket (P2) stays manual (decision 6).
import { createHmac, timingSafeEqual } from 'crypto';

export const GITHUB_DEFAULT_TASK_KEY_PREFIX = 'TRK';
export const GITHUB_DELIVERY_RETENTION_DAYS = 90;
export const GITHUB_PR_LOOKUPS_MAX = 30;
export const GITHUB_ENV_LIST_MAX = 20;
export const GITHUB_ENV_NAME_MAX = 100;
export const RELEASE_KINDS = ['production', 'staging', 'ignore'] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];
export type DeliveryOutcome = 'received' | 'processed' | 'ignored' | 'refused' | 'duplicate' | 'error';
export type Environment = 'staging' | 'production';

export const GITHUB_AUDIT = {
  SETTINGS_UPDATED: 'github_settings_updated',
  MAPPING_CREATED: 'github_repo_mapping_created',
  MAPPING_UPDATED: 'github_repo_mapping_updated',
  USER_GITHUB_LOGIN_SET: 'user_github_login_set',
} as const;

export const REPO_FULL_NAME = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
export const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
export const TASK_KEY_PREFIX = /^[A-Z][A-Z0-9]{1,9}$/;
// PR helpers: the start of copied branch names, e.g. feature/ or fix/.
export const BRANCH_PREFIX = /^[a-z0-9][a-z0-9._-]{0,28}\/$/;
export const DEFAULT_BRANCH_PREFIX = 'feature/';

// The signature GitHub sends: "sha256=" + hex HMAC of the raw body. Any of
// the configured secrets may match (rotation). Constant-time comparison.
export function signatureValid(rawBody: Buffer | undefined, header: string | undefined, secrets: string[]): boolean {
  if (!rawBody || !header || !header.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  if (given.length !== 32) return false;
  return secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    return timingSafeEqual(expected, given);
  });
}

// "v1.2.0" -> "1.2.0"; a branch name or anything else -> "sha-abc1234".
export function versionFor(ref: string | null | undefined, sha: string | null | undefined): string | null {
  const r = (ref || '').trim().replace(/^refs\/tags\//, '');
  if (/^v?\d+(\.\d+)*([-+][0-9A-Za-z.-]+)*$/i.test(r)) return r.replace(/^v/i, '');
  return sha ? `sha-${sha.slice(0, 7).toLowerCase()}` : null;
}

// The version without a pre-release or build suffix: "1.2.0-rc.1" -> "1.2.0".
export function baseVersion(version: string | null | undefined): string | null {
  if (!version || version.startsWith('sha-')) return null;
  return version.split(/[-+]/)[0];
}

// The versions a manual entry may have used for the same release.
export function versionVariants(version: string): string[] {
  const v = version.replace(/^v/i, '');
  return [v.toLowerCase(), `v${v}`.toLowerCase()];
}

// Task numbers referenced as PREFIX-123 (any case), not inside a longer word.
export function taskRefs(texts: (string | null | undefined)[], prefix: string): number[] {
  const re = new RegExp(`(?<![A-Za-z0-9])${prefix}-(\\d{1,9})(?![0-9])`, 'gi');
  const ids = new Set<number>();
  for (const text of texts) {
    for (const m of (text || '').matchAll(re)) ids.add(Number(m[1]));
  }
  return [...ids].sort((a, b) => a - b);
}

export interface RepoMappingRules {
  stagingEnvironments: string[];
  productionEnvironments: string[];
  deployWorkflows: string[];
  stagingBranches: string[];
  productionBranches: string[];
  publishedReleaseIs: ReleaseKind;
  preReleaseIs: ReleaseKind;
}

export interface ClassifiedEvent {
  environment: Environment;
  sha: string | null;
  ref: string | null;
  version: string | null;
  actorLogin: string | null;
  at: Date;
  // Text from the event itself that may name tasks (used when the App's
  // read access isn't set up, and always added to the commit/PR text).
  texts: string[];
  link: string | null;
}

export type Classification = { use: true; event: ClassifiedEvent } | { use: false; reason: string };

const has = (list: string[], value: string | null | undefined) =>
  !!value && list.some((x) => x.trim().toLowerCase() === value.trim().toLowerCase());

const when = (...values: unknown[]): Date => {
  for (const v of values) {
    if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v);
  }
  return new Date();
};

// Which events count, and whether as staging or production.
export function classify(event: string, payload: any, rules: RepoMappingRules): Classification {
  const repo = payload?.repository?.full_name ?? '';
  if (event === 'ping') return { use: false, reason: 'Ping from GitHub - the connection works.' };
  if (event === 'deployment') return { use: false, reason: 'Deployment created - waiting for its result (deployment_status).' };
  if (event === 'create') return { use: false, reason: 'A tag or branch was created - only a published GitHub Release counts.' };

  if (event === 'deployment_status') {
    const status = payload?.deployment_status?.state;
    if (status !== 'success') return { use: false, reason: `Deployment status "${status ?? 'unknown'}" - only success counts.` };
    const d = payload?.deployment ?? {};
    const name = String(d.environment ?? '');
    const environment: Environment | null = has(rules.productionEnvironments, name) ? 'production' : has(rules.stagingEnvironments, name) ? 'staging' : null;
    if (!environment) return { use: false, reason: `Environment "${name}" is not in this repository's staging or production list.` };
    const sha = d.sha ?? null;
    return {
      use: true,
      event: {
        environment,
        sha,
        ref: d.ref ?? null,
        version: versionFor(d.ref, sha),
        actorLogin: d.creator?.login ?? payload?.sender?.login ?? null,
        at: when(payload?.deployment_status?.created_at, payload?.deployment_status?.updated_at),
        texts: [d.ref, d.description, payload?.deployment_status?.description].filter(Boolean),
        link: payload?.deployment_status?.target_url || (sha && repo ? `https://github.com/${repo}/commit/${sha}` : null),
      },
    };
  }

  if (event === 'workflow_run') {
    const run = payload?.workflow_run ?? {};
    if (payload?.action !== 'completed') return { use: false, reason: `Workflow run "${payload?.action ?? 'unknown'}" - only completed runs count.` };
    if (run.conclusion !== 'success') return { use: false, reason: `Workflow run ended "${run.conclusion ?? 'unknown'}" - only success counts.` };
    if (rules.deployWorkflows.length === 0) return { use: false, reason: 'No deploy workflows are named for this repository - workflow runs are not used.' };
    if (!has(rules.deployWorkflows, run.name)) return { use: false, reason: `Workflow "${run.name ?? ''}" is not one of this repository's deploy workflows.` };
    const branch = run.head_branch ?? null;
    const environment: Environment | null = has(rules.productionBranches, branch) ? 'production' : has(rules.stagingBranches, branch) ? 'staging' : null;
    if (!environment) return { use: false, reason: `Branch "${branch ?? ''}" is not in this repository's staging or production branches.` };
    const sha = run.head_sha ?? null;
    return {
      use: true,
      event: {
        environment,
        sha,
        ref: branch,
        version: versionFor(null, sha),
        actorLogin: run.triggering_actor?.login ?? run.actor?.login ?? payload?.sender?.login ?? null,
        at: when(run.updated_at, run.run_started_at),
        texts: [branch, run.display_title, run.head_commit?.message].filter(Boolean),
        link: run.html_url ?? null,
      },
    };
  }

  if (event === 'release') {
    const r = payload?.release ?? {};
    // "published" comes for releases and pre-releases; "released" when a
    // pre-release is turned into a release (also sent with "published" for
    // a release - recording it twice is harmless).
    if (payload?.action !== 'published' && payload?.action !== 'released') {
      return { use: false, reason: `Release "${payload?.action ?? 'unknown'}" - only published releases count.` };
    }
    const kind: ReleaseKind = payload.action === 'released' ? rules.publishedReleaseIs : r.prerelease ? rules.preReleaseIs : rules.publishedReleaseIs;
    if (kind === 'ignore') return { use: false, reason: `${r.prerelease && payload.action !== 'released' ? 'Pre-releases' : 'Published releases'} are set to be ignored for this repository.` };
    if (r.draft) return { use: false, reason: 'Draft release - not published yet.' };
    return {
      use: true,
      event: {
        environment: kind,
        sha: null,
        ref: r.tag_name ?? null,
        version: versionFor(r.tag_name, null),
        actorLogin: r.author?.login ?? payload?.sender?.login ?? null,
        at: when(r.published_at, r.created_at),
        texts: [r.name, r.tag_name, r.target_commitish].filter(Boolean),
        link: r.html_url ?? null,
      },
    };
  }

  return { use: false, reason: `Event "${event}" is not used.` };
}

// A list setting: trimmed, no empties, no duplicates (ignoring case).
export function cleanList(list: unknown, label: string): { value: string[] } | { problem: string } {
  if (!Array.isArray(list)) return { problem: `${label} must be a list.` };
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') return { problem: `${label} must be text.` };
    const v = raw.trim();
    if (!v) continue;
    if (v.length > GITHUB_ENV_NAME_MAX) return { problem: `${label}: "${v.slice(0, 20)}..." is longer than ${GITHUB_ENV_NAME_MAX} characters.` };
    if (!out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  if (out.length > GITHUB_ENV_LIST_MAX) return { problem: `${label}: at most ${GITHUB_ENV_LIST_MAX} names.` };
  return { value: out };
}

// A name may not be both staging and production.
export function overlapProblem(staging: string[], production: string[], label: string): string | null {
  const both = staging.find((s) => production.some((p) => p.toLowerCase() === s.toLowerCase()));
  return both ? `${label}: "${both}" can't be both staging and production.` : null;
}

// ---------- Multi-stage release path (2026-11-11, the user's decisions) ----------
// A repository may list ordered stages (e.g. Dev -> Test -> Training ->
// Production; Local is not tracked). Used only while the stages switch is
// on AND the repository has stages; otherwise classify() above applies
// unchanged (e.g. Insurance).
//  * A deploy matches a stage by GitHub environment name
//    (deployment_status), deploy workflow name (+ branch, if listed)
//    (workflow_run), or release tag pattern (release; "*" = anything).
//  * Production is always the last stage; a published (not pre-) release
//    whose tag matches no pattern is Production, as today.
//  * P1 sign-off stage: per repository, default the stage named "Test",
//    else the stage just before Production. Its deploy date is what the
//    staging date was before.
export interface ReleaseStage {
  key: string;
  name: string;
  production: boolean;
  environments: string[];
  workflows: string[];
  branches: string[];
  tagPatterns: string[];
}

export const STAGES_MIN = 2;
export const STAGES_MAX = 8;
export const STAGE_NAME_MAX = 60;
export const DEFAULT_P1_STAGE_NAME = 'test';
const TAG_PATTERN = /^[A-Za-z0-9._*+\/-]{1,100}$/;

// "Training (UAT)" -> "training-uat"
export function stageKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Case-insensitive glob: "*" matches anything (including nothing).
export function globMatch(pattern: string, value: string | null | undefined): boolean {
  if (!value) return false;
  const re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`, 'i');
  return re.test(value);
}

// Checks and tidies a stage list (as sent by the Admin page).
export function cleanStages(raw: unknown): { value: ReleaseStage[] } | { problem: string } {
  if (!Array.isArray(raw)) return { problem: 'Stages must be a list.' };
  if (raw.length === 0) return { value: [] };
  if (raw.length < STAGES_MIN || raw.length > STAGES_MAX) return { problem: `Give ${STAGES_MIN} to ${STAGES_MAX} stages (or none, to use Staging/Production).` };
  const out: ReleaseStage[] = [];
  for (const [i, s] of raw.entries()) {
    if (!s || typeof s !== 'object') return { problem: `Stage ${i + 1} is not valid.` };
    const name = typeof (s as any).name === 'string' ? (s as any).name.trim() : '';
    if (!name || name.length > STAGE_NAME_MAX) return { problem: `Stage ${i + 1} needs a name of 1 to ${STAGE_NAME_MAX} characters.` };
    const key = stageKey(name);
    if (!key) return { problem: `Stage "${name}" needs letters or digits in its name.` };
    if (out.some((o) => o.key === key)) return { problem: `Two stages are called "${name}".` };
    const lists: Record<string, string[]> = {};
    for (const [field, label] of [
      ['environments', 'environments'],
      ['workflows', 'deploy workflows'],
      ['branches', 'branches'],
      ['tagPatterns', 'tag patterns'],
    ] as const) {
      const r = cleanList((s as any)[field] ?? [], `${name}: ${label}`);
      if ('problem' in r) return { problem: r.problem };
      lists[field] = r.value;
    }
    const bad = lists.tagPatterns.find((p) => !TAG_PATTERN.test(p) || /^\*+$/.test(p));
    if (bad) return { problem: `${name}: tag pattern "${bad}" - letters, digits, . _ - + / and *, and not just "*".` };
    if (lists.branches.length && !lists.workflows.length) return { problem: `${name}: branches only count together with a deploy workflow - name the workflow too.` };
    out.push({
      key,
      name,
      production: !!(s as any).production,
      environments: lists.environments,
      workflows: lists.workflows,
      branches: lists.branches,
      tagPatterns: lists.tagPatterns,
    });
  }
  const prod = out.filter((s) => s.production);
  if (prod.length !== 1 || !out[out.length - 1].production) return { problem: 'Exactly one stage is Production, and it must be the last.' };
  for (const s of out.slice(0, -1)) {
    if (!s.environments.length && !s.workflows.length && !s.tagPatterns.length) {
      return { problem: `${s.name}: give at least one environment, deploy workflow or tag pattern, or Tracker can never see a deploy to it.` };
    }
  }
  // Nothing may point at two stages.
  for (let a = 0; a < out.length; a++) {
    for (let b = a + 1; b < out.length; b++) {
      const A = out[a];
      const B = out[b];
      const env = A.environments.find((e) => has(B.environments, e));
      if (env) return { problem: `Environment "${env}" is in both ${A.name} and ${B.name}.` };
      const tag = A.tagPatterns.find((t) => has(B.tagPatterns, t));
      if (tag) return { problem: `Tag pattern "${tag}" is in both ${A.name} and ${B.name}.` };
      const wf = A.workflows.find((w) => has(B.workflows, w));
      if (wf) {
        const sameBranch = !A.branches.length || !B.branches.length || A.branches.some((x) => has(B.branches, x));
        if (sameBranch) return { problem: `Workflow "${wf}" would count for both ${A.name} and ${B.name} - give each stage its own branches.` };
      }
    }
  }
  return { value: out };
}

// The P1 sign-off stage: the chosen key; else "Test"; else the stage
// just before Production. Never Production itself.
export function resolveP1Stage(stages: ReleaseStage[], p1StageKey: string | null | undefined): ReleaseStage | null {
  const before = stages.filter((s) => !s.production);
  if (!before.length) return null;
  return before.find((s) => s.key === p1StageKey) ?? before.find((s) => s.key === DEFAULT_P1_STAGE_NAME) ?? before[before.length - 1];
}

export function p1StageProblem(stages: ReleaseStage[], p1StageKey: string | null): string | null {
  if (p1StageKey === null) return null;
  const s = stages.find((x) => x.key === p1StageKey);
  if (!s) return 'The P1 sign-off stage must be one of this repository\'s stages.';
  if (s.production) return 'The P1 sign-off stage must come before Production.';
  return null;
}

export type StageClassification = { use: true; stage: ReleaseStage; event: ClassifiedEvent } | { use: false; reason: string };

// Which stage an event is, for a repository with stages.
export function classifyStage(event: string, payload: any, stages: ReleaseStage[]): StageClassification {
  const repo = payload?.repository?.full_name ?? '';
  const production = stages[stages.length - 1];
  const done = (stage: ReleaseStage, e: Omit<ClassifiedEvent, 'environment'>): StageClassification => ({
    use: true,
    stage,
    event: { ...e, environment: stage.production ? 'production' : 'staging' },
  });
  if (event === 'ping') return { use: false, reason: 'Ping from GitHub - the connection works.' };
  if (event === 'deployment') return { use: false, reason: 'Deployment created - waiting for its result (deployment_status).' };
  if (event === 'create') return { use: false, reason: 'A tag or branch was created - only a published GitHub Release counts.' };

  if (event === 'deployment_status') {
    const status = payload?.deployment_status?.state;
    if (status !== 'success') return { use: false, reason: `Deployment status "${status ?? 'unknown'}" - only success counts.` };
    const d = payload?.deployment ?? {};
    const name = String(d.environment ?? '');
    const stage = stages.find((s) => has(s.environments, name));
    if (!stage) return { use: false, reason: `Environment "${name}" is not in any of this repository's stages.` };
    const sha = d.sha ?? null;
    return done(stage, {
      sha,
      ref: d.ref ?? null,
      version: versionFor(d.ref, sha),
      actorLogin: d.creator?.login ?? payload?.sender?.login ?? null,
      at: when(payload?.deployment_status?.created_at, payload?.deployment_status?.updated_at),
      texts: [d.ref, d.description, payload?.deployment_status?.description].filter(Boolean),
      link: payload?.deployment_status?.target_url || (sha && repo ? `https://github.com/${repo}/commit/${sha}` : null),
    });
  }

  if (event === 'workflow_run') {
    const run = payload?.workflow_run ?? {};
    if (payload?.action !== 'completed') return { use: false, reason: `Workflow run "${payload?.action ?? 'unknown'}" - only completed runs count.` };
    if (run.conclusion !== 'success') return { use: false, reason: `Workflow run ended "${run.conclusion ?? 'unknown'}" - only success counts.` };
    const branch = run.head_branch ?? null;
    const stage = stages.find((s) => has(s.workflows, run.name) && (!s.branches.length || has(s.branches, branch)));
    if (!stage) return { use: false, reason: `Workflow "${run.name ?? ''}" on branch "${branch ?? ''}" is not a deploy to any of this repository's stages.` };
    const sha = run.head_sha ?? null;
    return done(stage, {
      sha,
      ref: branch,
      version: versionFor(null, sha),
      actorLogin: run.triggering_actor?.login ?? run.actor?.login ?? payload?.sender?.login ?? null,
      at: when(run.updated_at, run.run_started_at),
      texts: [branch, run.display_title, run.head_commit?.message].filter(Boolean),
      link: run.html_url ?? null,
    });
  }

  if (event === 'release') {
    const r = payload?.release ?? {};
    if (payload?.action !== 'published' && payload?.action !== 'released') {
      return { use: false, reason: `Release "${payload?.action ?? 'unknown'}" - only published releases count.` };
    }
    if (r.draft) return { use: false, reason: 'Draft release - not published yet.' };
    const tag = r.tag_name ?? null;
    const byTag = stages.find((s) => s.tagPatterns.some((p) => globMatch(p, tag)));
    const isFull = payload.action === 'released' || !r.prerelease;
    const stage = byTag ?? (isFull ? production : null);
    if (!stage) return { use: false, reason: `Pre-release tag "${tag ?? ''}" matches no stage's tag pattern.` };
    return done(stage, {
      sha: null,
      ref: tag,
      version: versionFor(tag, null),
      actorLogin: r.author?.login ?? payload?.sender?.login ?? null,
      at: when(r.published_at, r.created_at),
      texts: [r.name, tag, r.target_commitish].filter(Boolean),
      link: r.html_url ?? null,
    });
  }

  return { use: false, reason: `Event "${event}" is not used.` };
}

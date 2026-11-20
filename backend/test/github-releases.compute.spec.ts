import { createHmac } from 'crypto';
import { baseVersion, classify, classifyStage, cleanList, deploymentTexts, overlapProblem, RepoMappingRules, signatureValid, taskRefs, versionFor, versionVariants } from '../src/github-releases/github-releases';

const rules: RepoMappingRules = {
  stagingEnvironments: ['staging', 'UAT'],
  productionEnvironments: ['production'],
  deployWorkflows: ['Deploy'],
  stagingBranches: ['develop'],
  productionBranches: ['main'],
  publishedReleaseIs: 'production',
  preReleaseIs: 'staging',
};
const repository = { full_name: 'vistoria/tracker' };

describe('GitHub releases (pure rules)', () => {
  it('checks the signature with any configured secret, in constant time', () => {
    const body = Buffer.from('{"a":1}');
    const sign = (secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(signatureValid(body, sign('s1'), ['s1'])).toBe(true);
    expect(signatureValid(body, sign('s2'), ['s1', 's2'])).toBe(true);
    expect(signatureValid(body, sign('other'), ['s1'])).toBe(false);
    expect(signatureValid(Buffer.from('{"a":2}'), sign('s1'), ['s1'])).toBe(false);
    expect(signatureValid(body, undefined, ['s1'])).toBe(false);
    expect(signatureValid(body, 'sha1=abc', ['s1'])).toBe(false);
    expect(signatureValid(body, 'sha256=zz', ['s1'])).toBe(false);
    expect(signatureValid(undefined, sign('s1'), ['s1'])).toBe(false);
  });

  it('versions: tag without "v", else the short commit', () => {
    expect(versionFor('v1.2.0', 'abcdef1234')).toBe('1.2.0');
    expect(versionFor('refs/tags/V2.0-rc.1', null)).toBe('2.0-rc.1');
    expect(versionFor('main', 'ABCDEF1234')).toBe('sha-abcdef1');
    expect(versionFor(null, null)).toBeNull();
    expect(baseVersion('1.2.0-rc.1')).toBe('1.2.0');
    expect(baseVersion('sha-abcdef1')).toBeNull();
    expect(versionVariants('V1.2')).toEqual(['1.2', 'v1.2']);
  });

  it('task keys: TRK-<number> anywhere, any case, never a bare #number or inside a word', () => {
    expect(taskRefs(['TRK-255 Fix login (#12)', 'feature/trk-260-x', 'Merge pull request #7 from org/TRK-255-y', 'XTRK-9 no', 'TRK-12345678901 too long'], 'TRK')).toEqual([255, 260]);
    expect(taskRefs(['#255', 'TRK255', 'TRK-'], 'TRK')).toEqual([]);
    expect(taskRefs(['ABC-3 and TRK-4'], 'ABC')).toEqual([3]);
  });

  it('merge commits name their task: a deployment made by an Actions run carries the run title and head commit message (2026-11-20)', () => {
    const merge = 'Merge TRK-335 F3 schema + create/picker/Add Property + busyGuard B1 fix (Bhavani, reviewed)';
    const payload = {
      deployment_status: { state: 'success', created_at: '2026-11-20T07:51:00Z' },
      deployment: { environment: 'develop', ref: 'develop', sha: 'abc1234def' },
      workflow_run: { name: 'Postgres migration frontend', display_title: merge.slice(0, 60), head_commit: { message: `${merge}\n\nMerge branch 'feature/f3-new-registration' into develop` } },
      repository: { full_name: 'org/repo' },
    };
    expect(taskRefs(deploymentTexts(payload), 'TRK')).toEqual([335]);
    // GitHub's own merge messages too: a PR merge names the branch, a local merge the branch name.
    expect(taskRefs(["Merge pull request #12 from org/feature/TRK-77-login", "Merge branch 'feature/trk-78' into develop"], 'TRK')).toEqual([77, 78]);
    const stages = [
      { key: 'dev', name: 'Dev', environments: ['develop'], branches: [], workflows: [], tagPatterns: [], production: false },
      { key: 'prod', name: 'Production', environments: ['production'], branches: [], workflows: [], tagPatterns: [], production: true },
    ] as any;
    const staged = classifyStage('deployment_status', payload, stages);
    expect(staged.use).toBe(true);
    if (staged.use) expect(taskRefs(staged.event.texts, 'TRK')).toEqual([335]);
    const legacy = classify('deployment_status', payload, { stagingEnvironments: ['develop'], productionEnvironments: [], deployWorkflows: [], stagingBranches: [], productionBranches: [], publishedReleaseIs: 'production', preReleaseIs: 'staging' });
    expect(legacy.use && taskRefs(legacy.event.texts, 'TRK')).toEqual([335]);
    // No run in the payload (a hand-made deployment): only its own text, as before.
    expect(deploymentTexts({ deployment: { ref: 'develop', description: 'TRK-9' } })).toEqual(['develop', 'TRK-9']);
  });

  it('deployment_status: success only, environment decides', () => {
    const ev = (state: string, environment: string) => ({
      repository,
      deployment_status: { state, created_at: '2026-11-02T08:00:00Z' },
      deployment: { environment, sha: 'a'.repeat(40), ref: 'v1.4.0', creator: { login: 'octo' } },
    });
    const prod = classify('deployment_status', ev('success', 'Production'), rules);
    expect(prod).toMatchObject({ use: true, event: { environment: 'production', version: '1.4.0', actorLogin: 'octo', sha: 'a'.repeat(40) } });
    expect(classify('deployment_status', ev('success', 'uat'), rules)).toMatchObject({ use: true, event: { environment: 'staging' } });
    expect(classify('deployment_status', ev('failure', 'production'), rules)).toMatchObject({ use: false });
    expect(classify('deployment_status', ev('success', 'qa'), rules)).toMatchObject({ use: false, reason: expect.stringContaining('"qa"') });
  });

  it('workflow_run: only named deploy workflows that succeeded; the branch decides', () => {
    const run = (name: string, branch: string, conclusion = 'success') => ({
      action: 'completed',
      repository,
      workflow_run: { name, head_branch: branch, head_sha: 'b'.repeat(40), conclusion, triggering_actor: { login: 'dev1' }, display_title: 'TRK-7 thing' },
    });
    expect(classify('workflow_run', run('Deploy', 'main'), rules)).toMatchObject({ use: true, event: { environment: 'production', version: 'sha-bbbbbbb', actorLogin: 'dev1', texts: ['main', 'TRK-7 thing'] } });
    expect(classify('workflow_run', run('deploy', 'develop'), rules)).toMatchObject({ use: true, event: { environment: 'staging' } });
    expect(classify('workflow_run', run('CI', 'main'), rules)).toMatchObject({ use: false });
    expect(classify('workflow_run', run('Deploy', 'feature/x'), rules)).toMatchObject({ use: false });
    expect(classify('workflow_run', run('Deploy', 'main', 'failure'), rules)).toMatchObject({ use: false });
    expect(classify('workflow_run', run('Deploy', 'main'), { ...rules, deployWorkflows: [] })).toMatchObject({ use: false, reason: expect.stringContaining('No deploy workflows') });
  });

  it('releases: published = production, pre-release = staging, drafts and tags ignored', () => {
    const rel = (action: string, prerelease: boolean, draft = false) => ({
      action,
      repository,
      release: { tag_name: 'v3.1.0', prerelease, draft, name: 'TRK-9 big one', author: { login: 'rel' }, published_at: '2026-11-02T10:00:00Z' },
    });
    expect(classify('release', rel('published', false), rules)).toMatchObject({ use: true, event: { environment: 'production', version: '3.1.0', sha: null } });
    expect(classify('release', rel('published', true), rules)).toMatchObject({ use: true, event: { environment: 'staging' } });
    expect(classify('release', rel('released', false), rules)).toMatchObject({ use: true, event: { environment: 'production' } });
    expect(classify('release', rel('published', true), { ...rules, preReleaseIs: 'ignore' })).toMatchObject({ use: false });
    expect(classify('release', rel('created', false), rules)).toMatchObject({ use: false });
    expect(classify('release', rel('published', false, true), rules)).toMatchObject({ use: false });
    expect(classify('create', { ref_type: 'tag', ref: 'v1', repository }, rules)).toMatchObject({ use: false });
    expect(classify('ping', {}, rules)).toMatchObject({ use: false });
    expect(classify('issues', {}, rules)).toMatchObject({ use: false });
  });

  it('list settings are cleaned, and a name cannot be both staging and production', () => {
    expect(cleanList([' staging ', 'Staging', '', 'uat'], 'X')).toEqual({ value: ['staging', 'uat'] });
    expect(cleanList('staging', 'X')).toEqual({ problem: 'X must be a list.' });
    expect(overlapProblem(['main'], ['MAIN'], 'Branches')).toMatch(/both staging and production/);
    expect(overlapProblem(['develop'], ['main'], 'Branches')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { Project, ShowrunnerRun } from '@kathix/store';
import { sample, testRuntime } from '../../../../tests/helpers';
import type { ShowrunnerService } from '../src/service';

async function until(
  rt: Awaited<ReturnType<typeof testRuntime>>,
  runId: string,
  statuses: string[],
): Promise<ShowrunnerRun> {
  for (let i = 0; i < 400; i++) {
    const r = rt.ctx.store.getRun(runId) as ShowrunnerRun;
    if (statuses.includes(r.status)) return r;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error(`Run never reached ${statuses.join('/')}`);
}

describe('Showrunner agent', () => {
  it('plans from available modules, waits at every checkpoint, survives a restart, and commits only approved changes', async () => {
    let rt = await testRuntime();
    const dataDir = rt.dataDir;
    const project = await (rt.ctx.use('home') as { seedSample(): Promise<Project> }).seedSample();
    let s = rt.ctx.use<ShowrunnerService>('showrunner') as ShowrunnerService;
    const run = s.start({
      projectId: project.id,
      scriptId: null,
      newTitle: 'Episode 5',
      goal: 'Draft episode 5 from this outline and make it ready to record',
      outline: sample('episode-5-outline.txt'),
      templateRunId: null,
    });

    let r = await until(rt, run.id, ['awaiting_approval']);
    expect(r.steps.map((x) => x.stepId)).toEqual([
      'script.draft',
      'continuity.check',
      'voice.check',
      'continuity.fixes',
      'forge.package',
    ]);
    // Nothing reaches the script before approval.
    expect(rt.ctx.store.currentVersion(r.scriptId)?.text).toBe('');
    const draft = r.steps[0]?.proposedText ?? '';
    expect(draft.length).toBeGreaterThan(50);
    s.approve(run.id, null);
    expect(rt.ctx.store.currentVersion(r.scriptId)?.text).toBe(draft);

    // Restart the whole app while the next step is queued or running.
    rt.close();
    rt = await testRuntime(dataDir);
    s = rt.ctx.use<ShowrunnerService>('showrunner') as ShowrunnerService;
    r = await until(rt, run.id, ['awaiting_approval']);
    expect(r.stepIndex).toBe(1);

    s.approve(run.id, null); // continuity check
    await until(rt, run.id, ['awaiting_approval']);
    s.skip(run.id); // voice check: the creator says no
    r = await until(rt, run.id, ['awaiting_approval']);
    const fixes = r.steps[3];
    expect(fixes?.stepId).toBe('continuity.fixes');
    const edited = `${fixes?.proposedText ?? r.workingText}\n[Creator's own closing note]`;
    s.approve(run.id, edited);
    await until(rt, run.id, ['awaiting_approval']);
    s.approve(run.id, null); // hooks and titles
    r = await until(rt, run.id, ['completed']);

    expect(rt.ctx.store.currentVersion(r.scriptId)?.text).toBe(edited);
    expect(r.steps.map((x) => x.status)).toEqual([
      'approved',
      'approved',
      'skipped',
      'approved',
      'approved',
    ]);
    expect(r.tokens).toBeGreaterThan(0);

    // Saved runs replay as templates on a new episode.
    s.saveTemplate(run.id, 'Episode pipeline');
    const replay = s.start({
      projectId: project.id,
      scriptId: null,
      newTitle: 'Episode 6',
      goal: 'Same again',
      outline: '- A beat',
      templateRunId: run.id,
    });
    const rr = await until(rt, replay.id, ['awaiting_approval']);
    expect(rr.steps.map((x) => x.stepId)).toEqual(r.steps.map((x) => x.stepId));
    s.stop(replay.id);
    expect(rt.ctx.store.getRun(replay.id)?.status).toBe('stopped');
    rt.close();
  }, 60_000);
});

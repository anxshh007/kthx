import { runTemplate, showrunnerPlan } from '@kathix/prompts';
import {
  UserError,
  recordLedger,
  replaceWholeText,
  type AgentStep,
  type ModuleContext,
} from '@kathix/platform';
import type { RunStep, ShowrunnerRun } from '@kathix/store';

export interface StartRequest {
  projectId: string;
  scriptId: string | null;
  newTitle: string;
  goal: string;
  outline: string;
  templateRunId: string | null;
}

export function createShowrunnerService(ctx: ModuleContext) {
  const { store } = ctx;

  const available = (): AgentStep[] =>
    [...ctx.agentSteps.values()]
      .filter((s) => ctx.capabilities.hasAll(s.requires))
      .sort((a, b) => a.order - b.order);

  const update = (id: string, patch: Partial<ShowrunnerRun>, log?: string): ShowrunnerRun => {
    const cur = store.getRun(id) as ShowrunnerRun;
    const next = store.updateRun(id, {
      ...patch,
      ...(log ? { log: [...cur.log, { at: new Date().toISOString(), message: log }] } : {}),
    }) as ShowrunnerRun;
    ctx.events.emit('showrunner.updated', { runId: id, status: next.status });
    return next;
  };

  const setStep = (run: ShowrunnerRun, index: number, patch: Partial<RunStep>): RunStep[] =>
    run.steps.map((s, i) => (i === index ? { ...s, ...patch } : s));

  const schedule = (run: ShowrunnerRun) =>
    ctx.jobs.enqueue(
      'showrunner.step',
      { runId: run.id },
      {
        projectId: run.projectId,
        label: `Showrunner: ${run.goal.slice(0, 40)}`,
        priority: 'background',
      },
    );

  ctx.jobs.register('showrunner.step', async (job, jc) => {
    const { runId } = job.input as { runId: string };
    let run = store.getRun(runId);
    if (!run || run.status === 'stopped' || run.status === 'completed') return { skipped: true };
    const started = Date.now();
    if (run.status === 'planning') {
      jc.progress(0.1, 'Planning the run');
      const steps = available();
      let plan: { stepId: string; purpose: string }[];
      const tmpl = (job.input as { templateSteps?: { stepId: string; purpose: string }[] })
        .templateSteps;
      if (tmpl?.length) plan = tmpl.filter((t) => steps.some((s) => s.id === t.stepId));
      else {
        const res = await runTemplate(
          ctx.router,
          showrunnerPlan,
          {
            goal: run.goal,
            steps: steps.map((s) => ({ id: s.id, label: s.label, description: s.description })),
            hasOutline: Boolean(run.outline.trim()),
            hasScriptText: Boolean(store.currentVersion(run.scriptId)?.text.trim()),
          },
          { module: 'showrunner', priority: 'background', signal: jc.signal },
        );
        update(runId, { tokens: run.tokens + res.inputTokens + res.outputTokens });
        plan = res.output.steps.filter(
          (p, i, arr) =>
            steps.some((s) => s.id === p.stepId) &&
            arr.findIndex((x) => x.stepId === p.stepId) === i,
        );
        if (!plan.length) plan = steps.map((s) => ({ stepId: s.id, purpose: s.description }));
      }
      const order = new Map(steps.map((s) => [s.id, s.order]));
      plan.sort((a, b) => (order.get(a.stepId) ?? 0) - (order.get(b.stepId) ?? 0));
      run = update(
        runId,
        {
          status: 'running',
          stepIndex: 0,
          workingText: store.currentVersion(run.scriptId)?.text ?? '',
          steps: plan.map((p) => ({
            stepId: p.stepId,
            label: steps.find((s) => s.id === p.stepId)?.label ?? p.stepId,
            purpose: p.purpose,
            status: 'pending',
            summary: '',
            proposedText: null,
            details: null,
            note: '',
            reading: '',
            error: null,
          })),
        },
        `Planned ${plan.length} steps`,
      );
    }
    const index = run.stepIndex;
    const step = run.steps[index];
    if (!step) {
      update(runId, { status: 'completed' }, 'Run complete');
      return { done: true };
    }
    const def = ctx.agentSteps.get(step.stepId);
    if (!def || !ctx.capabilities.hasAll(def.requires)) {
      update(
        runId,
        {
          steps: setStep(run, index, {
            status: 'failed',
            error: 'This step is not available right now.',
          }),
          status: 'failed',
        },
        `${step.label} is not available right now`,
      );
      throw new Error(
        `${step.label} is not available right now. Reconnect your model and try again.`,
      );
    }
    run = update(
      runId,
      { status: 'running', steps: setStep(run, index, { status: 'running', error: null }) },
      `Started: ${step.label}`,
    );
    jc.progress((index + 0.5) / run.steps.length, step.label);
    try {
      const out = await def.run({
        run,
        projectId: run.projectId,
        scriptId: run.scriptId,
        goal: run.goal,
        outline: run.outline,
        workingText: run.workingText,
        note: step.note,
        signal: jc.signal,
        reading: (what) => {
          const cur = store.getRun(runId) as ShowrunnerRun;
          update(runId, { steps: setStep(cur, index, { reading: what }) }, `Reading ${what}`);
        },
        addTokens: (n) => {
          const cur = store.getRun(runId) as ShowrunnerRun;
          update(runId, { tokens: cur.tokens + n });
        },
      });
      const cur = store.getRun(runId) as ShowrunnerRun;
      if (cur.status === 'stopped') return { stopped: true };
      update(
        runId,
        {
          status: 'awaiting_approval',
          elapsedMs: cur.elapsedMs + (Date.now() - started),
          steps: setStep(cur, index, {
            status: 'awaiting_approval',
            summary: out.summary,
            proposedText: out.proposedText,
            details: out.details,
            reading: '',
          }),
        },
        `${step.label} is waiting for your approval`,
      );
      return { awaiting: step.stepId };
    } catch (err) {
      const cur = store.getRun(runId) as ShowrunnerRun;
      const message = err instanceof Error ? err.message : 'The step failed.';
      update(
        runId,
        {
          status: 'failed',
          elapsedMs: cur.elapsedMs + (Date.now() - started),
          steps: setStep(cur, index, { status: 'failed', error: message, reading: '' }),
        },
        `${step.label} failed: ${message}`,
      );
      throw err;
    }
  });

  const requireRun = (id: string) => {
    const run = store.getRun(id);
    if (!run) throw new UserError('That run could not be found.', 404);
    return run;
  };

  const advance = (run: ShowrunnerRun): ShowrunnerRun => {
    const next = run.stepIndex + 1;
    if (next >= run.steps.length) {
      const done = update(
        run.id,
        { stepIndex: next, status: 'completed' },
        'Run complete: every step was decided by you',
      );
      recordLedger(ctx, {
        projectId: run.projectId,
        scriptId: run.scriptId,
        kind: 'showrunner.completed',
        module: 'showrunner',
        summary: `Showrunner finished: ${run.goal}`,
      });
      return done;
    }
    const updated = update(run.id, { stepIndex: next, status: 'running' });
    schedule(updated);
    return updated;
  };

  const service = {
    availableSteps: () =>
      available().map((s) => ({ id: s.id, label: s.label, description: s.description })),

    start(req: StartRequest) {
      const project = store.getProject(req.projectId);
      if (!project) throw new UserError('That project could not be found.', 404);
      if (!req.goal.trim()) throw new UserError('Tell the Showrunner what you want to achieve.');
      let scriptId = req.scriptId;
      if (!scriptId) {
        const script = store.createScript({
          projectId: project.id,
          title: req.newTitle.trim() || 'New episode',
          episode: null,
        });
        scriptId = script.id;
      }
      let templateSteps: { stepId: string; purpose: string }[] | undefined;
      if (req.templateRunId) {
        const t = requireRun(req.templateRunId);
        templateSteps = t.steps.map((s) => ({ stepId: s.stepId, purpose: s.purpose }));
      }
      const run = store.createRun({
        projectId: project.id,
        scriptId,
        goal: req.goal.trim(),
        outline: req.outline,
        templateName: '',
      });
      update(run.id, {}, templateSteps ? 'Started from a saved template' : 'Started');
      ctx.jobs.enqueue(
        'showrunner.step',
        { runId: run.id, templateSteps },
        {
          projectId: project.id,
          label: `Showrunner: ${run.goal.slice(0, 40)}`,
          priority: 'background',
        },
      );
      recordLedger(ctx, {
        projectId: project.id,
        scriptId,
        kind: 'showrunner.started',
        module: 'showrunner',
        summary: `Showrunner started: ${run.goal}`,
      });
      return store.getRun(run.id) as ShowrunnerRun;
    },

    runs: (projectId: string) => store.listRuns(projectId),
    run: (id: string) => requireRun(id),
    templates: (projectId: string) => store.listRuns(projectId).filter((r) => r.templateName),

    approve(id: string, editedText: string | null) {
      const run = requireRun(id);
      const step = run.steps[run.stepIndex];
      if (run.status !== 'awaiting_approval' || !step)
        throw new UserError('This run is not waiting for an approval.', 409);
      let workingText = run.workingText;
      const text = editedText ?? step.proposedText;
      if (text !== null && text !== undefined) {
        // Only now does anything reach the script.
        replaceWholeText(ctx, {
          scriptId: run.scriptId,
          text,
          origin: editedText !== null && editedText !== step.proposedText ? 'ai_edited' : 'ai',
          source: 'agent',
          note: `Showrunner: ${step.label}`,
        });
        workingText = text;
        recordLedger(ctx, {
          projectId: run.projectId,
          scriptId: run.scriptId,
          kind:
            editedText !== null && editedText !== step.proposedText
              ? 'suggestion.edited'
              : 'suggestion.accepted',
          module: 'showrunner',
          summary: `Approved Showrunner step: ${step.label}`,
        });
      }
      const updated = update(
        id,
        {
          workingText,
          steps: run.steps.map((s, i) => (i === run.stepIndex ? { ...s, status: 'approved' } : s)),
        },
        `You approved: ${step.label}`,
      );
      return advance(updated);
    },

    redo(id: string, note: string) {
      const run = requireRun(id);
      const step = run.steps[run.stepIndex];
      if ((run.status !== 'awaiting_approval' && run.status !== 'failed') || !step)
        throw new UserError('This step cannot be redone right now.', 409);
      const updated = update(
        id,
        {
          status: 'running',
          steps: run.steps.map((s, i) =>
            i === run.stepIndex
              ? { ...s, status: 'pending', note, proposedText: null, summary: '', error: null }
              : s,
          ),
        },
        note ? `Redo ${step.label} with your note: ${note}` : `Redo ${step.label}`,
      );
      schedule(updated);
      return updated;
    },

    skip(id: string) {
      const run = requireRun(id);
      const step = run.steps[run.stepIndex];
      if ((run.status !== 'awaiting_approval' && run.status !== 'failed') || !step)
        throw new UserError('This step cannot be skipped right now.', 409);
      const updated = update(
        id,
        { steps: run.steps.map((s, i) => (i === run.stepIndex ? { ...s, status: 'skipped' } : s)) },
        `You skipped: ${step.label}`,
      );
      return advance(updated);
    },

    stop(id: string) {
      const run = requireRun(id);
      if (run.status === 'completed' || run.status === 'stopped') return run;
      for (const j of store.jobs.listByStatus(['queued', 'running'])) {
        if (j.type === 'showrunner.step' && (j.input as { runId: string }).runId === id)
          ctx.jobs.cancel(j.id);
      }
      return update(id, { status: 'stopped' }, 'You stopped the run. Nothing else will change.');
    },

    saveTemplate(id: string, name: string) {
      requireRun(id);
      if (!name.trim()) throw new UserError('Give the template a name.');
      return update(id, { templateName: name.trim() }, `Saved as template “${name.trim()}”`);
    },

    docs: (projectId: string) =>
      store.listDocs(projectId).map((d) => ({ ...d, text: store.getDoc(d.id)?.text ?? '' })),
  };
  return service;
}

export type ShowrunnerService = ReturnType<typeof createShowrunnerService>;

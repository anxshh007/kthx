import { createHash } from 'node:crypto';
import { renderCanonBlock, shortId } from '@kathix/kernel/shared';
import { continuityCheck, runTemplate, verifyQuote, type ContinuityOutput } from '@kathix/prompts';
import { TASK_BUDGETS, budget, indexEntry, retrieve } from '@kathix/retrieval';
import {
  UserError,
  findInScript,
  recordLedger,
  replaceRange,
  type AgentStep,
  type ModuleContext,
} from '@kathix/platform';
import type { CanonEntry, ContinuityIssue, IssueType, Project } from '@kathix/store';

export interface FoundIssue {
  type: IssueType;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  summary: string;
  draftQuote: string;
  draftStart: number;
  draftEnd: number;
  refKind: 'canon' | 'script' | 'reference';
  refId: string;
  refLabel: string;
  refQuote: string;
  fixText: string;
  fixReason: string;
  fingerprint: string;
}

interface Block {
  id: string;
  label: string;
  text: string;
  kind: 'canon' | 'script' | 'reference';
  sourceId: string;
}

export function fingerprint(type: string, draftQuote: string, refId: string): string {
  const norm = draftQuote.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${type}|${norm}|${refId}`).digest('hex').slice(0, 24);
}

export function createContinuityService(ctx: ModuleContext) {
  const { store } = ctx;

  /** Runs the model, then keeps only issues whose two quotes both exist verbatim. */
  const analyse = async (
    draft: { id: string; label: string; text: string },
    canon: Block[],
    references: Block[],
    dismissed: { fingerprint: string; summary: string }[],
    signal?: AbortSignal,
    priority: 'interactive' | 'background' = 'interactive',
  ) => {
    const res = await runTemplate(
      ctx.router,
      continuityCheck,
      { draft, canon, references, dismissed: dismissed.map((d) => d.summary).filter(Boolean) },
      { module: 'continuity', priority, signal, cache: false },
    );
    const blocks = new Map([...canon, ...references].map((b) => [b.id, b]));
    const dismissedSet = new Set(dismissed.map((d) => d.fingerprint));
    const issues: FoundIssue[] = [];
    let discarded = 0;
    for (const i of res.output.issues as ContinuityOutput['issues']) {
      const d = verifyQuote(draft.text, i.draftQuote);
      const block = blocks.get(i.refSourceId);
      const r = block ? verifyQuote(block.text, i.refQuote) : null;
      if (!d || !block || !r) {
        discarded++;
        continue;
      }
      const fp = fingerprint(i.type, d.quote, block.sourceId);
      if (dismissedSet.has(fp) || issues.some((x) => x.fingerprint === fp)) continue;
      issues.push({
        type: i.type,
        severity: i.severity,
        confidence: Math.round(i.confidence * 100) / 100,
        summary: i.summary,
        draftQuote: d.quote,
        draftStart: d.start,
        draftEnd: d.end,
        refKind: block.kind,
        refId: block.sourceId,
        refLabel: block.label,
        refQuote: r.quote,
        fixText: i.fixReplacement,
        fixReason: i.fixReason,
        fingerprint: fp,
      });
    }
    return {
      issues,
      discarded,
      model: res.model,
      provider: res.providerId,
      tokens: res.inputTokens + res.outputTokens,
      notEnoughInformation: res.output.notEnoughInformation,
    };
  };

  /** Canon entries (named ones first) and earlier episodes, cut to the continuity budget. */
  const projectMaterial = async (
    project: Project,
    scriptId: string | null,
    text: string,
    signal?: AbortSignal,
  ) => {
    const entries = store.listEntries(project.id);
    const named = await retrieve(store, {
      projectId: project.id,
      query: text.slice(0, 8000),
      kinds: ['canon'],
      limit: 40,
      router: ctx.capabilities.has('model.embeddings') ? ctx.router : undefined,
      signal,
    });
    const order = new Map(named.map((n, i) => [n.sourceId, i]));
    const always = (e: CanonEntry) => e.type === 'rule' || e.type === 'promise';
    const ranked = [...entries].sort(
      (a, b) =>
        (order.get(a.id) ?? (always(a) ? 50 : 1000)) - (order.get(b.id) ?? (always(b) ? 50 : 1000)),
    );
    const canonBlocks: Block[] = ranked.map((e) => ({
      id: `canon-${e.id}`,
      label: e.name,
      text: renderCanonBlock(e),
      kind: 'canon',
      sourceId: e.id,
    }));
    const scriptHits = await retrieve(store, {
      projectId: project.id,
      query: text.slice(0, 8000),
      kinds: ['script'],
      limit: 10,
      excludeSourceIds: scriptId ? [scriptId] : [],
    });
    const refBlocks: Block[] = scriptHits.map((h, n) => ({
      id: `ref-${n + 1}`,
      label: h.label,
      text: h.text,
      kind: 'script',
      sourceId: h.sourceId,
    }));
    const kept = budget([...canonBlocks, ...refBlocks], TASK_BUDGETS.continuity).included;
    return {
      canon: kept.filter((b) => b.kind === 'canon'),
      references: kept.filter((b) => b.kind === 'script'),
    };
  };

  const service = {
    async checkScript(
      scriptId: string,
      opts: {
        signal?: AbortSignal;
        priority?: 'interactive' | 'background';
        onStage?: (s: string) => void;
      } = {},
    ) {
      const script = store.getScript(scriptId);
      if (!script) throw new UserError('That script could not be found.', 404);
      const project = store.getProject(script.projectId) as Project;
      const text = store.currentVersion(scriptId)?.text ?? '';
      if (!text.trim())
        throw new UserError('This script is empty, so there is nothing to check yet.');
      opts.onStage?.('Gathering your canon and earlier episodes');
      const material = await projectMaterial(project, scriptId, text, opts.signal);
      opts.onStage?.(
        `Comparing against ${material.canon.length} canon entries and ${material.references.length} earlier passages`,
      );
      const res = await analyse(
        { id: 'draft', label: script.title, text },
        material.canon,
        material.references,
        store.listDismissals(project.id),
        opts.signal,
        opts.priority,
      );
      const runId = shortId();
      const saved: ContinuityIssue[] = res.issues.map((i) =>
        store.addIssue({ ...i, projectId: project.id, scriptId, runId }),
      );
      store.supersedeOpenIssues(scriptId, runId);
      recordLedger(ctx, {
        projectId: project.id,
        scriptId,
        kind: 'continuity.checked',
        module: 'continuity',
        provider: res.provider,
        model: res.model,
        summary: `Continuity check on “${script.title}” found ${saved.length} issue${saved.length === 1 ? '' : 's'}`,
        detail: { discarded: res.discarded },
      });
      return {
        runId,
        issues: saved,
        discarded: res.discarded,
        notEnoughInformation: res.notEnoughInformation,
        canonCount: material.canon.length,
      };
    },

    /** Two-box mode: no project, nothing stored. */
    async compare(reference: string, draft: string, signal?: AbortSignal) {
      if (!reference.trim() || !draft.trim())
        throw new UserError('Paste both a reference text and a draft.');
      const res = await analyse(
        { id: 'draft', label: 'Draft', text: draft },
        [],
        [
          {
            id: 'reference',
            label: 'Reference',
            text: reference,
            kind: 'reference',
            sourceId: 'reference',
          },
        ],
        [],
        signal,
      );
      return {
        issues: res.issues,
        discarded: res.discarded,
        notEnoughInformation: res.notEnoughInformation,
      };
    },

    issues: (scriptId: string) => {
      const script = store.getScript(scriptId);
      if (!script) throw new UserError('That script could not be found.', 404);
      return store.listIssues({ projectId: script.projectId, scriptId, status: 'open' });
    },

    applyFix(issueId: string, text: string, edited: boolean) {
      const issue = store.getIssue(issueId);
      if (!issue || issue.status !== 'open' || !issue.scriptId)
        throw new UserError('That issue was already handled.', 409);
      const range = findInScript(ctx, issue.scriptId, issue.draftQuote, issue.draftStart);
      if (!range)
        throw new UserError('That passage has changed since the check. Run the check again.');
      const version = replaceRange(ctx, {
        scriptId: issue.scriptId,
        from: range.from,
        to: range.to,
        text,
        origin: edited ? 'ai_edited' : 'ai',
        source: 'fix',
        note: 'Applied a continuity fix',
      });
      const sg = store.addSuggestion({
        projectId: issue.projectId,
        scriptId: issue.scriptId,
        module: 'continuity',
        action: 'fix',
        provider: '',
        model: '',
        originalText: issue.draftQuote,
        proposedText: issue.fixText,
        rangeStart: range.from,
        rangeEnd: range.to,
        reason: issue.fixReason,
        evidence: [],
      });
      store.decideSuggestion(sg.id, edited ? 'edited' : 'accepted', text);
      store.setIssueStatus(issue.id, 'fixed');
      recordLedger(ctx, {
        projectId: issue.projectId,
        scriptId: issue.scriptId,
        kind: edited ? 'suggestion.edited' : 'suggestion.accepted',
        module: 'continuity',
        summary: `Fixed a continuity issue: ${issue.summary}`,
        detail: { issueId },
      });
      return { version };
    },

    /** The script is right and the vault is outdated: update the canon entry instead. */
    editCanon(issueId: string, patch: { summary?: string; attributes?: Record<string, string> }) {
      const issue = store.getIssue(issueId);
      if (!issue || issue.status !== 'open')
        throw new UserError('That issue was already handled.', 409);
      if (issue.refKind !== 'canon')
        throw new UserError('This issue points at an earlier episode, not a canon entry.');
      const entry = store.updateEntry(
        issue.refId,
        patch,
        `Updated from Continuity Guard: ${issue.summary}`,
      );
      if (!entry) throw new UserError('That canon entry no longer exists.', 404);
      indexEntry(store, entry);
      store.setIssueStatus(issue.id, 'canon_updated');
      recordLedger(ctx, {
        projectId: issue.projectId,
        scriptId: issue.scriptId,
        kind: 'canon.edited',
        module: 'continuity',
        summary: `Updated “${entry.name}” to match the script`,
      });
      return { entry };
    },

    markIntentional(issueId: string) {
      const issue = store.getIssue(issueId);
      if (!issue || issue.status !== 'open')
        throw new UserError('That issue was already handled.', 409);
      store.addDismissal(issue.projectId, issue.fingerprint, issue.summary);
      store.setIssueStatus(issue.id, 'intentional');
      recordLedger(ctx, {
        projectId: issue.projectId,
        scriptId: issue.scriptId,
        kind: 'continuity.intentional',
        module: 'continuity',
        summary: `Marked as intentional: ${issue.summary}`,
      });
      return { ok: true };
    },

    reopen(issueId: string) {
      const issue = store.getIssue(issueId);
      if (!issue || issue.status !== 'intentional')
        throw new UserError('Only issues marked as intentional can be reopened.', 409);
      store.removeDismissal(issue.projectId, issue.fingerprint);
      store.setIssueStatus(issue.id, 'open');
      return { ok: true };
    },

    health(projectId: string) {
      const scripts = store.listScripts(projectId);
      const history = store.issueHistory(projectId);
      return scripts.map((s) => ({
        id: s.id,
        title: s.title,
        open: store.listIssues({ projectId, scriptId: s.id, status: 'open' }).length,
        runs: history
          .filter((h) => h.scriptId === s.id)
          .map((h) => ({ at: h.at, open: h.open, total: h.total })),
      }));
    },

    entryFor(issueId: string): CanonEntry | null {
      const issue = store.getIssue(issueId);
      return issue && issue.refKind === 'canon' ? store.getEntry(issue.refId) : null;
    },
  };

  ctx.jobs.register('continuity.check', async (job, jc) => {
    const { scriptId } = job.input as { scriptId: string };
    const res = await service.checkScript(scriptId, {
      signal: jc.signal,
      priority: 'background',
      onStage: (s) => jc.progress(0.3, s),
    });
    return { issues: res.issues.length };
  });

  // Background check on save, when the creator switched it on for the project.
  const lastRun = new Map<string, number>();
  ctx.events.on('script.saved', ({ projectId, scriptId }) => {
    const project = store.getProject(projectId);
    if (!project?.settings.continuityOnSave || !ctx.capabilities.has('model.structured')) return;
    const busy = store.jobs
      .listByStatus(['queued', 'running'])
      .some(
        (j) =>
          j.type === 'continuity.check' && (j.input as { scriptId: string }).scriptId === scriptId,
      );
    if (busy || Date.now() - (lastRun.get(scriptId) ?? 0) < 60_000) return;
    lastRun.set(scriptId, Date.now());
    ctx.jobs.enqueue(
      'continuity.check',
      { scriptId },
      { projectId, label: 'Continuity check after save', priority: 'background' },
    );
  });

  return service;
}

export type ContinuityService = ReturnType<typeof createContinuityService>;

export function continuityAgentSteps(_s: ContinuityService, ctx: ModuleContext): AgentStep[] {
  return [
    {
      id: 'continuity.check',
      label: 'Continuity check',
      description:
        'Compares the draft with the canon and earlier episodes and lists contradictions with both passages quoted.',
      order: 20,
      requires: ['model.structured'],
      async run(a) {
        const project = ctx.store.getProject(a.projectId) as Project;
        const service = createMaterialChecker(ctx);
        a.reading('the canon and earlier episodes');
        const res = await service(project, a.scriptId, a.workingText, a.signal);
        a.addTokens(res.tokens);
        return {
          summary: res.issues.length
            ? `Found ${res.issues.length} continuity issue${res.issues.length === 1 ? '' : 's'}: ${res.issues.map((i) => i.summary).join(' ')}`
            : 'No contradictions found.',
          proposedText: null,
          details: {
            issues: res.issues,
            fixes: res.issues.map((i) => ({
              quote: i.draftQuote,
              replacement: i.fixText,
              reason: i.fixReason,
            })),
          },
        };
      },
    },
    {
      id: 'continuity.fixes',
      label: 'Fix proposals',
      description:
        'Applies the fixes proposed by earlier checks (continuity and voice) so you can approve them together.',
      order: 40,
      requires: ['store.ready'],
      async run(a) {
        let text = a.workingText;
        const applied: string[] = [];
        for (const step of a.run.steps) {
          if (step.status !== 'approved') continue;
          const fixes =
            (
              step.details as {
                fixes?: { quote: string; replacement: string; reason: string }[];
              } | null
            )?.fixes ?? [];
          for (const f of fixes) {
            if (!f.quote || !text.includes(f.quote)) continue;
            text = text.replace(f.quote, f.replacement);
            applied.push(f.reason);
          }
        }
        return {
          summary: applied.length
            ? `Applied ${applied.length} fix${applied.length === 1 ? '' : 'es'}: ${applied.join(' ')}`
            : 'There were no fixes to apply.',
          proposedText: applied.length ? text : null,
          details: { applied },
        };
      },
    },
  ];
}

/** Stateless check used by the Showrunner on its working text (nothing stored). */
function createMaterialChecker(ctx: ModuleContext) {
  return async (project: Project, scriptId: string, text: string, signal: AbortSignal) => {
    const entries = ctx.store.listEntries(project.id);
    const canon = entries.map((e) => ({
      id: `canon-${e.id}`,
      label: e.name,
      text: renderCanonBlock(e),
      kind: 'canon' as const,
      sourceId: e.id,
    }));
    const hits = await retrieve(ctx.store, {
      projectId: project.id,
      query: text.slice(0, 8000),
      kinds: ['script'],
      limit: 8,
      excludeSourceIds: [scriptId],
    });
    const refs = hits.map((h, n) => ({
      id: `ref-${n + 1}`,
      label: h.label,
      text: h.text,
      kind: 'script' as const,
      sourceId: h.sourceId,
    }));
    const kept = budget([...canon, ...refs], TASK_BUDGETS.continuity).included;
    const res = await runTemplate(
      ctx.router,
      continuityCheck,
      {
        draft: { id: 'draft', label: 'Draft', text },
        canon: kept.filter((b) => b.kind === 'canon'),
        references: kept.filter((b) => b.kind === 'script'),
        dismissed: ctx.store.listDismissals(project.id).map((d) => d.summary),
      },
      { module: 'showrunner', priority: 'background', signal, cache: false },
    );
    const blocks = new Map(kept.map((b) => [b.id, b]));
    const dismissed = new Set(ctx.store.listDismissals(project.id).map((d) => d.fingerprint));
    const issues = res.output.issues.flatMap((i) => {
      const d = verifyQuote(text, i.draftQuote);
      const block = blocks.get(i.refSourceId);
      const r = block ? verifyQuote(block.text, i.refQuote) : null;
      if (!d || !block || !r || dismissed.has(fingerprint(i.type, d.quote, block.sourceId)))
        return [];
      return [
        {
          type: i.type,
          severity: i.severity,
          summary: i.summary,
          draftQuote: d.quote,
          refLabel: block.label,
          refQuote: r.quote,
          fixText: i.fixReplacement,
          fixReason: i.fixReason,
        },
      ];
    });
    return { issues, tokens: res.inputTokens + res.outputTokens };
  };
}

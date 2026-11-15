import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import {
  classifyLine,
  renderCanonBlock,
  scriptStats,
  splitParagraphs,
  type AuthorSpan,
  type EvidenceRef,
} from '@kathix/kernel/shared';
import {
  coach,
  cowrite,
  draftFromOutline,
  runTemplate,
  verifyEvidence,
  type CowriteAction,
  type EvidenceSource,
  type SourceBlock,
} from '@kathix/prompts';
import { TASK_BUDGETS, budget, indexScript, retrieve } from '@kathix/retrieval';
import {
  UserError,
  recordLedger,
  replaceRange,
  saveScriptText,
  type AgentStep,
  type ModuleContext,
  type VoiceApi,
} from '@kathix/platform';
import type { Project, Script, Suggestion } from '@kathix/store';

const FAST_ACTIONS: CowriteAction[] = ['rewrite', 'tighten', 'tone', 'punchup'];

export interface SuggestRequest {
  scriptId: string;
  action: CowriteAction;
  instruction: string;
  from: number;
  to: number;
  count?: number;
}

export function createScriptService(ctx: ModuleContext) {
  const { store } = ctx;

  const getScript = (id: string): { script: Script; project: Project } => {
    const script = store.getScript(id);
    if (!script) throw new UserError('That script could not be found.', 404);
    const project = store.getProject(script.projectId) as Project;
    return { script, project };
  };

  /** Canon entries and past passages relevant to a passage, cut to the task's token budget. */
  const gatherContext = async (
    projectId: string,
    scriptId: string | null,
    query: string,
    maxTokens: number,
    signal?: AbortSignal,
  ) => {
    const hits = await retrieve(store, {
      projectId,
      query,
      limit: 14,
      excludeSourceIds: scriptId ? [scriptId] : [],
      router: ctx.capabilities.has('model.embeddings') ? ctx.router : undefined,
      signal,
    });
    const canonHits = hits.filter((h) => h.sourceKind === 'canon');
    const scriptHits = hits.filter((h) => h.sourceKind === 'script');
    const entries = new Map(store.listEntries(projectId).map((e) => [e.id, e]));
    const canon: (SourceBlock & { kind: 'canon' })[] = canonHits.flatMap((h) => {
      const e = entries.get(h.sourceId);
      return e
        ? [
            {
              id: `canon:${e.id}`,
              label: e.name,
              text: renderCanonBlock(e),
              kind: 'canon' as const,
            },
          ]
        : [];
    });
    const passages: (SourceBlock & { kind: 'script'; offset: number; scriptId: string })[] =
      scriptHits.map((h) => ({
        id: `script:${h.sourceId}:${h.start}`,
        label: h.label,
        text: h.text,
        kind: 'script' as const,
        offset: h.start,
        scriptId: h.sourceId,
      }));
    const kept = budget([...canon, ...passages], maxTokens).included;
    const keptCanon = kept.filter((k): k is (typeof canon)[number] => k.kind === 'canon');
    const keptPassages = kept.filter((k): k is (typeof passages)[number] => k.kind === 'script');
    const sources: EvidenceSource[] = [
      ...keptCanon.map((c) => ({ id: c.id, kind: 'canon' as const, label: c.label, text: c.text })),
      ...keptPassages.map((p) => ({
        id: p.id,
        kind: 'script' as const,
        label: p.label,
        text: p.text,
        offset: p.offset,
      })),
    ];
    return {
      canon: keptCanon,
      passages: keptPassages,
      sources,
      why: new Map(hits.map((h) => [h.sourceId, h.why])),
    };
  };

  /** Evidence ids look like canon:<entryId> or script:<scriptId>:<offset>; the UI needs the real source ids. */
  const normaliseEvidence = (ev: EvidenceRef[]): EvidenceRef[] =>
    ev.map((e) => {
      const [kind, id] = e.sourceId.split(':') as [string, string];
      return { ...e, sourceKind: kind === 'canon' ? 'canon' : 'script', sourceId: id };
    });

  const voiceSummary = (project: Project): string | null => {
    if (!project.settings.voiceConditioning || !project.settings.activeVoiceProfileId) return null;
    return ctx.use<VoiceApi>('voice')?.promptSummary(project.settings.activeVoiceProfileId) ?? null;
  };

  const writerTarget = (project: Project) =>
    project.settings.useAdaptionWriter && ctx.capabilities.has('model.custom.adaption')
      ? (ctx.router.adaptionTarget() ?? undefined)
      : undefined;

  const service = {
    list: (projectId: string) =>
      store.listScripts(projectId).map((s) => {
        const v = store.currentVersion(s.id);
        const project = store.getProject(projectId) as Project;
        return { ...s, stats: scriptStats(v?.text ?? '', project.type) };
      }),

    create(projectId: string, title: string, episode: number | null, text = '') {
      if (!store.getProject(projectId))
        throw new UserError('That project could not be found.', 404);
      const script = store.createScript({
        projectId,
        title: title.trim() || 'Untitled',
        episode,
        text,
        source: text ? 'import' : 'edit',
      });
      if (text) indexScript(store, script, text);
      recordLedger(ctx, {
        projectId,
        scriptId: script.id,
        kind: 'script.created',
        module: 'script',
        summary: `Started “${script.title}”`,
      });
      return script;
    },

    get(id: string) {
      const { script, project } = getScript(id);
      const version = store.currentVersion(id);
      return { script, project, version, stats: scriptStats(version?.text ?? '', project.type) };
    },

    save(id: string, text: string, authorship: AuthorSpan[] | null) {
      getScript(id);
      const v = saveScriptText(ctx, {
        scriptId: id,
        text,
        authorship,
        source: 'edit',
        note: 'Autosave',
      });
      return { versionId: v.id, seq: v.seq };
    },

    update(id: string, patch: { title?: string; episode?: number | null; archived?: boolean }) {
      const s = store.updateScript(id, patch);
      if (!s) throw new UserError('That script could not be found.', 404);
      return s;
    },

    remove(id: string) {
      const { script } = getScript(id);
      store.deleteScript(id);
      recordLedger(ctx, {
        projectId: script.projectId,
        scriptId: null,
        kind: 'script.deleted',
        module: 'script',
        summary: `Deleted “${script.title}”`,
      });
    },

    versions: (id: string) => store.listVersions(id),

    version(id: string, versionId: string) {
      const v = store.getVersion(versionId);
      if (!v || v.scriptId !== id) throw new UserError('That version could not be found.', 404);
      return v;
    },

    restore(id: string, versionId: string) {
      const v = service.version(id, versionId);
      const { script } = getScript(id);
      const saved = saveScriptText(ctx, {
        scriptId: id,
        text: v.text,
        authorship: v.authorship,
        source: 'restore',
        note: `Restored version ${v.seq}`,
      });
      recordLedger(ctx, {
        projectId: script.projectId,
        scriptId: id,
        kind: 'script.restored',
        module: 'script',
        summary: `Restored “${script.title}” to version ${v.seq}`,
      });
      return saved;
    },

    async context(id: string, from: number, to: number) {
      const { script } = getScript(id);
      const text = store.currentVersion(id)?.text ?? '';
      const para = splitParagraphs(text).find(
        (p) => p.start <= Math.max(from, 0) + 1 && p.end >= from - 1,
      ) ?? { text: text.slice(Math.max(0, from - 400), to + 400) };
      const query = `${para.text}\n${text.slice(Math.max(0, from - 300), Math.min(text.length, to + 300))}`;
      const hits = await retrieve(store, {
        projectId: script.projectId,
        query,
        kinds: ['canon'],
        limit: 6,
      });
      const entries = new Map(store.listEntries(script.projectId).map((e) => [e.id, e]));
      return hits.flatMap((h) => {
        const e = entries.get(h.sourceId);
        return e
          ? [
              {
                id: e.id,
                name: e.name,
                type: e.type,
                summary: e.summary,
                attributes: e.attributes,
                why: h.why,
              },
            ]
          : [];
      });
    },

    async suggest(
      req: SuggestRequest,
      onPartial: (t: string) => void,
      onReset: () => void,
      signal?: AbortSignal,
    ): Promise<{ suggestions: Suggestion[]; notEnoughInformation: boolean; canonUsed: boolean }> {
      const { script, project } = getScript(req.scriptId);
      const text = store.currentVersion(req.scriptId)?.text ?? '';
      const from = Math.max(0, Math.min(req.from, text.length));
      const to = Math.max(from, Math.min(req.to, text.length));
      const selection = text.slice(from, to);
      if (req.action !== 'continue' && req.action !== 'instruction' && !selection.trim()) {
        throw new UserError('Select the passage you want help with first.');
      }
      const query = selection || text.slice(Math.max(0, from - 1500), from);
      const context = await gatherContext(
        project.id,
        script.id,
        query,
        TASK_BUDGETS.cowrite,
        signal,
      );
      const rejectNotes = store
        .listSuggestions({ scriptId: script.id, status: 'rejected' })
        .filter((s) => s.rejectReason && s.action === req.action)
        .slice(0, 5)
        .map((s) => s.rejectReason);
      const count = req.action === 'alternatives' ? Math.max(2, Math.min(req.count ?? 3, 5)) : 1;
      const res = await runTemplate(
        ctx.router,
        cowrite,
        {
          action: req.action,
          instruction: req.instruction,
          projectType: project.type,
          before: text.slice(0, from),
          selection,
          after: text.slice(to),
          canon: context.canon,
          passages: context.passages,
          voice: voiceSummary(project),
          rejectNotes,
          count,
        },
        {
          module: 'script',
          priority: 'interactive',
          signal,
          tier: FAST_ACTIONS.includes(req.action) ? 'fast' : 'balanced',
          target: writerTarget(project),
          cache: false,
          onPartial,
          onReset,
        },
      );
      const suggestions = res.output.suggestions.slice(0, count).map((sg) => {
        let proposed = sg.text;
        if (
          req.action === 'continue' &&
          from > 0 &&
          !/\s$/.test(text.slice(0, from)) &&
          !/^\s/.test(proposed)
        )
          proposed = ` ${proposed}`;
        if (selection) {
          // Keep the spacing around the selection so words never run together.
          const lead = /^\s*/.exec(selection)?.[0] ?? '';
          const trail = /\s*$/.exec(selection)?.[0] ?? '';
          proposed = lead + proposed.trim() + trail;
        }
        const evidence = normaliseEvidence(verifyEvidence(sg.evidence, context.sources));
        const s = store.addSuggestion({
          projectId: project.id,
          scriptId: script.id,
          module: 'script',
          action: req.action,
          provider: res.providerId,
          model: res.model,
          originalText: selection,
          proposedText: proposed,
          rangeStart: from,
          rangeEnd: to,
          reason: sg.reason,
          evidence,
        });
        recordLedger(ctx, {
          projectId: project.id,
          scriptId: script.id,
          kind: 'suggestion.offered',
          module: 'script',
          provider: res.providerId,
          model: res.model,
          summary: `Co-writer offered a “${req.action}” suggestion`,
          detail: { suggestionId: s.id },
        });
        return s;
      });
      return {
        suggestions,
        notEnoughInformation: res.output.notEnoughInformation,
        canonUsed: context.canon.length > 0,
      };
    },

    accept(suggestionId: string, finalText: string, edited: boolean) {
      const sg = store.getSuggestion(suggestionId);
      if (!sg || sg.status !== 'offered' || !sg.scriptId)
        throw new UserError('That suggestion was already handled.', 409);
      const version = replaceRange(ctx, {
        scriptId: sg.scriptId,
        from: sg.rangeStart,
        to: sg.rangeEnd,
        text: finalText,
        origin: edited ? 'ai_edited' : 'ai',
        source: 'suggestion',
        note: edited ? 'Accepted an edited suggestion' : 'Accepted a suggestion',
        expected: sg.originalText,
      });
      store.decideSuggestion(sg.id, edited ? 'edited' : 'accepted', finalText);
      for (const sibling of store.listSuggestions({ scriptId: sg.scriptId, status: 'offered' })) {
        if (
          sibling.id !== sg.id &&
          sibling.rangeStart === sg.rangeStart &&
          sibling.rangeEnd === sg.rangeEnd
        ) {
          store.decideSuggestion(sibling.id, 'rejected', '', 'Another alternative was chosen');
        }
      }
      recordLedger(ctx, {
        projectId: sg.projectId,
        scriptId: sg.scriptId,
        kind: edited ? 'suggestion.edited' : 'suggestion.accepted',
        module: sg.module,
        provider: sg.provider,
        model: sg.model,
        summary: edited ? 'Accepted a suggestion after editing it' : 'Accepted a suggestion',
        detail: { suggestionId: sg.id, characters: finalText.length },
      });
      return { version };
    },

    reject(suggestionId: string, reason: string) {
      const sg = store.getSuggestion(suggestionId);
      if (!sg || sg.status !== 'offered')
        throw new UserError('That suggestion was already handled.', 409);
      store.decideSuggestion(sg.id, 'rejected', '', reason);
      recordLedger(ctx, {
        projectId: sg.projectId,
        scriptId: sg.scriptId,
        kind: 'suggestion.rejected',
        module: sg.module,
        provider: sg.provider,
        model: sg.model,
        summary: reason ? `Rejected a suggestion: ${reason}` : 'Rejected a suggestion',
        detail: { suggestionId: sg.id },
      });
      return { ok: true };
    },

    async coach(id: string, from: number, to: number) {
      const { script, project } = getScript(id);
      const text = store.currentVersion(id)?.text ?? '';
      const passage =
        to > from
          ? text.slice(from, to)
          : text.slice(Math.max(0, from - 2500), Math.min(text.length, from + 2500));
      if (!passage.trim()) throw new UserError('There is nothing here for the coach to read yet.');
      const context = await gatherContext(project.id, script.id, passage, TASK_BUDGETS.coach);
      const res = await runTemplate(
        ctx.router,
        coach,
        { projectType: project.type, text: passage, canon: context.canon },
        { module: 'script', priority: 'interactive' },
      );
      const anchor = (q: string) => {
        const idx = text.indexOf(q.trim());
        return idx >= 0 ? idx : null;
      };
      return {
        questions: res.output.questions
          .filter((q) => passage.includes(q.quote.trim()))
          .map((q) => ({ ...q, at: anchor(q.quote) })),
        weakBeats: res.output.weakBeats
          .filter((w) => passage.includes(w.quote.trim()))
          .map((w) => ({ ...w, at: anchor(w.quote) })),
      };
    },

    exportText(id: string, format: 'md' | 'txt'): { name: string; body: string } {
      const { script } = getScript(id);
      const text = store.currentVersion(id)?.text ?? '';
      const safe = script.title.replace(/[^\w\- ]+/g, '').trim() || 'script';
      if (format === 'txt') return { name: `${safe}.txt`, body: text };
      const md = text
        .split('\n')
        .map((l) => {
          const k = classifyLine(l);
          if (k.kind === 'heading') return `## ${l.replace(/^#+\s*/, '')}`;
          if (k.kind === 'speaker' && k.speaker)
            return `**${k.speaker}:** ${l.slice(l.indexOf(':') + 1).trim()}`;
          if (k.kind === 'note') return `*${l.trim()}*`;
          return l;
        })
        .join('\n');
      return { name: `${safe}.md`, body: `# ${script.title}\n\n${md}\n` };
    },

    async exportDocx(id: string): Promise<{ name: string; body: Buffer }> {
      const { script } = getScript(id);
      const text = store.currentVersion(id)?.text ?? '';
      const paragraphs = [new Paragraph({ text: script.title, heading: HeadingLevel.TITLE })];
      for (const line of text.split('\n')) {
        const k = classifyLine(line);
        if (k.kind === 'heading')
          paragraphs.push(
            new Paragraph({ text: line.replace(/^#+\s*/, ''), heading: HeadingLevel.HEADING_2 }),
          );
        else if (k.kind === 'speaker' && k.speaker) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${k.speaker}: `, bold: true }),
                new TextRun(line.slice(line.indexOf(':') + 1).trim()),
              ],
            }),
          );
        } else if (k.kind === 'note')
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: line.trim(), italics: true })],
              alignment: AlignmentType.LEFT,
            }),
          );
        else paragraphs.push(new Paragraph({ text: line }));
      }
      const doc = new Document({ sections: [{ children: paragraphs }] });
      return {
        name: `${script.title.replace(/[^\w\- ]+/g, '').trim() || 'script'}.docx`,
        body: await Packer.toBuffer(doc),
      };
    },
  };
  return service;
}

export type ScriptService = ReturnType<typeof createScriptService>;

/** Showrunner step: draft (or revise) the episode from the creator's outline. */
export function scriptAgentSteps(_s: ScriptService, ctx: ModuleContext): AgentStep[] {
  return [
    {
      id: 'script.draft',
      label: 'Draft from outline',
      description:
        'Writes a first draft that follows the outline beat by beat, consistent with the canon.',
      order: 10,
      requires: ['model.structured'],
      async run(a) {
        if (!a.outline.trim())
          return {
            summary: 'No outline was given, so the existing script is kept as the draft.',
            proposedText: null,
            details: {},
          };
        const project = ctx.store.getProject(a.projectId) as Project;
        const script = ctx.store.getScript(a.scriptId) as Script;
        a.reading('the outline and the canon entries it touches');
        const hits = await retrieve(ctx.store, {
          projectId: a.projectId,
          query: a.outline,
          kinds: ['canon'],
          limit: 12,
        });
        const entries = new Map(ctx.store.listEntries(a.projectId).map((e) => [e.id, e]));
        const canon = budget(
          hits.flatMap((h) => {
            const e = entries.get(h.sourceId);
            return e ? [{ id: `canon:${e.id}`, label: e.name, text: renderCanonBlock(e) }] : [];
          }),
          TASK_BUDGETS.draft,
        ).included;
        const voice =
          project.settings.voiceConditioning && project.settings.activeVoiceProfileId
            ? (ctx.use<VoiceApi>('voice')?.promptSummary(project.settings.activeVoiceProfileId) ??
              null)
            : null;
        const res = await runTemplate(
          ctx.router,
          draftFromOutline,
          {
            projectType: project.type,
            title: script.title,
            outline: a.outline,
            existing: a.note ? a.workingText : '',
            canon,
            voice,
            note: a.note,
          },
          { module: 'showrunner', priority: 'background', signal: a.signal, cache: !a.note },
        );
        a.addTokens(res.inputTokens + res.outputTokens);
        const evidence = verifyEvidence(
          res.output.evidence,
          canon.map((c) => ({ id: c.id, kind: 'canon' as const, label: c.label, text: c.text })),
        );
        return {
          summary: `Drafted ${res.output.script.split(/\s+/).filter(Boolean).length} words. ${res.output.reason}`,
          proposedText: res.output.script,
          details: { evidence: evidence.map((e) => e.label) },
        };
      },
    },
  ];
}

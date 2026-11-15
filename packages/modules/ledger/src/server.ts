import { authorshipShare, fitSpans, spansToRanges } from '@kathix/kernel/shared';
import {
  UserError,
  projectOrScratch,
  type ModuleContext,
  type ServerModule,
} from '@kathix/platform';
import { manifest } from './manifest';

export function createLedgerService(ctx: ModuleContext) {
  const { store } = ctx;

  const suggestionCounts = (filter: { scriptId?: string; projectId?: string }) => {
    const list = store.listSuggestions(filter);
    return {
      offered: list.length,
      accepted: list.filter((s) => s.status === 'accepted').length,
      edited: list.filter((s) => s.status === 'edited').length,
      rejected: list.filter((s) => s.status === 'rejected').length,
      pending: list.filter((s) => s.status === 'offered').length,
    };
  };

  const service = {
    authorship(scriptId: string) {
      const script = store.getScript(scriptId);
      if (!script) throw new UserError('That script could not be found.', 404);
      const v = store.currentVersion(scriptId);
      const text = v?.text ?? '';
      const spans = fitSpans(v?.authorship ?? [], text.length);
      return {
        script,
        text,
        ranges: spansToRanges(spans),
        share: authorshipShare(spans),
        suggestions: suggestionCounts({ scriptId }),
        events: store.listLedger({ scriptId, limit: 200 }),
      };
    },

    project(projectId: string) {
      const project = store.getProject(projectId);
      if (!project) throw new UserError('That project could not be found.', 404);
      const scripts = store.listScripts(projectId).map((s) => {
        const v = store.currentVersion(s.id);
        return {
          id: s.id,
          title: s.title,
          share: authorshipShare(fitSpans(v?.authorship ?? [], v?.text.length ?? 0)),
        };
      });
      const total = scripts.reduce(
        (acc, s) => ({
          total: acc.total + s.share.total,
          human: acc.human + s.share.human,
          ai: acc.ai + s.share.ai,
          aiEdited: acc.aiEdited + s.share.aiEdited,
        }),
        { total: 0, human: 0, ai: 0, aiEdited: 0 },
      );
      return {
        project,
        scripts,
        total: {
          ...total,
          humanPercent: total.total ? Math.round((total.human / total.total) * 1000) / 10 : 100,
        },
        suggestions: suggestionCounts({ projectId }),
        events: store.listLedger({ projectId, limit: 200 }),
      };
    },

    disclosure(opts: { projectId?: string; scriptId?: string }): string {
      const now = new Date().toISOString().slice(0, 10);
      const models = new Set<string>();
      const events = opts.scriptId
        ? store.listLedger({ scriptId: opts.scriptId, limit: 1000 })
        : store.listLedger({ projectId: opts.projectId ?? null, limit: 1000 });
      for (const e of events) if (e.model) models.add(e.model);
      const lines: string[] = [];
      if (opts.scriptId) {
        const a = service.authorship(opts.scriptId);
        lines.push(
          `# AI use disclosure: ${a.script.title}`,
          '',
          `Prepared ${now} from the Kathix Provenance Ledger.`,
          '',
        );
        lines.push(
          `- **Written by the creator:** ${a.share.humanPercent}% of the text (${a.share.human} of ${a.share.total} characters).`,
          `- **Suggested by AI and accepted as offered:** ${a.share.total ? Math.round((a.share.ai / a.share.total) * 1000) / 10 : 0}%.`,
          `- **Suggested by AI, then edited by the creator:** ${a.share.total ? Math.round((a.share.aiEdited / a.share.total) * 1000) / 10 : 0}%.`,
          `- **AI suggestions:** ${a.suggestions.offered} offered, ${a.suggestions.accepted} accepted, ${a.suggestions.edited} accepted after editing, ${a.suggestions.rejected} rejected.`,
        );
      } else {
        const p = service.project(opts.projectId as string);
        lines.push(
          `# AI use disclosure: ${p.project.name}`,
          '',
          `Prepared ${now} from the Kathix Provenance Ledger.`,
          '',
        );
        lines.push(
          `- **Written by the creator across all scripts:** ${p.total.humanPercent}% of the text.`,
        );
        for (const s of p.scripts)
          lines.push(`  - ${s.title}: ${s.share.humanPercent}% written by the creator.`);
        lines.push(
          `- **AI suggestions:** ${p.suggestions.offered} offered, ${p.suggestions.accepted} accepted, ${p.suggestions.edited} accepted after editing, ${p.suggestions.rejected} rejected.`,
        );
      }
      lines.push(
        `- **Models used:** ${models.size ? [...models].join(', ') : 'none'}.`,
        '',
        'How AI was used: an AI co-writer proposed text, each proposal showed its reasons and sources, and nothing entered the script without the creator accepting it. Story facts in the canon were approved by the creator one by one. Continuity checks and voice checks only flagged passages for the creator to decide on.',
        '',
      );
      return lines.join('\n');
    },
  };
  return service;
}

export type LedgerService = ReturnType<typeof createLedgerService>;

const serverModule: ServerModule<LedgerService> = {
  manifest,
  createService: createLedgerService,
  routes(app, s, ctx) {
    app.get('/scripts/:id', (c) => c.json(s.authorship(c.req.param('id'))));
    app.get('/project', (c) =>
      c.json(s.project(projectOrScratch(ctx, c.req.query('projectId')).id)),
    );
    app.get('/disclosure.md', (c) => {
      const scriptId = c.req.query('scriptId');
      const md = scriptId
        ? s.disclosure({ scriptId })
        : s.disclosure({ projectId: projectOrScratch(ctx, c.req.query('projectId')).id });
      return c.body(md, 200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': 'attachment; filename="ai-disclosure.md"',
      });
    });
  },
};

export default serverModule;

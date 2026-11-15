import { shortId } from '@kathix/kernel/shared';
import {
  forgeGenerate,
  forgeRefine,
  runTemplate,
  verifyQuote,
  type ForgeKind,
  type ForgeOption,
} from '@kathix/prompts';
import {
  UserError,
  recordLedger,
  type AgentStep,
  type ModuleContext,
  type VoiceApi,
} from '@kathix/platform';
import type { ForgeItem, Project } from '@kathix/store';
import { PLATFORMS, limitFor } from './limits';

export interface ForgeRequest {
  projectId: string;
  scriptId: string | null;
  script: string | null;
  kind: ForgeKind;
  platform: string;
  audience: string;
  tone: string;
  count: number;
  maxChars?: number | null;
}

export interface ScoredOption {
  text: string;
  length: number;
  limit: number;
  scores: { criterion: string; score: number | null; reason: string }[];
  clickbait: boolean;
  missingPayoffs: string[];
  supported: { claim: string; quote: string }[];
}

export function createForgeService(ctx: ModuleContext) {
  const { store } = ctx;

  const scriptText = (req: { scriptId: string | null; script: string | null }) => {
    if (req.scriptId) {
      const text = store.currentVersion(req.scriptId)?.text ?? '';
      if (!text.trim()) throw new UserError('That script is empty.');
      return text;
    }
    if (!req.script?.trim()) throw new UserError('Choose a script or paste one.');
    return req.script;
  };

  /** Code-side checks: length limit, claims traced to the script, voice match. */
  const score = (o: ForgeOption, script: string, limit: number, project: Project): ScoredOption => {
    const supported: { claim: string; quote: string }[] = [];
    const missing: string[] = [];
    for (const c of o.claims) {
      const v = c.scriptQuote.trim() ? verifyQuote(script, c.scriptQuote) : null;
      if (v) supported.push({ claim: c.claim, quote: v.quote });
      else missing.push(c.claim);
    }
    const voice = ctx.use<VoiceApi>('voice');
    const profileId = voice?.activeProfileId(project.id);
    const voiceScore = profileId ? voice?.matchScore(profileId, o.text) : null;
    const honesty = missing.length ? Math.min(o.honesty.score, 3) : o.honesty.score;
    return {
      text: o.text,
      length: o.text.length,
      limit,
      clickbait: missing.length > 0,
      missingPayoffs: missing,
      supported,
      scores: [
        { criterion: 'Clarity', score: o.clarity.score, reason: o.clarity.reason },
        { criterion: 'Curiosity', score: o.curiosity.score, reason: o.curiosity.reason },
        {
          criterion: 'Honesty to the content',
          score: honesty,
          reason: missing.length
            ? `The script never delivers: ${missing.join('; ')}.`
            : o.honesty.reason,
        },
        {
          criterion: 'Voice match',
          score:
            voiceScore === null || voiceScore === undefined ? null : Math.round(voiceScore / 10),
          reason:
            voiceScore === null || voiceScore === undefined
              ? 'No voice profile in this project yet.'
              : `Measured against your voice profile (${voiceScore}/100).`,
        },
      ],
    };
  };

  const save = (
    project: Project,
    scriptId: string | null,
    kind: string,
    req: object,
    options: ScoredOption[],
  ): ForgeItem[] => {
    const batchId = shortId();
    return options.map((o) =>
      store.addForgeItem({
        projectId: project.id,
        scriptId,
        kind,
        text: o.text,
        payload: { ...o, request: req },
        batchId,
      }),
    );
  };

  const service = {
    platforms: () => PLATFORMS,

    async generate(req: ForgeRequest, signal?: AbortSignal) {
      const project = store.getProject(req.projectId);
      if (!project) throw new UserError('That project could not be found.', 404);
      const script = scriptText(req);
      const limit = limitFor(req.platform, req.kind, req.maxChars);
      const voice = ctx.use<VoiceApi>('voice');
      const profileId = voice?.activeProfileId(project.id);
      const input = {
        kind: req.kind,
        platform: PLATFORMS[req.platform]?.label ?? req.platform,
        audience: req.audience,
        tone: req.tone,
        maxChars: limit,
        count: req.count,
        script,
        voice: profileId ? (voice?.promptSummary(profileId) ?? null) : null,
      };
      const kept: ForgeOption[] = [];
      let model = '';
      let provider = '';
      for (let attempt = 0; attempt < 2 && kept.length < req.count; attempt++) {
        const res = await runTemplate(
          ctx.router,
          forgeGenerate,
          { ...input, count: req.count - kept.length },
          { module: 'forge', priority: 'interactive', signal, cache: attempt === 0 },
        );
        model = res.model;
        provider = res.providerId;
        for (const o of res.output.options) {
          const text = o.text.trim();
          // Hard limit: an option over the limit is never shown.
          if (text && text.length <= limit && !kept.some((k) => k.text === text))
            kept.push({ ...o, text });
        }
      }
      if (!kept.length)
        throw new UserError(
          'The model could not write options within the length limit. Try a higher limit or another tone.',
        );
      const scored = kept.slice(0, req.count).map((o) => score(o, script, limit, project));
      const items = save(
        project,
        req.scriptId,
        req.kind,
        req.scriptId ? { ...req, script: null } : req,
        scored,
      );
      recordLedger(ctx, {
        projectId: project.id,
        scriptId: req.scriptId,
        kind: 'forge.generated',
        module: 'forge',
        provider,
        model,
        summary: `Forge offered ${items.length} ${req.kind} options for ${input.platform}`,
      });
      return { items, limit };
    },

    async refine(itemId: string, note: string, signal?: AbortSignal) {
      const item = store.getForgeItem(itemId);
      if (!item) throw new UserError('That option could not be found.', 404);
      const req = (item.payload as { request: ForgeRequest }).request;
      const project = store.getProject(item.projectId) as Project;
      const script = req.scriptId
        ? (store.currentVersion(req.scriptId)?.text ?? '')
        : (req.script ?? '');
      if (!script.trim())
        throw new UserError(
          'The script for this option is no longer available; generate new options instead.',
        );
      const limit = limitFor(req.platform, req.kind, req.maxChars);
      const res = await runTemplate(
        ctx.router,
        forgeRefine,
        {
          kind: req.kind,
          platform: PLATFORMS[req.platform]?.label ?? req.platform,
          audience: req.audience,
          tone: req.tone,
          maxChars: limit,
          count: 3,
          script,
          voice: null,
          favourite: item.text,
          note,
        },
        { module: 'forge', priority: 'interactive', signal, cache: false },
      );
      const scored = res.output.options
        .map((o) => ({ ...o, text: o.text.trim() }))
        .filter((o) => o.text && o.text.length <= limit)
        .map((o) => score(o, script, limit, project));
      if (!scored.length)
        throw new UserError(
          'No refined option fit the length limit. Try again with a different note.',
        );
      return { items: save(project, req.scriptId, req.kind, req, scored) };
    },

    items: (projectId: string, shortlistedOnly: boolean) =>
      store.listForgeItems(projectId, { shortlistedOnly }),

    shortlist(itemId: string, on: boolean) {
      if (!store.getForgeItem(itemId)) throw new UserError('That option could not be found.', 404);
      store.setShortlisted(itemId, on);
      return { ok: true };
    },

    exportShortlist(projectId: string): string {
      const items = store.listForgeItems(projectId, { shortlistedOnly: true });
      const lines = ['# Shortlist', ''];
      for (const i of items) {
        const p = i.payload as unknown as ScoredOption;
        lines.push(
          `- **${i.kind}:** ${i.text} (${i.text.length}/${p.limit} characters)${p.clickbait ? ' — flagged: the script does not deliver every promise' : ''}`,
        );
      }
      return lines.join('\n') + '\n';
    },
  };
  return service;
}

export type ForgeService = ReturnType<typeof createForgeService>;

export function forgeAgentSteps(s: ForgeService, _ctx: ModuleContext): AgentStep[] {
  return [
    {
      id: 'forge.package',
      label: 'Hooks and titles',
      description:
        'Writes title and hook options for the episode, each checked against what the script delivers.',
      order: 50,
      requires: ['model.structured'],
      async run(a) {
        a.reading('the finished draft to package it');
        const titles = await s.generate(
          {
            projectId: a.projectId,
            scriptId: null,
            script: a.workingText,
            kind: 'title',
            platform: 'youtube',
            audience: '',
            tone: '',
            count: 4,
          },
          a.signal,
        );
        const hooks = await s.generate(
          {
            projectId: a.projectId,
            scriptId: null,
            script: a.workingText,
            kind: 'hook',
            platform: 'youtube',
            audience: '',
            tone: '',
            count: 3,
          },
          a.signal,
        );
        const honest = [...titles.items, ...hooks.items].filter(
          (i) => !(i.payload as unknown as ScoredOption).clickbait,
        );
        return {
          summary: `Wrote ${titles.items.length} titles and ${hooks.items.length} hooks; ${honest.length} are fully backed by the script. Open the Forge to shortlist them.`,
          proposedText: null,
          details: {
            titles: titles.items.map((i) => i.text),
            hooks: hooks.items.map((i) => i.text),
          },
        };
      },
    },
  ];
}

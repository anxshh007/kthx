import { runTemplate, voiceDescribe, voiceRewrite } from '@kathix/prompts';
import {
  UserError,
  findInScript,
  recordLedger,
  replaceRange,
  type AgentStep,
  type ModuleContext,
  type VoiceProfilesApi,
} from '@kathix/platform';
import type { Project, VoiceProfile } from '@kathix/store';
import {
  computeMetrics,
  driftReport,
  matchScore,
  profileSummary,
  trainingPairs,
  type DriftLine,
  type VoiceMetrics,
} from './metrics';

const MIN_WORDS = 150;

export function createVoiceService(ctx: ModuleContext) {
  const { store } = ctx;

  const metricsOf = (profile: VoiceProfile): VoiceMetrics | null =>
    profile.metrics as VoiceMetrics | null;

  const describe = async (
    metrics: VoiceMetrics,
    samples: string[],
  ): Promise<{ description: string; traits: string[] }> => {
    if (!ctx.capabilities.has('model.structured')) return { description: '', traits: [] };
    // Only a few short excerpts go to the model; the numbers carry the profile.
    const excerpts = samples
      .map((s) =>
        s
          .split(/(?<=[.!?])\s+/)
          .slice(0, 3)
          .join(' ')
          .slice(0, 400),
      )
      .slice(0, 3);
    const lines = [
      `Average sentence length: ${metrics.sentenceLength.mean} words (spread ${metrics.sentenceLength.sd})`,
      `Point of view: ${metrics.pointOfView.dominant}`,
      `Reading grade: ${metrics.readingGrade}`,
      `Vocabulary richness: ${metrics.vocabularyRichness}`,
      `Punctuation per 1000 words: ${JSON.stringify(metrics.punctuationPer1000)}`,
      `Short sentences: ${Math.round(metrics.pacing.shortSentenceShare * 100)}%`,
      `Contractions per 1000 words: ${metrics.contractionsPer1000}`,
    ].join('\n');
    try {
      const res = await runTemplate(
        ctx.router,
        voiceDescribe,
        { metrics: lines, excerpts },
        { module: 'voice', priority: 'interactive' },
      );
      return res.output;
    } catch {
      return { description: '', traits: [] };
    }
  };

  const recompute = async (profileId: string): Promise<VoiceProfile> => {
    const profile = store.getProfile(profileId);
    if (!profile) throw new UserError('That voice profile could not be found.', 404);
    const samples = store.listSamples(profileId);
    const joined = samples.map((s) => s.text).join('\n\n');
    if (!joined.trim())
      return store.updateProfile(profileId, {
        metrics: null,
        description: '',
        traits: [],
      }) as VoiceProfile;
    const metrics = computeMetrics(joined);
    const d = await describe(
      metrics,
      samples.map((s) => s.text),
    );
    return store.updateProfile(profileId, {
      metrics,
      description: d.description,
      traits: d.traits,
    }) as VoiceProfile;
  };

  const requireProfile = (id: string) => {
    const p = store.getProfile(id);
    if (!p) throw new UserError('That voice profile could not be found.', 404);
    const m = metricsOf(p);
    if (!m) throw new UserError('Add writing samples to this profile first.');
    return { profile: p, metrics: m };
  };

  const analyseText = (metrics: VoiceMetrics, text: string) => {
    if (!text.trim()) throw new UserError('Paste or choose a draft to score.');
    const draft = computeMetrics(text);
    const breakdown = matchScore(metrics, draft);
    const lines = driftReport(metrics, text);
    return {
      ...breakdown,
      lines,
      driftCount: lines.filter((l) => l.drift).length,
      draftWords: draft.wordCount,
    };
  };

  const rewriteLines = async (
    summary: string,
    text: string,
    lines: DriftLine[],
    signal?: AbortSignal,
    priority: 'interactive' | 'background' = 'interactive',
  ) => {
    const drifting = lines.filter((l) => l.drift).slice(0, 8);
    if (!drifting.length) return { rewrites: [], tokens: 0 };
    const res = await runTemplate(
      ctx.router,
      voiceRewrite,
      {
        profile: summary,
        context: text,
        lines: drifting.map((l) => ({ id: `line-${l.index}`, text: l.text, reasons: l.reasons })),
      },
      { module: 'voice', priority, signal, cache: false },
    );
    const byId = new Map(drifting.map((l) => [`line-${l.index}`, l]));
    return {
      rewrites: res.output.rewrites.flatMap((r) => {
        const line = byId.get(r.lineId);
        return line && r.text.trim() && r.text.trim() !== line.text
          ? [{ index: line.index, original: line.text, text: r.text.trim(), reason: r.reason }]
          : [];
      }),
      tokens: res.inputTokens + res.outputTokens,
      model: res.model,
    };
  };

  const service = {
    profiles: (projectId: string) =>
      store.listProfiles(projectId).map((p) => ({
        ...p,
        samples: store.listSamples(p.id).map((s) => ({
          id: s.id,
          title: s.title,
          words: s.text.split(/\s+/).filter(Boolean).length,
          createdAt: s.createdAt,
        })),
      })),

    async createProfile(projectId: string, name: string) {
      if (!store.getProject(projectId))
        throw new UserError('That project could not be found.', 404);
      if (!name.trim()) throw new UserError('Give the profile a name, such as Narrator.');
      return store.createProfile(projectId, name.trim());
    },

    rename: (id: string, name: string) => store.updateProfile(id, { name }),

    remove(id: string) {
      store.deleteProfile(id);
    },

    async addSamples(
      profileId: string,
      samples: { title: string; text: string }[],
      confirmedOwn: boolean,
    ) {
      if (!confirmedOwn) throw new UserError('Please confirm these samples are your own writing.');
      if (!store.getProfile(profileId))
        throw new UserError('That voice profile could not be found.', 404);
      for (const s of samples)
        if (s.text.trim()) store.addSample(profileId, s.title.trim() || 'Sample', s.text, true);
      return recompute(profileId);
    },

    async removeSample(profileId: string, sampleId: string) {
      store.deleteSample(sampleId);
      return recompute(profileId);
    },

    profile(id: string) {
      const p = store.getProfile(id);
      if (!p) throw new UserError('That voice profile could not be found.', 404);
      const m = metricsOf(p);
      const words = m?.wordCount ?? 0;
      return { profile: p, metrics: m, enoughSamples: words >= MIN_WORDS, minimumWords: MIN_WORDS };
    },

    match(profileId: string, text: string) {
      const { metrics } = requireProfile(profileId);
      return analyseText(metrics, text);
    },

    /** Standalone: samples and a draft, nothing stored. */
    matchStandalone(samples: string, text: string, confirmedOwn: boolean) {
      if (!confirmedOwn) throw new UserError('Please confirm the samples are your own writing.');
      if (samples.split(/\s+/).filter(Boolean).length < 60)
        throw new UserError('Paste at least a few paragraphs of your own writing as samples.');
      const metrics = computeMetrics(samples);
      return { ...analyseText(metrics, text), profileMetrics: metrics };
    },

    async rewrites(profileId: string | null, samples: string | null, text: string) {
      const metrics = profileId ? requireProfile(profileId).metrics : computeMetrics(samples ?? '');
      const profile = profileId ? store.getProfile(profileId) : null;
      const summary = profileSummary(
        profile?.name ?? 'Your samples',
        metrics,
        profile?.description ?? '',
      );
      const lines = driftReport(metrics, text);
      return rewriteLines(summary, text, lines);
    },

    acceptRewrite(scriptId: string, original: string, text: string, edited: boolean) {
      const range = findInScript(ctx, scriptId, original);
      if (!range)
        throw new UserError('That line has changed since the check. Score the script again.');
      const version = replaceRange(ctx, {
        scriptId,
        from: range.from,
        to: range.to,
        text,
        origin: edited ? 'ai_edited' : 'ai',
        source: 'suggestion',
        note: 'Accepted a voice rewrite',
      });
      const script = store.getScript(scriptId);
      const sg = store.addSuggestion({
        projectId: script?.projectId ?? null,
        scriptId,
        module: 'voice',
        action: 'voice-rewrite',
        provider: '',
        model: '',
        originalText: original,
        proposedText: text,
        rangeStart: range.from,
        rangeEnd: range.to,
        reason: 'Brings the line back to your voice',
        evidence: [],
      });
      store.decideSuggestion(sg.id, edited ? 'edited' : 'accepted', text);
      recordLedger(ctx, {
        projectId: script?.projectId ?? null,
        scriptId,
        kind: edited ? 'suggestion.edited' : 'suggestion.accepted',
        module: 'voice',
        summary: 'Accepted a voice rewrite',
      });
      return { version };
    },

    dataset(profileId: string): string {
      const p = store.getProfile(profileId);
      if (!p) throw new UserError('That voice profile could not be found.', 404);
      const pairs = trainingPairs(
        store.listSamples(profileId).map((s) => ({ title: s.title, text: s.text })),
      );
      if (!pairs.length)
        throw new UserError('Add longer samples (several paragraphs) to build a training dataset.');
      return pairs.map((x) => JSON.stringify(x)).join('\n') + '\n';
    },
  };
  const api: VoiceProfilesApi = {
    activeProfileId(projectId: string) {
      const project = store.getProject(projectId);
      return project?.settings.activeVoiceProfileId ?? store.listProfiles(projectId)[0]?.id ?? null;
    },
    promptSummary(profileId: string) {
      const p = store.getProfile(profileId);
      const m = p ? metricsOf(p) : null;
      return p && m ? profileSummary(p.name, m, p.description) : null;
    },
    matchScore(profileId: string, text: string) {
      const p = store.getProfile(profileId);
      const m = p ? metricsOf(p) : null;
      return m && text.trim() ? matchScore(m, computeMetrics(text)).score : null;
    },
    async createProfileWithSamples(projectId, name, samples, confirmedOwn) {
      const p = await service.createProfile(projectId, name);
      await service.addSamples(p.id, samples, confirmedOwn);
      return p.id;
    },
  };
  return { ...service, ...api, rewriteLines };
}

export type VoiceService = ReturnType<typeof createVoiceService>;

export function voiceAgentSteps(full: VoiceService, ctx: ModuleContext): AgentStep[] {
  return [
    {
      id: 'voice.check',
      label: 'Voice check',
      description:
        'Scores the draft against your voice profile and proposes rewrites for lines that drift.',
      order: 30,
      requires: ['store.ready'],
      async run(a) {
        const project = ctx.store.getProject(a.projectId) as Project;
        const profileId =
          project.settings.activeVoiceProfileId ?? ctx.store.listProfiles(a.projectId)[0]?.id;
        const profile = profileId ? ctx.store.getProfile(profileId) : null;
        const metrics = profile?.metrics as VoiceMetrics | null;
        if (!profile || !metrics)
          return {
            summary: 'No voice profile with samples exists yet, so the voice check was skipped.',
            proposedText: null,
            details: {},
          };
        a.reading(`your voice profile “${profile.name}”`);
        const lines = driftReport(metrics, a.workingText);
        const score = matchScore(metrics, computeMetrics(a.workingText)).score;
        let fixes: { quote: string; replacement: string; reason: string }[] = [];
        if (ctx.capabilities.has('model.structured') && lines.some((l) => l.drift)) {
          const r = await full.rewriteLines(
            profileSummary(profile.name, metrics, profile.description),
            a.workingText,
            lines,
            a.signal,
            'background',
          );
          a.addTokens(r.tokens);
          fixes = r.rewrites.map((x) => ({
            quote: x.original,
            replacement: x.text,
            reason: x.reason,
          }));
        }
        const drifting = lines.filter((l) => l.drift).length;
        return {
          summary: `Voice match ${score}/100 against “${profile.name}”. ${drifting} line${drifting === 1 ? '' : 's'} drift${drifting === 1 ? 's' : ''}${fixes.length ? `; ${fixes.length} rewrite${fixes.length === 1 ? '' : 's'} proposed` : ''}.`,
          proposedText: null,
          details: { score, drifting, fixes },
        };
      },
    },
  ];
}

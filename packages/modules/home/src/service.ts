import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_TYPES, scriptStats, truncateWords, type ProjectType } from '@kathix/kernel/shared';
import {
  UserError,
  recordLedger,
  saveScriptText,
  type CanonApi,
  type ModuleContext,
  type VoiceProfilesApi,
} from '@kathix/platform';
import type { Project } from '@kathix/store';

export interface NextAction {
  label: string;
  detail: string;
  path: string;
}

export const SAMPLE_NAME = 'The Lantern Keepers (Sample project)';

export function createHomeService(ctx: ModuleContext) {
  const { store } = ctx;

  const service = {
    listProjects: (includeArchived = false) => store.listProjects({ includeArchived }),

    createProject(name: string, type: ProjectType): Project {
      if (!name.trim()) throw new UserError('Give your project a name.');
      const p = store.createProject({ name: name.trim(), type });
      recordLedger(ctx, {
        projectId: p.id,
        scriptId: null,
        kind: 'project.created',
        module: 'home',
        summary: `Created project “${p.name}”`,
      });
      return p;
    },

    updateProject(
      id: string,
      patch: {
        name?: string;
        type?: ProjectType;
        archived?: boolean;
        settings?: Project['settings'];
      },
    ): Project {
      const p = store.updateProject(id, patch);
      if (!p) throw new UserError('That project could not be found.', 404);
      return p;
    },

    deleteProject(id: string): void {
      if (!store.getProject(id)) throw new UserError('That project could not be found.', 404);
      store.deleteProject(id);
    },

    overview(projectId: string) {
      const project = store.getProject(projectId);
      if (!project) throw new UserError('That project could not be found.', 404);
      const scripts = store.listScripts(projectId).map((s) => {
        const v = store.currentVersion(s.id);
        const stats = scriptStats(v?.text ?? '', project.type);
        return {
          ...s,
          words: stats.words,
          runtimeMinutes: stats.runtimeMinutes,
          openIssues: store.listIssues({ projectId, scriptId: s.id, status: 'open' }).length,
        };
      });
      const pendingProposals = store.listProposals(projectId, 'pending').length;
      const entries = store.listEntries(projectId).length;
      const runs = store.listRuns(projectId);
      return {
        project,
        typeInfo: PROJECT_TYPES[project.type],
        scripts,
        counts: {
          pendingProposals,
          entries,
          openIssues: scripts.reduce((n, s) => n + s.openIssues, 0),
          profiles: store.listProfiles(projectId).length,
        },
        nextAction: nextAction(project, scripts, pendingProposals, entries, runs),
        activity: store.listLedger({ projectId, limit: 25 }),
      };
    },

    search(q: string, projectId?: string) {
      const projects = projectId
        ? [store.getProject(projectId)].filter((p): p is Project => !!p)
        : store.listProjects();
      const hits: {
        kind: 'script' | 'canon';
        id: string;
        title: string;
        snippet: string;
        path: string;
        projectId: string;
      }[] = [];
      for (const p of projects) {
        const seen = new Set<string>();
        for (const c of store.searchChunks(p.id, q, 20)) {
          if (c.sourceKind === 'doc' || seen.has(c.sourceId)) continue;
          seen.add(c.sourceId);
          const snippet = truncateWords(c.snippet, 160);
          hits.push(
            c.sourceKind === 'script'
              ? {
                  kind: 'script',
                  id: c.sourceId,
                  title: c.label,
                  snippet,
                  path: `/script?id=${c.sourceId}&at=${c.start}`,
                  projectId: p.id,
                }
              : {
                  kind: 'canon',
                  id: c.sourceId,
                  title: c.label,
                  snippet,
                  path: `/canon?entry=${c.sourceId}`,
                  projectId: p.id,
                },
          );
        }
      }
      return hits.slice(0, 20);
    },

    /** Loads the sample through the same import paths a creator uses. */
    async seedSample(): Promise<Project> {
      const existing = store.listProjects({ includeArchived: true }).find((p) => p.isSample);
      if (existing) {
        if (existing.archived) store.updateProject(existing.id, { archived: false });
        return store.getProject(existing.id) as Project;
      }
      const dir = path.join(ctx.config.rootDir, 'seed', 'sample');
      if (!existsSync(dir))
        throw new UserError('The sample files are missing from this installation.');
      const read = (f: string) => readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
      const canon = ctx.use<CanonApi>('canon');
      const voice = ctx.use<VoiceProfilesApi>('voice');
      const project = store.createProject({ name: SAMPLE_NAME, type: 'podcast', isSample: true });
      if (canon) canon.importBible(project.id, 'Story bible', read('bible.md'), { approve: true });
      const episodes: [string, string, number | null][] = [
        ['episode-1.txt', 'Episode 1: The Bell Before Dark', 1],
        ['episode-2.txt', 'Episode 2: Salt in the Lamp Oil', 2],
        ['episode-3.txt', 'Episode 3: What the Tide Keeps', 3],
        ['episode-4-draft.txt', 'Episode 4: The Second Keeper (draft)', 4],
      ];
      for (const [file, title, episode] of episodes) {
        const script = store.createScript({ projectId: project.id, title, episode });
        saveScriptText(ctx, {
          scriptId: script.id,
          text: read(file),
          authorship: null,
          source: 'import',
          note: 'Imported from the sample files',
        });
      }
      store.addDoc(project.id, 'Episode 5 outline', read('episode-5-outline.txt'));
      if (voice) {
        for (const folder of ['voice-ada', 'voice-bram']) {
          const files = readdirSync(path.join(dir, folder)).filter(
            (f) => f.endsWith('.txt') && !f.startsWith('held-out'),
          );
          const name =
            folder === 'voice-ada' ? 'Narrator (Ada Penhallow)' : 'Field notes (Bram Okafor)';
          await voice.createProfileWithSamples(
            project.id,
            name,
            files.map((f) => ({
              title: f.replace(/\.txt$/, ''),
              text: read(path.join(folder, f)),
            })),
            true,
          );
        }
      }
      recordLedger(ctx, {
        projectId: project.id,
        scriptId: null,
        kind: 'project.created',
        module: 'home',
        summary: 'Loaded the sample project',
      });
      return project;
    },
  };
  return service;
}

function nextAction(
  project: Project,
  scripts: { id: string; title: string; openIssues: number; updatedAt: string }[],
  pendingProposals: number,
  entries: number,
  runs: { id: string; status: string; goal: string }[],
): NextAction {
  const waiting = runs.find((r) => r.status === 'awaiting_approval');
  if (waiting)
    return {
      label: 'Review the Showrunner step waiting for you',
      detail: waiting.goal,
      path: `/showrunner?run=${waiting.id}`,
    };
  if (pendingProposals) {
    return {
      label: `${pendingProposals} unreviewed canon proposal${pendingProposals === 1 ? '' : 's'}`,
      detail: 'Approve what is true to your story; reject the rest.',
      path: '/canon?tab=review',
    };
  }
  const withIssues = scripts
    .filter((s) => s.openIssues)
    .sort((a, b) => b.openIssues - a.openIssues)[0];
  if (withIssues) {
    return {
      label: `${withIssues.title} has ${withIssues.openIssues} open continuity issue${withIssues.openIssues === 1 ? '' : 's'}`,
      detail: 'Each one quotes both passages so you can decide quickly.',
      path: `/continuity?script=${withIssues.id}`,
    };
  }
  if (!entries)
    return {
      label: 'Paste an episode to build your canon',
      detail: 'Kathix proposes characters, places and facts; you approve each one.',
      path: '/canon?tab=import',
    };
  if (!scripts.length) {
    return {
      label: `Write your first ${PROJECT_TYPES[project.type].unit.toLowerCase()}`,
      detail: 'Your co-writer proposes; nothing enters the script unless you accept it.',
      path: '/script?new=1',
    };
  }
  const recent = [...scripts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] as {
    id: string;
    title: string;
  };
  return {
    label: `Continue writing ${recent.title}`,
    detail: 'Pick up where you left off.',
    path: `/script?id=${recent.id}`,
  };
}

export type HomeService = ReturnType<typeof createHomeService>;

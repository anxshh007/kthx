import { CANON_TYPE_LABELS, locateQuote, type CanonType } from '@kathix/kernel/shared';
import type { JobRecord } from '@kathix/kernel';
import { canonExtract, runTemplate } from '@kathix/prompts';
import { indexEntry } from '@kathix/retrieval';
import { UserError, recordLedger, type CanonApi, type ModuleContext } from '@kathix/platform';
import type { CanonEntry, CanonProposal } from '@kathix/store';
import { parseBible } from './bible';

const SEGMENT = 12000;

/** Splits long documents at paragraph breaks so each model call stays small. */
export function segments(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + SEGMENT);
    if (end < text.length) {
      const brk = text.lastIndexOf('\n\n', end);
      if (brk > start + SEGMENT / 2) end = brk;
    }
    out.push({ start, text: text.slice(start, end) });
    start = end;
  }
  return out;
}

export async function extractUploadText(file: {
  name: string;
  text?: string;
  base64?: string;
}): Promise<string> {
  if (file.text !== undefined) return file.text;
  if (!file.base64) throw new UserError('That file was empty.');
  const buf = Buffer.from(file.base64, 'base64');
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const res = await mammoth.extractRawText({ buffer: buf });
    return res.value;
  }
  if (lower.endsWith('.pdf')) {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    const joined = Array.isArray(text) ? text.join('\n\n') : text;
    if (!joined.trim())
      throw new UserError(
        'This PDF has no text in it (it may be scanned images). Try a text-based PDF.',
      );
    return joined;
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return buf.toString('utf8');
  throw new UserError('Kathix reads .txt, .md, .docx and text-based .pdf files.');
}

interface ImportState {
  next: number;
  proposals: number;
  rejected: number;
}

export function createCanonService(ctx: ModuleContext) {
  const { store } = ctx;

  const findEntryByName = (projectId: string, name: string): CanonEntry | null => {
    const n = name.trim().toLowerCase();
    return (
      store
        .listEntries(projectId)
        .find((e) => e.name.toLowerCase() === n || e.aliases.some((a) => a.toLowerCase() === n)) ??
      null
    );
  };

  const linkRelated = (entry: CanonEntry, related: { name: string; relation: string }[]) => {
    for (const r of related) {
      const other = findEntryByName(entry.projectId, r.name);
      if (other && other.id !== entry.id)
        store.addLink(entry.projectId, entry.id, other.id, r.relation);
    }
  };

  ctx.jobs.register('canon.import', async (job: JobRecord, jc) => {
    const input = job.input as { projectId: string; docId: string };
    const doc = store.getDoc(input.docId);
    const project = store.getProject(input.projectId);
    if (!doc || !project) throw new Error('The imported document is no longer available.');
    const parts = segments(doc.text);
    const state: ImportState = (job.state as ImportState | null) ?? {
      next: 0,
      proposals: 0,
      rejected: 0,
    };
    for (let i = state.next; i < parts.length; i++) {
      const part = parts[i] as { start: number; text: string };
      jc.progress(i / parts.length, `Reading part ${i + 1} of ${parts.length}`);
      const existing = [
        ...store.listEntries(project.id).map((e) => e.name),
        ...store.listProposals(project.id, 'pending').map((p) => p.name),
      ];
      const res = await runTemplate(
        ctx.router,
        canonExtract,
        {
          docId: doc.id,
          title: doc.title,
          text: part.text,
          projectType: project.type,
          existingNames: existing,
        },
        { module: 'canon', priority: 'background', signal: jc.signal },
      );
      for (const e of res.output.entries) {
        // Hallucination guard: a proposal must cite a passage that really exists.
        const loc = locateQuote(part.text, e.quote);
        if (!loc || !e.name.trim()) {
          state.rejected++;
          continue;
        }
        const match = findEntryByName(project.id, e.name);
        const duplicate = store
          .listProposals(project.id, 'pending')
          .some(
            (p) =>
              p.name.toLowerCase() === e.name.trim().toLowerCase() &&
              p.start === part.start + loc.start,
          );
        if (duplicate) continue;
        store.addProposal({
          projectId: project.id,
          jobId: job.id,
          type: e.type,
          name: e.name.trim(),
          summary: e.summary,
          attributes: Object.fromEntries(
            e.attributes.filter((a) => a.key.trim()).map((a) => [a.key.trim(), a.value.trim()]),
          ),
          aliases: e.aliases,
          related: e.related,
          sourceDocId: doc.id,
          quote: part.text.slice(loc.start, loc.end),
          start: part.start + loc.start,
          end: part.start + loc.end,
          timelineOrder: e.timelineOrder,
          timelineLabel: e.timelineLabel,
          matchEntryId: match?.id ?? null,
        });
        state.proposals++;
      }
      state.next = i + 1;
      jc.checkpoint(state);
    }
    recordLedger(ctx, {
      projectId: project.id,
      scriptId: null,
      kind: 'canon.proposed',
      module: 'canon',
      summary: `Proposed ${state.proposals} canon entr${state.proposals === 1 ? 'y' : 'ies'} from “${doc.title}”${state.rejected ? ` (${state.rejected} discarded without a verbatim source)` : ''}`,
    });
    return state;
  });

  const createFromProposal = (
    p: CanonProposal,
    edits: Partial<Pick<CanonProposal, 'name' | 'summary' | 'type' | 'attributes'>> = {},
  ): CanonEntry => {
    const src = { ...p, ...edits };
    const entry = store.createEntry({
      projectId: p.projectId,
      type: src.type,
      name: src.name,
      aliases: p.aliases,
      summary: src.summary,
      attributes: src.attributes,
      sourceDocId: p.sourceDocId,
      sourceQuote: p.quote,
      sourceStart: p.start,
      sourceEnd: p.end,
      timelineOrder: p.timelineOrder,
      timelineLabel: p.timelineLabel,
      plantedIn: src.type === 'promise' ? (store.getDoc(p.sourceDocId)?.title ?? '') : '',
    });
    linkRelated(entry, p.related);
    indexEntry(store, entry);
    return entry;
  };

  const service = {
    async importText(
      projectId: string,
      title: string,
      file: { name: string; text?: string; base64?: string },
    ) {
      const project = store.getProject(projectId);
      if (!project) throw new UserError('That project could not be found.', 404);
      const text = (await extractUploadText(file)).replace(/\r\n/g, '\n');
      if (!text.trim()) throw new UserError('There is no text to import.');
      const doc = store.addDoc(projectId, title.trim() || file.name, text);
      const job = ctx.jobs.enqueue(
        'canon.import',
        { projectId, docId: doc.id },
        { projectId, label: `Reading “${doc.title}”`, priority: 'background' },
      );
      return { job, doc: { id: doc.id, title: doc.title } };
    },

    importBible(projectId: string, title: string, text: string, opts: { approve: boolean }) {
      const doc = store.addDoc(projectId, title, text);
      const entries = parseBible(text);
      const ids: string[] = [];
      for (const e of entries) {
        const p = store.addProposal({
          projectId,
          jobId: null,
          type: e.type,
          name: e.name,
          summary: e.summary,
          attributes: e.attributes,
          aliases: e.aliases,
          related: e.related,
          sourceDocId: doc.id,
          quote: e.quote,
          start: e.start,
          end: e.end,
          timelineOrder: e.timelineOrder,
          timelineLabel: e.timelineLabel,
          matchEntryId: findEntryByName(projectId, e.name)?.id ?? null,
        });
        ids.push(p.id);
      }
      let approved = 0;
      if (opts.approve) {
        // Create every entry first so relationships between them resolve.
        const created: [CanonProposal, CanonEntry][] = [];
        for (const id of ids) {
          const p = store.getProposal(id) as CanonProposal;
          const entry = store.createEntry({
            projectId,
            type: p.type,
            name: p.name,
            aliases: p.aliases,
            summary: p.summary,
            attributes: p.attributes,
            sourceDocId: p.sourceDocId,
            sourceQuote: p.quote,
            sourceStart: p.start,
            sourceEnd: p.end,
            timelineOrder: p.timelineOrder,
            timelineLabel: p.timelineLabel,
            plantedIn: entries.find((e) => e.name === p.name)?.plantedIn ?? '',
          });
          store.setProposalStatus(id, 'approved', entry.id);
          created.push([p, entry]);
          approved++;
        }
        for (const [p, entry] of created) {
          linkRelated(entry, p.related);
          indexEntry(store, entry);
        }
      }
      recordLedger(ctx, {
        projectId,
        scriptId: null,
        kind: 'canon.imported',
        module: 'canon',
        summary: `Imported story bible “${title}” (${entries.length} entries)`,
      });
      return { proposals: ids.length, approved };
    },

    proposals: (projectId: string) =>
      store
        .listProposals(projectId, 'pending')
        .map((p) => ({ ...p, docTitle: store.getDoc(p.sourceDocId)?.title ?? '' })),

    approve(
      id: string,
      edits: Partial<Pick<CanonProposal, 'name' | 'summary' | 'type' | 'attributes'>> = {},
    ) {
      const p = store.getProposal(id);
      if (!p || p.status !== 'pending')
        throw new UserError('That proposal was already handled.', 409);
      const entry = createFromProposal(p, edits);
      store.setProposalStatus(id, 'approved', entry.id);
      recordLedger(ctx, {
        projectId: p.projectId,
        scriptId: null,
        kind: 'canon.approved',
        module: 'canon',
        summary: `Approved ${CANON_TYPE_LABELS[entry.type].toLowerCase()} “${entry.name}”`,
      });
      return entry;
    },

    merge(id: string, targetId: string) {
      const p = store.getProposal(id);
      const target = store.getEntry(targetId);
      if (!p || p.status !== 'pending')
        throw new UserError('That proposal was already handled.', 409);
      if (!target || target.projectId !== p.projectId)
        throw new UserError('Choose an entry from this project to merge into.');
      const summary =
        p.summary && !target.summary.includes(p.summary)
          ? `${target.summary} ${p.summary}`.trim()
          : target.summary;
      const aliases = [
        ...new Set([
          ...target.aliases,
          ...p.aliases,
          ...(p.name.toLowerCase() !== target.name.toLowerCase() ? [p.name] : []),
        ]),
      ];
      const updated = store.updateEntry(
        target.id,
        { summary, aliases, attributes: { ...target.attributes, ...p.attributes } },
        `Merged a proposal from “${store.getDoc(p.sourceDocId)?.title ?? 'an import'}”`,
      ) as CanonEntry;
      linkRelated(updated, p.related);
      indexEntry(store, updated);
      store.setProposalStatus(id, 'merged', target.id);
      recordLedger(ctx, {
        projectId: p.projectId,
        scriptId: null,
        kind: 'canon.merged',
        module: 'canon',
        summary: `Merged new detail into “${target.name}”`,
      });
      return updated;
    },

    reject(id: string) {
      const p = store.getProposal(id);
      if (!p || p.status !== 'pending')
        throw new UserError('That proposal was already handled.', 409);
      store.setProposalStatus(id, 'rejected');
      return { ok: true };
    },

    restoreProposal(id: string) {
      const p = store.getProposal(id);
      if (!p || p.status !== 'rejected')
        throw new UserError('That proposal cannot be restored.', 409);
      store.setProposalStatus(id, 'pending');
      return { ok: true };
    },

    bulkApprove(projectId: string, type: CanonType) {
      const list = store.listProposals(projectId, 'pending').filter((p) => p.type === type);
      for (const p of list) {
        const entry = createFromProposal(p);
        store.setProposalStatus(p.id, 'approved', entry.id);
      }
      if (list.length)
        recordLedger(ctx, {
          projectId,
          scriptId: null,
          kind: 'canon.approved',
          module: 'canon',
          summary: `Approved ${list.length} ${CANON_TYPE_LABELS[type].toLowerCase()} proposals`,
        });
      return { approved: list.length };
    },

    entries: (projectId: string) => store.listEntries(projectId),

    entryDetail(id: string) {
      const entry = store.getEntry(id);
      if (!entry) throw new UserError('That entry could not be found.', 404);
      const all = store.listEntries(entry.projectId);
      const links = store
        .listLinks(entry.projectId)
        .filter((l) => l.fromId === id || l.toId === id)
        .map((l) => {
          const otherId = l.fromId === id ? l.toId : l.fromId;
          return {
            ...l,
            otherId,
            otherName: all.find((e) => e.id === otherId)?.name ?? '',
            direction: l.fromId === id ? 'out' : 'in',
          };
        });
      const names = [entry.name, ...entry.aliases, entry.name.split(/\s+/)[0] as string].filter(
        (n) => n.length > 2,
      );
      const re = new RegExp(
        `\\b(${[...new Set(names)].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
        'i',
      );
      const mentions: { scriptId: string; title: string; passage: string; at: number }[] = [];
      for (const s of store.listScripts(entry.projectId)) {
        const text = store.currentVersion(s.id)?.text ?? '';
        let pos = 0;
        for (const line of text.split('\n')) {
          if (re.test(line) && mentions.length < 60)
            mentions.push({ scriptId: s.id, title: s.title, passage: line.trim(), at: pos });
          pos += line.length + 1;
        }
      }
      const doc = entry.sourceDocId ? store.getDoc(entry.sourceDocId) : null;
      return {
        entry,
        links,
        mentions,
        history: store.entryHistory(id),
        sourceTitle: doc?.title ?? 'Written by you',
      };
    },

    createEntry(
      projectId: string,
      input: { type: CanonType; name: string; summary: string; attributes: Record<string, string> },
    ) {
      if (!input.name.trim()) throw new UserError('Give the entry a name.');
      const entry = store.createEntry({
        projectId,
        type: input.type,
        name: input.name.trim(),
        aliases: [],
        summary: input.summary,
        attributes: input.attributes,
        sourceDocId: null,
        sourceQuote: input.summary || input.name,
        sourceStart: null,
        sourceEnd: null,
        timelineOrder: null,
        timelineLabel: '',
        plantedIn: '',
      });
      indexEntry(store, entry);
      recordLedger(ctx, {
        projectId,
        scriptId: null,
        kind: 'canon.created',
        module: 'canon',
        summary: `Added “${entry.name}” to the canon`,
      });
      return entry;
    },

    updateEntry(
      id: string,
      patch: Partial<
        Pick<
          CanonEntry,
          | 'name'
          | 'type'
          | 'summary'
          | 'attributes'
          | 'aliases'
          | 'timelineLabel'
          | 'timelineOrder'
          | 'plantedIn'
          | 'status'
        >
      >,
      change = 'Edited by you',
    ) {
      const entry = store.updateEntry(id, patch, change);
      if (!entry) throw new UserError('That entry could not be found.', 404);
      indexEntry(store, entry);
      recordLedger(ctx, {
        projectId: entry.projectId,
        scriptId: null,
        kind: 'canon.edited',
        module: 'canon',
        summary: `Edited “${entry.name}”`,
      });
      return entry;
    },

    deleteEntry(id: string) {
      const entry = store.getEntry(id);
      if (!entry) throw new UserError('That entry could not be found.', 404);
      store.deleteEntry(id);
      recordLedger(ctx, {
        projectId: entry.projectId,
        scriptId: null,
        kind: 'canon.deleted',
        module: 'canon',
        summary: `Removed “${entry.name}” from the canon`,
      });
    },

    addLink(projectId: string, fromId: string, toId: string, relation: string) {
      if (fromId === toId) throw new UserError('Choose two different entries.');
      return store.addLink(projectId, fromId, toId, relation.trim() || 'related to');
    },

    removeLink: (id: string) => store.removeLink(id),

    timeline: (projectId: string) =>
      store
        .listEntries(projectId)
        .filter((e) => e.type === 'event' || e.timelineOrder !== null)
        .sort(
          (a, b) =>
            (a.timelineOrder ?? Number.MAX_SAFE_INTEGER) -
              (b.timelineOrder ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name),
        ),

    graph(projectId: string) {
      const entries = store.listEntries(projectId);
      const nodes = entries.filter((e) => e.type === 'character' || e.type === 'faction');
      const ids = new Set(nodes.map((n) => n.id));
      return {
        nodes: nodes.map((n) => ({ id: n.id, name: n.name, type: n.type })),
        edges: store.listLinks(projectId).filter((l) => ids.has(l.fromId) && ids.has(l.toId)),
      };
    },

    promises: (projectId: string) =>
      store.listEntries(projectId).filter((e) => e.type === 'promise'),

    exportMarkdown(projectId: string): string {
      const project = store.getProject(projectId);
      const entries = store.listEntries(projectId);
      const links = store.listLinks(projectId);
      const lines = [
        `# ${project?.name ?? 'Story'} — Story bible`,
        '',
        `Exported from Kathix on ${new Date().toISOString().slice(0, 10)}.`,
        '',
      ];
      for (const type of Object.keys(CANON_TYPE_LABELS) as CanonType[]) {
        const list = entries.filter((e) => e.type === type);
        if (!list.length) continue;
        lines.push(`## ${CANON_TYPE_LABELS[type]}s`, '');
        for (const e of list) {
          lines.push(`### ${e.name}${e.aliases.length ? ` (${e.aliases.join(', ')})` : ''}`);
          if (e.summary) lines.push('', e.summary);
          for (const [k, v] of Object.entries(e.attributes)) lines.push(`- **${k}:** ${v}`);
          if (e.timelineLabel) lines.push(`- **When:** ${e.timelineLabel}`);
          if (e.plantedIn)
            lines.push(
              `- **Planted in:** ${e.plantedIn}${e.status === 'paid' ? ' (paid off)' : ''}`,
            );
          for (const l of links.filter((x) => x.fromId === e.id)) {
            lines.push(`- **${l.relation}:** ${entries.find((x) => x.id === l.toId)?.name ?? ''}`);
          }
          lines.push('', `> ${e.sourceQuote.replace(/\n/g, '\n> ')}`, '');
        }
      }
      return lines.join('\n');
    },

    exportJson(projectId: string) {
      return {
        project: store.getProject(projectId),
        entries: store.listEntries(projectId),
        links: store.listLinks(projectId),
        exportedAt: new Date().toISOString(),
      };
    },
  };
  return service;
}

export type CanonService = ReturnType<typeof createCanonService>;
export type { CanonApi };

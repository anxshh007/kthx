import { useEffect, useRef } from 'react';
import {
  Annotation,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  applyAuthorChange,
  classifyLine,
  fitSpans,
  spansToRanges,
  type AuthorSpan,
} from '@kathix/kernel/shared';

/** Marks a transaction that loads text from the server (no authorship change). */
export const remoteLoad = Annotation.define<boolean>();

const lineDeco = {
  heading: Decoration.line({ class: 'k-heading' }),
  note: Decoration.line({ class: 'k-note' }),
};
const speakerMark = Decoration.mark({ class: 'k-speaker' });

/** Styles scene headings, speaker labels and notes; only visible lines are classified. */
const scriptLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const b = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos);
          const k = classifyLine(line.text).kind;
          if (k === 'heading' || k === 'note') b.add(line.from, line.from, lineDeco[k]);
          else if (k === 'speaker')
            b.add(line.from, line.from + line.text.indexOf(':') + 1, speakerMark);
          pos = line.to + 1;
        }
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

const setAiMarks = StateEffect.define<DecorationSet>();
const aiMark = Decoration.mark({ class: 'k-ai' });
const flashMark = Decoration.mark({ class: 'k-flash' });
const setFlash = StateEffect.define<{ from: number; to: number } | null>();

const aiField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setAiMarks)) next = e.value;
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFlash))
        next =
          e.value && e.value.to > e.value.from
            ? Decoration.set([flashMark.range(e.value.from, e.value.to)])
            : Decoration.none;
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function aiDecorations(spans: AuthorSpan[], len: number): DecorationSet {
  const ranges = spansToRanges(fitSpans(spans, len)).filter(
    (r) => r.origin !== 'human' && r.end > r.start,
  );
  return Decoration.set(ranges.map((r) => aiMark.range(r.start, r.end)));
}

export interface EditorHandle {
  view: EditorView;
  getSpans(): AuthorSpan[];
  load(text: string, spans: AuthorSpan[], keepCursor?: boolean): void;
  select(from: number, to: number): void;
  flash(from: number, to: number): void;
}

export function ScriptEditor({
  initialText,
  initialSpans,
  showAi,
  onChange,
  onSelection,
  onReady,
}: {
  initialText: string;
  initialSpans: AuthorSpan[];
  showAi: boolean;
  /** Called after every edit; read the text from the handle when needed. */
  onChange: () => void;
  onSelection: (from: number, to: number) => void;
  onReady: (h: EditorHandle) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const spansRef = useRef<AuthorSpan[]>(fitSpans(initialSpans, initialText.length));
  const handlers = useRef({ onChange, onSelection });
  handlers.current = { onChange, onSelection };
  const showAiRef = useRef(showAi);

  useEffect(() => {
    if (!host.current) return;
    const tracker = EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        const remote = u.transactions.some((t) => t.annotation(remoteLoad));
        if (!remote) {
          // Map authorship through every change; typed text is the creator's.
          const changes: [number, number, number][] = [];
          u.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) =>
            changes.push([fromA, toA, inserted.length]),
          );
          let spans = fitSpans(spansRef.current, u.startState.doc.length);
          for (const [fromA, toA, len] of changes.reverse())
            spans = applyAuthorChange(spans, fromA, toA, len, 'human');
          spansRef.current = spans;
        }
        handlers.current.onChange();
      }
      if (u.selectionSet || u.docChanged) {
        const sel = u.state.selection.main;
        handlers.current.onSelection(sel.from, sel.to);
      }
    });
    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      scriptLines,
      aiField,
      flashField,
      tracker,
      // Browser spellcheck re-scans the editable region on every keystroke; on very long
      // scripts that costs hundreds of milliseconds, so it is kept for normal-length ones.
      EditorView.contentAttributes.of({
        'aria-label': 'Script text',
        spellcheck: initialText.length < 40_000 ? 'true' : 'false',
      }),
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: initialText, extensions }),
      parent: host.current,
    });
    if (showAiRef.current)
      view.dispatch({
        effects: setAiMarks.of(aiDecorations(spansRef.current, initialText.length)),
      });
    onReady({
      view,
      getSpans: () => fitSpans(spansRef.current, view.state.doc.length),
      load(text, spans, keepCursor = true) {
        const head = Math.min(view.state.selection.main.head, text.length);
        spansRef.current = fitSpans(spans, text.length);
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          annotations: remoteLoad.of(true),
          selection: keepCursor ? { anchor: head } : undefined,
          effects: setAiMarks.of(
            showAiRef.current ? aiDecorations(spansRef.current, text.length) : Decoration.none,
          ),
        });
      },
      select(from, to) {
        const len = view.state.doc.length;
        view.dispatch({
          selection: { anchor: Math.min(from, len), head: Math.min(to, len) },
          scrollIntoView: true,
        });
        view.focus();
      },
      flash(from, to) {
        const len = view.state.doc.length;
        view.dispatch({
          effects: [
            setFlash.of({ from: Math.min(from, len), to: Math.min(to, len) }),
            EditorView.scrollIntoView(Math.min(from, len), { y: 'center' }),
          ],
        });
        setTimeout(() => view.dispatch({ effects: setFlash.of(null) }), 1800);
      },
    });
    return () => view.destroy();
  }, []);

  useEffect(() => {
    showAiRef.current = showAi;
  }, [showAi]);

  return <div className="editor" ref={host} />;
}

export function refreshAiMarks(h: EditorHandle, on: boolean): void {
  h.view.dispatch({
    effects: setAiMarks.of(
      on ? aiDecorations(h.getSpans(), h.view.state.doc.length) : Decoration.none,
    ),
  });
}

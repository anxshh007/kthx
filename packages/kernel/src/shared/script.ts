import { PROJECT_TYPES, type ProjectType } from './types';
import { wordCount } from './text';

export type ScriptLineKind = 'heading' | 'speaker' | 'note' | 'text' | 'blank';

export interface ScriptLine {
  kind: ScriptLineKind;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface ScriptScene {
  title: string;
  start: number;
  end: number;
}

const HEADING_RE = /^\s*(?:INT\.|EXT\.|INT\/EXT\.|SCENE\b|#{1,3}\s)/i;
const SPEAKER_RE = /^\s*([A-Z][A-Z0-9 .'-]{1,30}?)(?:\s*\([^)]*\))?:\s*/;
const NOTE_RE = /^\s*\[.*\]\s*$/;

export function classifyLine(line: string): { kind: ScriptLineKind; speaker?: string } {
  if (!line.trim()) return { kind: 'blank' };
  if (HEADING_RE.test(line)) return { kind: 'heading' };
  if (NOTE_RE.test(line)) return { kind: 'note' };
  const sp = SPEAKER_RE.exec(line);
  if (sp && sp[1] && sp[1] === sp[1].toUpperCase() && /[A-Z]{2}/.test(sp[1])) {
    return { kind: 'speaker', speaker: sp[1].trim() };
  }
  return { kind: 'text' };
}

export function parseScript(text: string): { lines: ScriptLine[]; scenes: ScriptScene[] } {
  const lines: ScriptLine[] = [];
  const scenes: ScriptScene[] = [];
  let pos = 0;
  for (const raw of text.split('\n')) {
    const info = classifyLine(raw);
    const line: ScriptLine = { kind: info.kind, start: pos, end: pos + raw.length, text: raw };
    if (info.speaker) line.speaker = info.speaker;
    lines.push(line);
    if (info.kind === 'heading') {
      const prev = scenes[scenes.length - 1];
      if (prev) prev.end = pos;
      scenes.push({ title: raw.replace(/^#+\s*/, '').trim(), start: pos, end: text.length });
    }
    pos += raw.length + 1;
  }
  return { lines, scenes };
}

export interface ScriptStats {
  words: number;
  scenes: number;
  runtimeMinutes: number;
  runtimeLabel: string;
}

export function scriptStats(text: string, type: ProjectType): ScriptStats {
  const info = PROJECT_TYPES[type];
  const { scenes } = parseScript(text);
  const spokenText = text
    .split('\n')
    .filter((l) => {
      const k = classifyLine(l).kind;
      return k === 'speaker' || k === 'text';
    })
    .map((l) => l.replace(SPEAKER_RE, ''))
    .join('\n');
  const w = wordCount(text);
  const counted = type === 'video' || type === 'podcast' ? wordCount(spokenText) : w;
  return {
    words: w,
    scenes: scenes.length,
    runtimeMinutes: Math.round((counted / info.wordsPerMinute) * 10) / 10,
    runtimeLabel: info.runtimeLabel,
  };
}

/** Names of speakers appearing in a span of a script. */
export function speakersIn(text: string): string[] {
  const set = new Set<string>();
  for (const line of text.split('\n')) {
    const info = classifyLine(line);
    if (info.speaker) set.add(info.speaker);
  }
  return [...set];
}

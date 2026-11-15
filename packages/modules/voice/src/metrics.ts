import { classifyLine, splitParagraphs, splitSentences, words } from '@kathix/kernel/shared';

/** Measured voice profile. Everything here is computed in code, never guessed by a model. */
export interface VoiceMetrics {
  wordCount: number;
  sentenceCount: number;
  sentenceLength: { mean: number; sd: number; histogram: { label: string; share: number }[] };
  vocabularyRichness: number;
  readingGrade: number;
  punctuationPer1000: Record<string, number>;
  pointOfView: {
    first: number;
    second: number;
    third: number;
    dominant: 'first person' | 'second person' | 'third person';
  };
  pacing: { sentencesPerParagraph: number; shortSentenceShare: number; dialogueShare: number };
  contractionsPer1000: number;
  signaturePhrases: { phrase: string; count: number }[];
  functionWords: Record<string, number>;
}

const FUNCTION_WORDS =
  'the a an and but or of to in on at for with from by as is was were be been it that this which who what when where how not no so if then than there here very just all some'.split(
    ' ',
  );
const STOP = new Set([
  ...FUNCTION_WORDS,
  'he',
  'she',
  'they',
  'i',
  'you',
  'we',
  'his',
  'her',
  'their',
  'my',
  'your',
  'our',
  'me',
  'him',
  'them',
  'had',
  'has',
  'have',
  'do',
  'did',
  'are',
  'its',
  'into',
  'out',
  'up',
  'down',
  'over',
]);
const PUNCT: Record<string, RegExp> = {
  comma: /,/g,
  semicolon: /;/g,
  colon: /:/g,
  dash: /—|–|\s-\s|--/g,
  exclamation: /!/g,
  question: /\?/g,
  ellipsis: /…|\.\.\./g,
  quote: /["“”]/g,
  parenthesis: /\(/g,
};
const BUCKETS: [string, number, number][] = [
  ['1–5', 1, 5],
  ['6–10', 6, 10],
  ['11–15', 11, 15],
  ['16–20', 16, 20],
  ['21–30', 21, 30],
  ['31+', 31, Infinity],
];

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/** Prose only: script headings, notes and speaker labels are not part of a writing voice. */
export function proseOf(text: string): string {
  return text
    .split('\n')
    .map((l) => {
      const k = classifyLine(l);
      if (k.kind === 'heading' || k.kind === 'note') return '';
      if (k.kind === 'speaker') return l.slice(l.indexOf(':') + 1).trim();
      return l;
    })
    .join('\n');
}

function mattr(tokens: string[], window = 80): number {
  if (tokens.length === 0) return 0;
  if (tokens.length <= window) return new Set(tokens).size / tokens.length;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + window <= tokens.length; i += 10) {
    sum += new Set(tokens.slice(i, i + window)).size / window;
    n++;
  }
  return sum / n;
}

export function computeMetrics(raw: string): VoiceMetrics {
  const text = proseOf(raw);
  const tokens = words(text).map((w) => w.toLowerCase());
  const wc = Math.max(1, tokens.length);
  const sentences = splitSentences(text).filter((s) => words(s.text).length > 0);
  const lengths = sentences.map((s) => words(s.text).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  const sd = Math.sqrt(
    lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lengths.length),
  );
  const per1000 = (n: number) => Math.round((n / wc) * 1000 * 10) / 10;
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const first = tokens.filter((t) =>
    ['i', 'me', 'my', 'mine', 'we', 'us', 'our', "i'm", "i've", "i'd", "i'll"].includes(t),
  ).length;
  const second = tokens.filter((t) =>
    ['you', 'your', 'yours', "you're", "you've"].includes(t),
  ).length;
  const third = tokens.filter((t) =>
    ['he', 'she', 'they', 'him', 'her', 'them', 'his', 'their', 'hers'].includes(t),
  ).length;
  const pov = { first: per1000(first), second: per1000(second), third: per1000(third) };
  const dominant =
    pov.first >= pov.third && pov.first >= pov.second
      ? 'first person'
      : pov.second > pov.third
        ? 'second person'
        : 'third person';
  const syl = tokens.reduce((a, t) => a + syllables(t), 0);
  const grade = 0.39 * (wc / Math.max(1, sentences.length)) + 11.8 * (syl / wc) - 15.59;
  const paragraphs = splitParagraphs(text);
  const dialogueLines = raw
    .split('\n')
    .filter((l) => classifyLine(l).kind === 'speaker' || /["“]/.test(l)).length;
  const nonEmpty = raw.split('\n').filter((l) => l.trim()).length;
  const grams = new Map<string, number>();
  for (const n of [3, 2]) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const g = tokens.slice(i, i + n);
      if (g.every((t) => STOP.has(t))) continue;
      const key = g.join(' ');
      grams.set(key, (grams.get(key) ?? 0) + 1);
    }
  }
  const signature = [...grams.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].split(' ').length - a[0].split(' ').length)
    .filter(([p], i, arr) => !arr.slice(0, i).some(([q]) => q.includes(p)))
    .slice(0, 8)
    .map(([phrase, c]) => ({ phrase, count: c }));
  const fw: Record<string, number> = {};
  for (const f of FUNCTION_WORDS) fw[f] = per1000(tokens.filter((t) => t === f).length);
  return {
    wordCount: tokens.length,
    sentenceCount: sentences.length,
    sentenceLength: {
      mean: Math.round(mean * 10) / 10,
      sd: Math.round(sd * 10) / 10,
      histogram: BUCKETS.map(([label, lo, hi]) => ({
        label,
        share:
          Math.round(
            (lengths.filter((l) => l >= lo && l <= hi).length / Math.max(1, lengths.length)) * 100,
          ) / 100,
      })),
    },
    vocabularyRichness: Math.round(mattr(tokens) * 1000) / 1000,
    readingGrade: Math.round(grade * 10) / 10,
    punctuationPer1000: Object.fromEntries(
      Object.entries(PUNCT).map(([k, re]) => [k, per1000(count(re))]),
    ),
    pointOfView: { ...pov, dominant },
    pacing: {
      sentencesPerParagraph:
        Math.round((sentences.length / Math.max(1, paragraphs.length)) * 10) / 10,
      shortSentenceShare:
        Math.round((lengths.filter((l) => l <= 8).length / Math.max(1, lengths.length)) * 100) /
        100,
      dialogueShare: Math.round((dialogueLines / Math.max(1, nonEmpty)) * 100) / 100,
    },
    contractionsPer1000: per1000(tokens.filter((t) => /'(s|t|re|ve|ll|d|m)$/.test(t)).length),
    signaturePhrases: signature,
    functionWords: fw,
  };
}

const sim = (a: number, b: number, scale: number) => Math.exp(-Math.abs(a - b) / scale);

function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of Object.keys(a)) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface MatchBreakdown {
  score: number;
  features: { label: string; profile: string; draft: string; similarity: number }[];
}

/** 0–100 similarity of a draft to a profile, with a per-feature breakdown. */
export function matchScore(profile: VoiceMetrics, draft: VoiceMetrics): MatchBreakdown {
  const p = profile;
  const d = draft;
  const punctKeys = Object.keys(p.punctuationPer1000);
  const punct =
    punctKeys.reduce(
      (a, k) =>
        a +
        sim(
          p.punctuationPer1000[k] ?? 0,
          d.punctuationPer1000[k] ?? 0,
          Math.max(4, (p.punctuationPer1000[k] ?? 0) * 0.6),
        ),
      0,
    ) / punctKeys.length;
  const features = [
    {
      label: 'Sentence length',
      profile: `${p.sentenceLength.mean} words`,
      draft: `${d.sentenceLength.mean} words`,
      similarity: sim(
        p.sentenceLength.mean,
        d.sentenceLength.mean,
        Math.max(3, p.sentenceLength.sd * 0.6),
      ),
      weight: 3,
    },
    {
      label: 'Sentence rhythm',
      profile: `±${p.sentenceLength.sd}`,
      draft: `±${d.sentenceLength.sd}`,
      similarity: sim(
        p.sentenceLength.sd,
        d.sentenceLength.sd,
        Math.max(2, p.sentenceLength.sd * 0.5),
      ),
      weight: 1,
    },
    {
      label: 'Point of view',
      profile: p.pointOfView.dominant,
      draft: d.pointOfView.dominant,
      similarity:
        (sim(p.pointOfView.first, d.pointOfView.first, 15) +
          sim(p.pointOfView.third, d.pointOfView.third, 15) +
          sim(p.pointOfView.second, d.pointOfView.second, 10)) /
        3,
      weight: 2,
    },
    {
      label: 'Punctuation habits',
      profile: `${p.punctuationPer1000.semicolon ?? 0} ; and ${p.punctuationPer1000.dash ?? 0} dashes per 1000 words`,
      draft: `${d.punctuationPer1000.semicolon ?? 0} ; and ${d.punctuationPer1000.dash ?? 0} dashes`,
      similarity: punct,
      weight: 2,
    },
    {
      label: 'Reading level',
      profile: `grade ${p.readingGrade}`,
      draft: `grade ${d.readingGrade}`,
      similarity: sim(p.readingGrade, d.readingGrade, 2.5),
      weight: 1,
    },
    {
      label: 'Vocabulary richness',
      profile: String(p.vocabularyRichness),
      draft: String(d.vocabularyRichness),
      similarity: sim(p.vocabularyRichness, d.vocabularyRichness, 0.08),
      weight: 1,
    },
    {
      label: 'Contractions',
      profile: `${p.contractionsPer1000} per 1000 words`,
      draft: `${d.contractionsPer1000} per 1000 words`,
      similarity: sim(
        p.contractionsPer1000,
        d.contractionsPer1000,
        Math.max(6, p.contractionsPer1000 * 0.6),
      ),
      weight: 1,
    },
    {
      label: 'Pacing',
      profile: `${Math.round(p.pacing.shortSentenceShare * 100)}% short sentences`,
      draft: `${Math.round(d.pacing.shortSentenceShare * 100)}% short sentences`,
      similarity: sim(p.pacing.shortSentenceShare, d.pacing.shortSentenceShare, 0.2),
      weight: 2,
    },
    {
      label: 'Function-word fingerprint',
      profile: 'your usual mix',
      draft: 'this draft',
      similarity: Math.max(0, (cosine(p.functionWords, d.functionWords) - 0.5) * 2),
      weight: 2,
    },
  ];
  const total = features.reduce((a, f) => a + f.weight, 0);
  const score = Math.round(
    (features.reduce((a, f) => a + f.similarity * f.weight, 0) / total) * 100,
  );
  return {
    score,
    features: features.map(({ weight: _w, ...f }) => ({
      ...f,
      similarity: Math.round(f.similarity * 100) / 100,
    })),
  };
}

export interface DriftLine {
  index: number;
  text: string;
  start: number;
  end: number;
  drift: boolean;
  reasons: string[];
}

/** Sentence-level drift: which lines sound unlike the profile, and why. */
export function driftReport(profile: VoiceMetrics, draftText: string): DriftLine[] {
  const prose = proseOf(draftText);
  const p = profile;
  return splitSentences(prose)
    .filter((s) => words(s.text).length > 0)
    .map((s, index) => {
      const n = words(s.text).length;
      const reasons: string[] = [];
      const sd = Math.max(3, p.sentenceLength.sd);
      if (n > p.sentenceLength.mean + 1.6 * sd)
        reasons.push(
          `much longer than your usual ${Math.round(p.sentenceLength.mean)}-word sentences; this voice uses shorter sentences`,
        );
      if (n < p.sentenceLength.mean - 1.6 * sd && n < 6)
        reasons.push(
          `much shorter than your usual ${Math.round(p.sentenceLength.mean)}-word sentences`,
        );
      const lower = s.text.toLowerCase();
      const tokens = words(lower);
      const firstP = tokens.filter((t) => ['i', 'me', 'my', 'we', 'our'].includes(t)).length;
      const thirdP = tokens.filter((t) =>
        ['he', 'she', 'they', 'his', 'her', 'their'].includes(t),
      ).length;
      if (p.pointOfView.dominant === 'third person' && firstP >= 2 && p.pointOfView.first < 5)
        reasons.push('switches to first person, unlike your third-person narration');
      if (
        p.pointOfView.dominant === 'first person' &&
        thirdP >= 3 &&
        firstP === 0 &&
        p.pointOfView.third < 25
      )
        reasons.push('reads as third-person narration, unlike your first-person voice');
      if (/;/.test(s.text) && (p.punctuationPer1000.semicolon ?? 0) < 0.5)
        reasons.push('uses a semicolon, which you almost never do');
      if (/!/.test(s.text) && (p.punctuationPer1000.exclamation ?? 0) < 0.5)
        reasons.push('uses an exclamation mark, which you almost never do');
      if (/—|–|--/.test(s.text) && (p.punctuationPer1000.dash ?? 0) < 0.5)
        reasons.push('uses a dash, which you rarely do');
      const contractions = tokens.filter((t) => /'(s|t|re|ve|ll|d|m)$/.test(t)).length;
      if (contractions >= 2 && p.contractionsPer1000 < 3)
        reasons.push('uses contractions; your voice spells words out');
      const longWords = tokens.filter((t) => syllables(t) >= 4).length;
      if (longWords >= 3 && p.readingGrade < 8)
        reasons.push('more formal vocabulary than your usual');
      return {
        index,
        text: s.text,
        start: s.start,
        end: s.end,
        drift: reasons.length > 0,
        reasons,
      };
    });
}

/** Short summary given to the co-writer; quotes at most short signature phrases, never sample text. */
export function profileSummary(name: string, m: VoiceMetrics, description: string): string {
  return [
    `Voice profile: ${name}.`,
    description,
    `Point of view: ${m.pointOfView.dominant}.`,
    `Sentences average ${m.sentenceLength.mean} words (spread ±${m.sentenceLength.sd}); ${Math.round(m.pacing.shortSentenceShare * 100)}% are 8 words or fewer.`,
    `Reading level: about grade ${m.readingGrade}.`,
    `Per 1000 words: ${m.punctuationPer1000.comma} commas, ${m.punctuationPer1000.semicolon} semicolons, ${m.punctuationPer1000.dash} dashes, ${m.punctuationPer1000.question} questions, ${m.punctuationPer1000.exclamation} exclamations, ${m.contractionsPer1000} contractions.`,
    m.signaturePhrases.length
      ? `Recurring short phrases: ${m.signaturePhrases
          .slice(0, 4)
          .map((s) => `"${s.phrase}"`)
          .join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Instruction/response pairs for custom-model training, built only from the creator's samples. */
export function trainingPairs(
  samples: { title: string; text: string }[],
): { instruction: string; response: string }[] {
  const out: { instruction: string; response: string }[] = [];
  for (const s of samples) {
    const paras = splitParagraphs(s.text)
      .map((p) => p.text)
      .filter((p) => words(p).length >= 8);
    for (let i = 0; i + 1 < paras.length; i++) {
      out.push({
        instruction: `Continue this passage in my voice.\n\n${paras[i]}`,
        response: paras[i + 1] as string,
      });
    }
    for (const p of paras) {
      const sentences = splitSentences(p);
      if (sentences.length < 3) continue;
      const opening = sentences[0]?.text ?? '';
      out.push({
        instruction: `Write a paragraph in my voice that begins: "${opening}"`,
        response: p,
      });
    }
  }
  return out;
}

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sample } from '../../../../tests/helpers';
import { computeMetrics, driftReport, matchScore, trainingPairs } from '../src/metrics';

const samplesOf = (folder: string) =>
  readdirSync(path.join(ROOT, 'seed', 'sample', folder))
    .filter((f) => !f.startsWith('held-out'))
    .map((f) => sample(`${folder}/${f}`))
    .join('\n\n');

describe('Voice Mirror', () => {
  const ada = computeMetrics(samplesOf('voice-ada'));
  const bram = computeMetrics(samplesOf('voice-bram'));

  it('two clearly different authors produce clearly different profiles', () => {
    expect(ada.sentenceLength.mean).toBeGreaterThan(bram.sentenceLength.mean * 2);
    expect(ada.pointOfView.dominant).toBe('third person');
    expect(bram.pointOfView.dominant).toBe('first person');
    expect(ada.punctuationPer1000.semicolon).toBeGreaterThan(
      bram.punctuationPer1000.semicolon ?? 0,
    );
    expect(bram.contractionsPer1000).toBeGreaterThan(ada.contractionsPer1000);
    expect(matchScore(ada, bram).score).toBeLessThan(60);
  });

  it("a draft by each author scores higher against its own profile than the other's", () => {
    const adaDraft = computeMetrics(sample('voice-ada/held-out-draft.txt'));
    const bramDraft = computeMetrics(sample('voice-bram/held-out-draft.txt'));
    expect(matchScore(ada, adaDraft).score).toBeGreaterThan(matchScore(bram, adaDraft).score);
    expect(matchScore(bram, bramDraft).score).toBeGreaterThan(matchScore(ada, bramDraft).score);
  });

  it('flags drifting lines with reasons', () => {
    const lines = driftReport(
      bram,
      'I walk to the quay. The sea is cold. The harbour, which had for many generations stood patient beneath the lighthouse and its slow turning beam, received the evening as it always had; quietly, and without complaint, and with a kind of grave courtesy.',
    );
    const drifting = lines.filter((l) => l.drift);
    expect(drifting).toHaveLength(1);
    expect(drifting[0]?.reasons.join(' ')).toMatch(/longer|semicolon/);
  });

  it('builds a training dataset only from the samples', () => {
    const pairs = trainingPairs([{ title: 'a', text: samplesOf('voice-ada') }]);
    expect(pairs.length).toBeGreaterThan(3);
    for (const p of pairs) expect(samplesOf('voice-ada')).toContain(p.response);
  });
});

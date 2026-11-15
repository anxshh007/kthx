import { readFileSync, writeFileSync } from 'node:fs';
import type { CliModule } from '@kathix/platform';
import { computeMetrics, trainingPairs } from './metrics';
import type { VoiceService } from './service';

const cli: CliModule = {
  register(program, getContext) {
    const cmd = program
      .command('voice')
      .description('Build a voice profile, score a draft and export a training dataset');
    cmd
      .command('profile <samples...>')
      .description('Standalone: print the measured voice profile of your own sample files')
      .action((files: string[]) => {
        const m = computeMetrics(files.map((f) => readFileSync(f, 'utf8')).join('\n\n'));
        console.log(JSON.stringify(m, null, 2));
      });
    cmd
      .command('match <draft> <samples...>')
      .description(
        'Standalone: score a draft against samples of your own writing, with drifting lines',
      )
      .action(async (draft: string, files: string[]) => {
        const ctx = await getContext();
        const s = ctx.use<VoiceService>('voice') as VoiceService;
        const res = s.matchStandalone(
          files.map((f) => readFileSync(f, 'utf8')).join('\n\n'),
          readFileSync(draft, 'utf8'),
          true,
        );
        console.log(`Voice match: ${res.score}/100`);
        for (const f of res.features)
          console.log(`  ${f.label.padEnd(26)} you: ${f.profile.padEnd(36)} draft: ${f.draft}`);
        for (const l of res.lines.filter((x) => x.drift))
          console.log(`\n  Drifts: “${l.text}”\n    ${l.reasons.join('; ')}`);
      });
    cmd
      .command('dataset <out> <samples...>')
      .description(
        'Standalone: write a JSONL training dataset (instruction/response pairs) from your samples',
      )
      .action((out: string, files: string[]) => {
        const pairs = trainingPairs(
          files.map((f) => ({ title: f, text: readFileSync(f, 'utf8') })),
        );
        writeFileSync(out, pairs.map((p) => JSON.stringify(p)).join('\n') + '\n');
        console.log(`Wrote ${pairs.length} pairs to ${out}`);
      });
  },
};

export default cli;

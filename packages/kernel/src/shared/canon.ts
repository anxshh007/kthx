export interface CanonBlockEntry {
  name: string;
  type: string;
  aliases: string[];
  summary: string;
  attributes: Record<string, string>;
  sourceQuote: string;
}

/** The single text form of a canon entry used in prompts and in evidence checks. */
export function renderCanonBlock(e: CanonBlockEntry): string {
  const lines = [`Name: ${e.name}`, `Type: ${e.type}`];
  if (e.aliases.length) lines.push(`Also called: ${e.aliases.join(', ')}`);
  if (e.summary) lines.push(`Summary: ${e.summary}`);
  for (const [k, v] of Object.entries(e.attributes)) lines.push(`${k}: ${v}`);
  if (e.sourceQuote) lines.push(`Source passage: "${e.sourceQuote}"`);
  return lines.join('\n');
}

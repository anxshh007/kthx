const SECRET_PATTERNS = [
  /sk-[\w-]{8,}/g,
  /sk-ant-[\w-]{8,}/g,
  /pt_live_[\w-]{6,}/g,
  /AIza[\w-]{20,}/g,
  /gsk_[A-Za-z0-9]{10,}/g,
  /(Bearer\s+)[\w.-]{8,}/g,
  /(x-api-key["']?\s*[:=]\s*["']?)[\w.-]{8,}/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, prefix?: string) =>
      typeof prefix === 'string' && m.startsWith(prefix) ? `${prefix}[redacted]` : '[redacted]',
    );
  }
  return out;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export function createLogger(scope: string, minLevel: Level = 'info'): Logger {
  const silent = process.env.KATHIX_LOG === 'silent';
  const emit = (level: Level, msg: string, data?: unknown) => {
    if (silent || ORDER[level] < ORDER[minLevel]) return;
    const extra =
      data === undefined
        ? ''
        : ' ' + (data instanceof Error ? data.message : JSON.stringify(data, null, 0));
    const line = redact(
      `[${new Date().toISOString()}] ${level.toUpperCase()} ${scope}: ${msg}${extra}`,
    );
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  };
  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
  };
}

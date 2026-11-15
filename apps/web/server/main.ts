import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRequestListener } from '@hono/node-server';
import { createRuntime } from '@kathix/runtime';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const distDir = path.join(webRoot, 'dist');
const dev = process.argv.includes('--dev');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  let file = path.normalize(path.join(distDir, rel));
  if (!file.startsWith(distDir)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(distDir, 'index.html');
  const ext = path.extname(file);
  const immutable = rel.startsWith('assets/') || rel.startsWith('backgrounds/');
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(readFileSync(file));
}

async function main() {
  const runtime = await createRuntime();
  const { port, host } = runtime.ctx.config;
  const api = getRequestListener(runtime.app.fetch);
  let frontend: (req: IncomingMessage, res: ServerResponse) => void;

  if (dev) {
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({
      configFile: path.join(webRoot, 'vite.config.ts'),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    frontend = (req, res) => vite.middlewares(req, res);
  } else {
    if (!existsSync(path.join(distDir, 'index.html'))) {
      console.error(
        'The Studio has not been built yet. Run `pnpm start` from the repository root.',
      );
      process.exit(1);
    }
    frontend = serveStatic;
  }

  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/')) void api(req, res);
    else frontend(req, res);
  });
  server.listen(port, host, () => {
    console.log(
      `Kathix Studio is running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
    );
  });
  void runtime.refreshCapabilities();

  const shutdown = () => {
    server.close();
    runtime.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();

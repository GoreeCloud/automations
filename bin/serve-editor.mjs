/** Development-only loopback static server; no API, writes, execution or remote access. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const routes = Object.freeze({
  '/': ['web/index.html', 'text/html; charset=utf-8'],
  '/web/editor.css': ['web/editor.css', 'text/css; charset=utf-8'],
  '/web/editor.mjs': ['web/editor.mjs', 'text/javascript; charset=utf-8'],
  '/web/editor-state.mjs': ['web/editor-state.mjs', 'text/javascript; charset=utf-8'],
  '/src/engine.mjs': ['src/engine.mjs', 'text/javascript; charset=utf-8'],
  '/examples/action-catalog.json': ['examples/action-catalog.json', 'application/json; charset=utf-8'],
});

export function makeEditorServer() {
  return createServer(async (request, response) => {
    const headers = {
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
    };
    const path = request.url?.split('?')[0];
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...headers, Allow: 'GET, HEAD' }); response.end(); return;
    }
    if (!Object.hasOwn(routes, path)) {
      response.writeHead(404, headers); response.end(); return;
    }
    const [file, contentType] = routes[path];
    try {
      const buffer = await readFile(resolve(root, file));
      response.writeHead(200, { ...headers, 'Content-Type': contentType, 'Content-Length': buffer.length });
      response.end(request.method === 'HEAD' ? undefined : buffer);
    } catch {
      response.writeHead(503, headers); response.end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = process.argv[2] === undefined ? 4173 : Number(process.argv[2]);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    process.stderr.write('Port must be an integer from 0 to 65535.\n'); process.exitCode = 1;
  } else {
    makeEditorServer().listen(port, '127.0.0.1', function () {
      process.stdout.write(`GoreeCloud Automations development editor: http://127.0.0.1:${this.address().port}/\n`);
    });
  }
}

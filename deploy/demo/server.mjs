import http from 'node:http';
import { readFile } from 'node:fs/promises';

// Static frontend only. There is deliberately no upload, OCR or model endpoint.
const html = await readFile('/app/public/index.html');
const server = http.createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  if (path === '/healthz') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"ok":true,"mode":"fictional-frontend-demo"}'); return; }
  if (!['GET', 'HEAD'].includes(request.method) || path.startsWith('/api/') || !['/', '/index.html'].includes(path)) {
    response.writeHead(404, { 'Content-Type': 'application/json' }); response.end('{"detail":"Static demonstration only; no live API."}'); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-cache' });
  response.end(request.method === 'HEAD' ? undefined : html);
});
server.listen(8080, '0.0.0.0');
process.on('SIGTERM', () => server.close());

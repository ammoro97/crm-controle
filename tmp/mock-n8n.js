const http = require('http');
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk.toString()));
  req.on('end', () => {
    console.log('[MOCK_N8N] REQUEST', req.method, req.url, body || '{}');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});
server.listen(4001, '127.0.0.1', () => {
  console.log('[MOCK_N8N] listening on 4001');
});

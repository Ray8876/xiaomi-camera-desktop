const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {WebSocket, WebSocketServer} = require('ws');
const FILES = new Map([['/', 'index.html'], ['/app.js', 'app.js'], ['/style.css', 'style.css'], ['/player.js', 'player.js'], ['/video-rtc.js', 'video-rtc.js'], ['/logo.svg', 'logo.svg']]);
const MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'};
async function createGateway({uiDir, engine, logs, allowedSource}) {
  const token = crypto.randomBytes(32).toString('hex');
  let origin, count = 0;
  const sockets = new Set();
  const authorized = req => req.headers.host === new URL(origin).host && req.headers.cookie?.split(';').some(c => c.trim() === `mi_session=${token}`);
  const server = http.createServer((req, res) => {
    if (!authorized(req)) {res.writeHead(403); res.end(); return;}
    const filename = FILES.get(req.url);
    if (req.method !== 'GET' || !filename) {res.writeHead(404); res.end(); return;}
    res.writeHead(200, {'Content-Type': MIME[path.extname(filename)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
    fs.createReadStream(path.join(uiDir, filename)).pipe(res);
  });
  const wss = new WebSocketServer({noServer: true, maxPayload: 2 * 1024 * 1024});
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const u = new URL(req.url, origin);
    const source = u.searchParams.get('src');
    if (!authorized(req) || req.headers.origin !== origin || u.pathname !== '/api/ws' || u.searchParams.size !== 1 || !source || !allowedSource(source) || count >= 16) {socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return;}
    wss.handleUpgrade(req, socket, head, client => {
      count++; sockets.add(client);
      const upstream = new WebSocket(engine.base.replace('http:', 'ws:') + '/api/ws?src=' + encodeURIComponent(source), {headers: {Authorization: engine.authorization}, maxPayload: 16 * 1024 * 1024});
      let queue = [];
      const forward = data => {if (upstream.readyState === WebSocket.OPEN) upstream.send(data); else if (queue.length < 8) queue.push(data);};
      client.on('message', (data, binary) => {
        if (binary) {client.close(1008); return;}
        try {const msg = JSON.parse(data); if (!['mse', 'webrtc/offer', 'webrtc/candidate', 'webrtc'].includes(msg.type)) {client.close(1008); return;}} catch {client.close(1008); return;}
        forward(data.toString());
      });
      upstream.on('open', () => {for (const data of queue) upstream.send(data); queue = [];});
      upstream.on('message', (data, binary) => {if (client.readyState === WebSocket.OPEN) client.send(data, {binary});});
      upstream.on('error', () => {logs.write('warn', 'playback_transport_error'); client.close(1011);});
      upstream.on('close', () => client.close());
      client.on('error', () => upstream.close());
      client.on('close', () => {count--; sockets.delete(client); upstream.close();});
    });
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  origin = `http://127.0.0.1:${server.address().port}`;
  return {origin, token, close: () => {for (const socket of sockets) socket.terminate(); wss.close(); server.close();}};
}
module.exports = {createGateway};

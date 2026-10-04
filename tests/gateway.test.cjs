const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const {WebSocketServer, WebSocket} = require('ws');
const {createGateway} = require('../desktop/gateway.cjs');
const camera = 'cam_0123456789abcdef';
test('gateway rejects unauthenticated HTTP, traversal, cross-origin and unknown sources', async () => {
  const server = http.createServer(); const upstream = new WebSocketServer({server});
  upstream.on('connection', socket => socket.on('message', message => socket.send(message)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const g = await createGateway({uiDir: path.join(__dirname, '..', 'ui'), engine: {base: `http://127.0.0.1:${server.address().port}`, authorization: 'Basic test'}, logs: {write() {}}, allowedSource: src => src === camera});
  const headers = {Cookie: `mi_session=${g.token}`};
  const connect = (source, origin = g.origin, cookie = headers.Cookie) => new Promise(resolve => {
    const socket = new WebSocket(g.origin.replace('http:', 'ws:') + '/api/ws?src=' + source, {origin, headers: {Cookie: cookie}});
    socket.on('unexpected-response', (_req, r) => {r.resume(); resolve(r.statusCode); socket.terminate();});
    socket.on('error', () => {}); socket.on('open', () => {socket.close(); resolve(101);});
  });
  try {
    assert.equal((await fetch(g.origin + '/')).status, 403);
    assert.equal((await fetch(g.origin + '/', {headers})).status, 200);
    assert.equal((await fetch(g.origin + '/desktop/main.cjs', {headers})).status, 404);
    assert.equal(await connect(camera, 'https://example.com'), 403);
    assert.equal(await connect('invalid'), 403);
    assert.equal(await connect(camera, g.origin, ''), 403);
    assert.equal(await connect(camera), 101);
  } finally {g.close(); upstream.close(); server.close();}
});

/*
 * Technically Not tools · desktop-check/opencode-stand-in.js — A stand-in for the server an
 * OpenCode terminal panel runs, for checks of desktop/opencode-link.js and what is wired to it
 * (opencode-link-check.js, tests/agent-permissions.main.js): basic auth, one event stream,
 * /global/health and /doc, the lists a reconnect reads, and a record of every call. No real CLI, no
 * model.
 */
'use strict';
const http = require('http');
const link = require('../../desktop/opencode-link');

// An API description that holds everything the link's contract names (what a good OpenCode version
// answers on /doc).
function goodDoc() {
  const doc = {
    paths: {},
    components: {
      schemas: {
        SessionStatus: { anyOf: [{ enum: ['idle'] }, { enum: ['busy'] }, { enum: ['retry'] }] },
        StepFinishPart: { properties: { tokens: {}, cost: {} } },
      },
    },
  };
  for (const [method, route] of link.CONTRACT.routes)
    (doc.paths[route] = doc.paths[route] || {})[method.toLowerCase()] = {};
  doc.paths['/permission/{requestID}/reply'].post = {
    requestBody: {
      content: {
        'application/json': { schema: { properties: { reply: { enum: link.CONTRACT.replies } } } },
      },
    },
  };
  link.CONTRACT.events.forEach((name, i) => {
    doc.components.schemas['E' + i] = { properties: { type: { enum: [name] }, properties: {} } };
  });
  return doc;
}

// s.send(type, properties) pushes an event; s.drop() ends the stream; s.calls lists every POST;
// s.failPosts = true answers POSTs with 500.
function standIn(password) {
  const auth = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
  const s = {
    calls: [],
    streams: new Set(),
    permissions: [],
    questions: [],
    status: {},
    parents: {},
    requests: 0,
    greet: true,
    version: '9.9.9',
    doc: goodDoc(),
    docReads: 0,
    failPosts: false,
  };
  s.server = http.createServer((req, res) => {
    s.requests++;
    if (req.headers.authorization !== auth) {
      res.writeHead(401);
      return res.end('Unauthorized');
    }
    const url = req.url.split('?')[0];
    let body = '';
    req.on('data', d => {
      body += d;
    });
    req.on('end', () => {
      const json = data => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.method === 'GET' && url === '/event') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        s.streams.add(res);
        res.on('close', () => s.streams.delete(res));
        if (s.greet)
          res.write(
            'data: ' +
              JSON.stringify({ id: 'evt_0', type: 'server.connected', properties: {} }) +
              '\n\n'
          );
        else res.write('data: {"type":"something.else","properties":{}}\n\n');
        return;
      }
      if (req.method === 'GET' && url === '/global/health')
        return json({ healthy: true, version: s.version });
      if (req.method === 'GET' && url === '/doc') {
        s.docReads++;
        return json(s.doc);
      }
      if (req.method === 'GET' && url === '/permission') return json(s.permissions);
      if (req.method === 'GET' && url === '/question') return json(s.questions);
      if (req.method === 'GET' && url === '/session/status') return json(s.status);
      let m;
      if (req.method === 'GET' && (m = url.match(/^\/session\/([^/]+)\/children$/)))
        return json([{ id: 'ses_kid', parentID: m[1], title: 'explore' }]);
      if (req.method === 'GET' && (m = url.match(/^\/session\/([^/]+)$/)))
        return json({ id: m[1], ...(s.parents[m[1]] ? { parentID: s.parents[m[1]] } : {}) });
      if (req.method === 'POST') {
        s.calls.push({ url, body: body ? JSON.parse(body) : null });
        if (s.failPosts) {
          res.writeHead(500);
          return res.end('no');
        }
        return json(true);
      }
      res.writeHead(404);
      res.end();
    });
  });
  s.send = (type, properties) => {
    for (const res of s.streams)
      res.write('data: ' + JSON.stringify({ id: 'evt_x', type, properties }) + '\r\n\r\n');
  };
  s.drop = () => {
    for (const res of [...s.streams]) res.destroy();
  };
  s.listen = () =>
    new Promise(r =>
      s.server.listen(0, '127.0.0.1', () => {
        s.port = s.server.address().port;
        r(s);
      })
    );
  s.close = () =>
    new Promise(r => {
      s.drop();
      s.server.closeAllConnections?.();
      s.server.close(() => r());
    });
  return s;
}

module.exports = { standIn, goodDoc };

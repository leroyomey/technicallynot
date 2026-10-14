// Tiny Cloudflare Durable Object stand-in (tests only), beside d1-shim.mjs: a namespace, the
// object's state with key-value storage, WebSocketPair and the Hibernation API calls relay.js uses.
// Plain Node has none of them. hibernate() throws the object away and keeps what Cloudflare keeps
// (sockets, their attachments and tags, storage), so a test can prove the relay holds nothing in
// memory. `wakes` counts every call into the object: an auto-answered "ping" must not raise it.

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.inbox = [];
    this.closed = null;
    this.peer = null;
    this.state = null;
    this.attachment = null;
    this.tags = [];
  }
  serializeAttachment(v) {
    this.attachment = structuredClone(v);
  }
  deserializeAttachment() {
    return structuredClone(this.attachment);
  }

  // Server side → the client's inbox.
  send(text) {
    if (this.readyState !== 1) throw new TypeError('socket is closed');
    this.peer.inbox.push(text);
  }
  close(code, reason) {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.peer.readyState = 3;
    this.peer.closed = { code, reason };
    this.state?.sockets.delete(this);
  }

  // Client side (what a test drives): a message or a close reaches the object the way Cloudflare
  // delivers it.
  async put(text) {
    const s = this.peer.state;
    if (this.readyState !== 1) throw new Error('client socket is closed');
    if (s.auto && text === s.auto.request) {
      this.inbox.push(s.auto.response);
      return;
    } // answered by the runtime, the object sleeps on
    await s.ns.wake(s).webSocketMessage(this.peer, text);
  }
  async hangUp(code = 1000) {
    const s = this.peer.state,
      server = this.peer;
    this.readyState = 3;
    server.readyState = 2; // closing: gone from "open", still listed while its close handler runs
    await s.ns.wake(s).webSocketClose(server, code, '', true);
    server.readyState = 3;
    s.sockets.delete(server);
  }
  json() {
    return this.inbox.map(x => JSON.parse(x));
  }
}

class FakeState {
  constructor(ns, name) {
    this.ns = ns;
    this.name = name;
    this.sockets = new Set();
    this.auto = null;
    this.kv = new Map();
    this.writes = 0;
    const kv = this.kv,
      self = this;
    this.storage = {
      async get(k) {
        return kv.has(k) ? structuredClone(kv.get(k)) : undefined;
      },
      async put(k, v) {
        self.writes++;
        kv.set(k, structuredClone(v));
      },
      async delete(k) {
        self.writes++;
        return kv.delete(k);
      },
      async list({ prefix = '' } = {}) {
        return new Map(
          [...kv]
            .filter(([k]) => k.startsWith(prefix))
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([k, v]) => [k, structuredClone(v)])
        );
      },
    };
  }
  acceptWebSocket(ws, tags = []) {
    ws.state = this;
    ws.tags = tags;
    this.sockets.add(ws);
  }
  getWebSockets(tag) {
    return [...this.sockets].filter(ws => !tag || ws.tags.includes(tag));
  }
  setWebSocketAutoResponse(pair) {
    this.auto = pair;
  }
}

export function createHubNamespace(Class, envOf) {
  const states = new Map(),
    live = new Map();
  const ns = {
    wakes: 0,
    idFromName: name => name,
    wake(state) {
      ns.wakes++;
      if (!live.has(state.name)) live.set(state.name, new Class(state, envOf()));
      return live.get(state.name);
    },
    get(id) {
      if (!states.has(id)) states.set(id, new FakeState(ns, id));
      return { fetch: request => ns.wake(states.get(id)).fetch(request) };
    },
    hibernate() {
      live.clear();
    },
    state: id => states.get(id),
    objects: () => states.size,
  };
  return ns;
}

// Globals the Workers runtime provides. Node's Response refuses status 101 and knows no
// `webSocket`, so upgrades get a stand-in.
export function installWorkerGlobals() {
  globalThis.WebSocketPair = class {
    constructor() {
      const a = new FakeSocket(),
        b = new FakeSocket();
      a.peer = b;
      b.peer = a;
      this[0] = a;
      this[1] = b;
    }
  };
  globalThis.WebSocketRequestResponsePair = class {
    constructor(request, response) {
      this.request = request;
      this.response = response;
    }
  };
  const Real = globalThis.Response;
  globalThis.Response = class extends Real {
    constructor(body, init = {}) {
      if (init?.status !== 101) {
        super(body, init);
        return;
      }
      super(null, { ...init, status: 200 });
      Object.defineProperty(this, 'status', { value: 101 });
      this.webSocket = init.webSocket;
    }
  };
}

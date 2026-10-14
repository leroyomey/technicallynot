// Technically Not · 00-desktop-bridge.js — In the desktop app, backs the project folder with real
// disk access (window.tnaiNative) using File System Access–shaped handles, so 09-project-folder.js
// runs unchanged (a handle may point into a Technically Not worktree: tnaiLane). No-op in a
// browser.
(() => {
  const native = window.tnaiNative;
  if (!native) return;
  document.documentElement.dataset.runtime = 'desktop';

  // Electron has no prompt(); the desktop process shows a real dialog
  window.prompt = (message, value) => native.prompt(message, value);

  const fail = error => {
    const e = new Error(error?.message || 'File operation failed.');
    e.name = error?.name || 'Error';
    return e;
  };
  const unwrap = async promise => {
    const r = await promise;
    if (!r?.ok) throw fail(r?.error);
    return r.value;
  };
  const join = (dir, name) => (dir ? dir + '/' + name : name);

  class NativeBlob {
    constructor(rel, start, end, name, lastModified, lane) {
      Object.assign(this, { rel, start, end, name, lastModified, lane, type: '' });
      this.size = end - start;
    }
    slice(a = 0, b = this.size) {
      const clamp = v => Math.min(this.size, Math.max(0, v < 0 ? this.size + v : v));
      return new NativeBlob(
        this.rel,
        this.start + clamp(a),
        this.start + Math.max(clamp(a), clamp(b)),
        this.name,
        this.lastModified,
        this.lane
      );
    }
    async arrayBuffer() {
      const bytes = await unwrap(native.fs.read(this.rel, this.start, this.end, this.lane));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    async text() {
      return new TextDecoder().decode(await this.arrayBuffer());
    }
  }

  const permission = async () => ((await native.fs.root()) ? 'granted' : 'denied');

  class NativeFileHandle {
    constructor(name, rel, lane) {
      this.kind = 'file';
      this.name = name;
      this.tnaiPath = rel;
      this.tnaiLane = lane || '';
    }
    queryPermission() {
      return permission();
    }
    requestPermission() {
      return permission();
    }
    async getFile() {
      const st = await unwrap(native.fs.stat(this.tnaiPath, this.tnaiLane));
      return new NativeBlob(this.tnaiPath, 0, st.size, this.name, st.lastModified, this.tnaiLane);
    }
    async createWritable() {
      const rel = this.tnaiPath,
        lane = this.tnaiLane,
        parts = [];
      return {
        async write(data) {
          parts.push(
            typeof data === 'string'
              ? new TextEncoder().encode(data)
              : new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer || data)
          );
        },
        async close() {
          const total = parts.reduce((n, p) => n + p.byteLength, 0),
            bytes = new Uint8Array(total);
          let at = 0;
          for (const p of parts) {
            bytes.set(p, at);
            at += p.byteLength;
          }
          await unwrap(native.fs.write(rel, bytes, lane));
        },
        async abort() {
          parts.length = 0;
        },
      };
    }
  }

  class NativeDirectoryHandle {
    constructor(name, rel, lane) {
      this.kind = 'directory';
      this.name = name;
      this.tnaiPath = rel;
      this.tnaiLane = lane || '';
    }
    queryPermission() {
      return permission();
    }
    requestPermission() {
      return permission();
    }
    async *values() {
      for (const entry of await unwrap(native.fs.list(this.tnaiPath, this.tnaiLane))) {
        const rel = join(this.tnaiPath, entry.name);
        yield entry.kind === 'directory'
          ? new NativeDirectoryHandle(entry.name, rel, this.tnaiLane)
          : new NativeFileHandle(entry.name, rel, this.tnaiLane);
      }
    }
  }

  const baseName = full => String(full).split(/[\\/]/).filter(Boolean).pop() || String(full);

  window.showDirectoryPicker = async () => {
    const picked = await unwrap(native.fs.pick());
    if (!picked) {
      const e = new Error('The user cancelled the folder picker.');
      e.name = 'AbortError';
      throw e;
    }
    return new NativeDirectoryHandle(baseName(picked), '');
  };

  window.TnaiDesktop = {
    // The desktop process remembers the connected folder, so it (not IndexedDB) decides what is
    // restored.
    async revive() {
      const root = await native.fs.root();
      return root ? new NativeDirectoryHandle(baseName(root), '') : null;
    },
    forget: () => native.fs.forget(),
    rootPath: () => native.fs.root(),
    // A new project from just a name: the desktop process makes the folder in Documents\Technically
    // Not and opens it (errors throw, with a plain message). "Show folder": opens a listed
    // project's folder in the PC's file manager (errors throw, with a plain message).
    showFolder: target => unwrap(native.fs.reveal(target)),
    async createProject(name) {
      const made = await unwrap(native.fs.create(name));
      return new NativeDirectoryHandle(baseName(made), '');
    },
    // Open projects (fs-service.js): each resolves to { active, projects: [{ path, name, active,
    // missing }] }; errors throw.
    projects: () => unwrap(native.fs.projects()),
    switchTo: target => unwrap(native.fs.switchTo(target)),
    remove: target => unwrap(native.fs.remove(target)),
    // The project's Technically Not worktrees ([{ id, dir, branch }], fs:lanes) and a handle on
    // one's folder: the rail's Main | ⎇ … toggle (09). Every call through that handle carries the
    // worktree's folder (tnaiLane); fs-service allows only known worktrees of the connected repo.
    lanes: async () => (native.fs.lanes ? (await native.fs.lanes()) || [] : []),
    laneRoot: lane => new NativeDirectoryHandle(baseName(lane.dir), '', lane.dir),
  };
})();

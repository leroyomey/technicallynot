/*
 * Technically Not tools · desktop-check/tests/thread-stream-leak.main.js — Main-process side of
 * thread-stream-leak.js. It reuses agent-soak's helpers (the output printer, one simulated Claude
 * Code task per thread over the real hook server, memory samples after a forced GC in both
 * processes) and takes heap snapshots of the window, counting its live objects by kind and
 * constructor, so the test can see what grew between two snapshots. No agent CLI runs and no
 * prompt reaches a model.
 */
'use strict';

module.exports = (win, profile) => {
  const soak = require('./agent-soak.main.js')(win, profile);
  const snapshots = new Map();

  const debuggerOf = () => {
    const devtools = win.webContents.debugger;
    if (!devtools.isAttached()) devtools.attach('1.3');
    return devtools;
  };

  // One heap snapshot after a forced GC: a map of "type:constructor" to [count, self bytes].
  // Strings are counted together, by type only.
  async function takeSnapshot() {
    const devtools = debuggerOf();
    let chunks = [];
    const onChunk = (event, method, params) => {
      if (method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(params.chunk);
    };
    devtools.on('message', onChunk);
    await devtools.sendCommand('HeapProfiler.enable');
    await devtools.sendCommand('HeapProfiler.collectGarbage');
    await devtools.sendCommand('HeapProfiler.collectGarbage');
    await devtools.sendCommand('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    devtools.removeListener('message', onChunk);
    const snap = JSON.parse(chunks.join(''));
    chunks = null;
    const meta = snap.snapshot.meta;
    const fieldCount = meta.node_fields.length;
    const sizeField = meta.node_fields.indexOf('self_size');
    const idField = meta.node_fields.indexOf('id');
    const byKind = new Map();
    const nodes = snap.nodes;

    // The ids sit in a sorted typed array, outside the main process's heap, so that keeping them
    // does not change the main heap readings the test makes.
    const ids = new Uint32Array(nodes.length / fieldCount);
    for (let i = 0; i < nodes.length; i += fieldCount) {
      const kind = kindOf(snap, i);
      const entry = byKind.get(kind) || [0, 0];
      entry[0]++;
      entry[1] += nodes[i + sizeField];
      byKind.set(kind, entry);
      ids[i / fieldCount] = nodes[i + idField];
    }
    ids.sort();
    return { byKind, ids, snap };
  }

  // "type:constructor" of the node that starts at index i of the snapshot's node array.
  function kindOf(snap, i) {
    const meta = snap.snapshot.meta;
    const type = meta.node_types[0][snap.nodes[i + meta.node_fields.indexOf('type')]];
    if (/string/.test(type)) return type + ':';
    const name = snap.strings[snap.nodes[i + meta.node_fields.indexOf('name')]];
    return type + ':' + String(name).slice(0, 60);
  }

  // Binary search in a sorted id array.
  function hasId(sortedIds, id) {
    let low = 0;
    let high = sortedIds.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (sortedIds[mid] === id) return true;
      if (sortedIds[mid] < id) low = mid + 1;
      else high = mid - 1;
    }
    return false;
  }

  // For every new object whose kind starts with `prefix`: its shortest path from the heap's root,
  // cut to the steps that name a holder (from the document or window on), counted by that path.
  function rootsOf(from, to, prefix) {
    const { snap } = snapshots.get(to);
    const oldIds = snapshots.get(from).ids;
    const meta = snap.snapshot.meta;
    const fieldCount = meta.node_fields.length;
    const edgeFieldCount = meta.edge_fields.length;
    const idField = meta.node_fields.indexOf('id');
    const edgeCountField = meta.node_fields.indexOf('edge_count');
    const edgeTypeField = meta.edge_fields.indexOf('type');
    const edgeNameField = meta.edge_fields.indexOf('name_or_index');
    const edgeToField = meta.edge_fields.indexOf('to_node');
    const edgeTypes = meta.edge_types[0];
    const nodes = snap.nodes;
    const nodeCount = nodes.length / fieldCount;
    const firstEdge = new Uint32Array(nodeCount + 1);
    for (let n = 0; n < nodeCount; n++) {
      firstEdge[n + 1] = firstEdge[n] + nodes[n * fieldCount + edgeCountField] * edgeFieldCount;
    }
    const parent = new Int32Array(nodeCount).fill(-1);
    const parentEdge = new Int32Array(nodeCount).fill(-1);
    parent[0] = 0;
    let queue = [0];
    while (queue.length) {
      const next = [];
      for (const n of queue) {
        for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += edgeFieldCount) {
          const type = edgeTypes[snap.edges[e + edgeTypeField]];
          if (type === 'weak') continue;
          const name =
            type === 'element' || type === 'hidden'
              ? ''
              : snap.strings[snap.edges[e + edgeNameField]];
          if (/part of key/.test(String(name))) continue;
          const target = snap.edges[e + edgeToField] / fieldCount;
          if (parent[target] >= 0) continue;
          parent[target] = n;
          parentEdge[target] = e;
          next.push(target);
        }
      }
      queue = next;
    }
    const counts = new Map();
    let unreachable = 0;
    for (let n = 0; n < nodeCount; n++) {
      const index = n * fieldCount;
      if (hasId(oldIds, nodes[index + idField]) || !kindOf(snap, index).startsWith(prefix))
        continue;
      if (parent[n] < 0) {
        unreachable++;
        continue;
      }
      const steps = [];
      for (let m = n; m !== 0; m = parent[m]) {
        const e = parentEdge[m];
        const type = edgeTypes[snap.edges[e + edgeTypeField]];
        const nameOrIndex = snap.edges[e + edgeNameField];
        const edgeName = type === 'element' || type === 'hidden' ? '[]' : snap.strings[nameOrIndex];
        steps.unshift(
          kindOf(snap, parent[m] * fieldCount).slice(0, 45) + ' .' + String(edgeName).slice(0, 30)
        );
      }
      const start = steps.findIndex(step => /JSGlobalObject|HTMLDocument/.test(step));
      const label = steps.slice(Math.max(0, start), Math.max(0, start) + 10).join(' → ');
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return { unreachable, paths: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6) };
  }

  // The frame callbacks (requestAnimationFrame) still waiting in the last snapshot, counted by the
  // file and line of their function. A hidden window runs none, so each one keeps what its function
  // can reach until the window is shown again.
  async function pendingFrames(to) {
    const { snap } = snapshots.get(to);
    const meta = snap.snapshot.meta;
    const fieldCount = meta.node_fields.length;
    const edgeFieldCount = meta.edge_fields.length;
    const edgeCountField = meta.node_fields.indexOf('edge_count');
    const edgeToField = meta.edge_fields.indexOf('to_node');
    const nodes = snap.nodes;

    // Script ids to file names: the debugger lists every script it has parsed when enabled.
    const devtools = debuggerOf();
    const files = new Map();
    const onScript = (event, method, params) => {
      if (method === 'Debugger.scriptParsed')
        files.set(String(params.scriptId), String(params.url).split('/').pop());
    };
    devtools.on('message', onScript);
    await devtools.sendCommand('Debugger.enable');
    await devtools.sendCommand('Debugger.disable');
    devtools.removeListener('message', onScript);

    // Where each closure was written: node index -> "file:line".
    const locationFields = meta.location_fields;
    const where = new Map();
    for (let l = 0; l < snap.locations.length; l += locationFields.length) {
      const entry = snap.locations.slice(l, l + locationFields.length);
      const nodeIndex = entry[locationFields.indexOf('object_index')];
      const script = String(entry[locationFields.indexOf('script_id')]);
      const line = entry[locationFields.indexOf('line')] + 1;
      where.set(nodeIndex, (files.get(script) || 'script ' + script) + ':' + line);
    }
    const counts = new Map();
    let edgeIndex = 0;
    for (let i = 0; i < nodes.length; i += fieldCount) {
      const edgeCount = nodes[i + edgeCountField];
      const isCallback = kindOf(snap, i) === 'native:V8FrameRequestCallback';
      for (let e = 0; e < edgeCount; e++, edgeIndex += edgeFieldCount) {
        if (!isCallback) continue;
        const target = snap.edges[edgeIndex + edgeToField];
        if (!kindOf(snap, target).startsWith('closure:')) continue;
        const label = where.get(target) || 'unknown place';
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }

  return {
    pendingFrames,
    rootsOf,
    rounds: () => +process.env.TNAI_LEAK_ROUNDS || 5,
    threads: () => +process.env.TNAI_LEAK_THREADS || 10,
    progress(text) {
      process.stdout.write('[thread-stream-leak] ' + text + '\n');
      return true;
    },
    printer: () => soak.printer(),
    turn: (paneId, round) => soak.turn(paneId, round),
    sample: () => soak.sample(),

    // Takes a snapshot and keeps it under the given name.
    async snapshot(name) {
      const taken = await takeSnapshot();

      // Only the last snapshot keeps its whole graph (for rootsOf); the others keep counts and ids.
      if (name !== 'end') taken.snap = null;
      snapshots.set(name, taken);
      return true;
    },

    // What grew from snapshot `from` to snapshot `to`: [kind, count growth, bytes growth] for every
    // kind that grew by at least `minCount` objects or 64 KB, largest first.
    diff(from, to, minCount) {
      const before = snapshots.get(from).byKind;
      const after = snapshots.get(to).byKind;
      const grown = [];
      for (const [kind, [count, bytes]] of after) {
        const old = before.get(kind) || [0, 0];
        const countGrowth = count - old[0];
        const bytesGrowth = bytes - old[1];
        if (countGrowth >= minCount || bytesGrowth >= 65536)
          grown.push([kind, countGrowth, bytesGrowth]);
      }
      return grown.sort((a, b) => b[2] - a[2]).slice(0, 40);
    },

    // Minimized and restored the way minimize-restore does it; the window is never focused.
    minimize() {
      win.minimize();
      return true;
    },
    restore() {
      win.restore();
      return true;
    },
    hidden: () => process.env.TNAI_LEAK_HIDDEN !== '0',
    cleanup: () => soak.cleanup(),
  };
};

/*
 * Technically Not desktop · terminal-capture.js — Saves one terminal panel's screen for the "rows
 * vanish from the middle of a reply" bug: the text of the view the user was in
 * (xterm buffer: scrollback and visible rows), its size and recent size changes, the raw pty output
 * it was drawn from (the session's replay buffer, with its OSC 7717 size notes), the CLI and its
 * version, and timestamps, into one dated folder under userData\captures. Asked for by
 * 110-terminal-capture.js (main.js `terminal:capture`); tools/terminal-capture-compare.js compares
 * the screen with a replay of the saved output. Local files only, nothing is sent anywhere.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// pty output kept: the last part of the session's replay buffer (pty-service keeps the same amount)
const TAIL = 256 * 1024;

// a view's text is cut to this (5000 scrollback rows of a wide terminal fit well under it)
const TEXT = 4 * 1024 * 1024;
const VERSION_MS = 5000; // `<cli> --version` may take a moment; the capture does not wait longer

const pad = n => String(n).padStart(2, '0');
const stamp = d =>
  d.getFullYear() +
  '-' +
  pad(d.getMonth() + 1) +
  '-' +
  pad(d.getDate()) +
  '_' +
  pad(d.getHours()) +
  '-' +
  pad(d.getMinutes()) +
  '-' +
  pad(d.getSeconds());
const safe = s =>
  String(s || '')
    .replace(/[^\w.-]+/g, '-')
    .slice(0, 48) || 'panel';
const local = d =>
  d.toLocaleString('en-US', { hour12: false }) +
  ' (UTC' +
  (d.getTimezoneOffset() <= 0 ? '+' : '-') +
  pad(Math.floor(Math.abs(d.getTimezoneOffset()) / 60)) +
  ':' +
  pad(Math.abs(d.getTimezoneOffset()) % 60) +
  ')';
const fileFor = where => safe(String(where || 'view').toLowerCase());

// The size notes in the saved output (each pty resize the program drew for), newest last: compared
// with the view's own size changes.
function sizeNotes(buffer) {
  const out = [];
  for (const m of buffer.matchAll(/\x1b\]7717;(\d+);(\d+)\x07/g))
    out.push({ at: m.index, cols: +m[1], rows: +m[2] });
  return out.slice(-40);
}

// info: { paneId, cli, at, views: [{ where, text, cols, rows, ... }], sizes: [...], window: {...} }
// from the renderer (the view the user was in first). deps: { dir, replay(paneId) → Promise<{
// buffer, cols, rows, running, ... }>, version(cli) → Promise<string>, appVersion }.
async function save(info, deps) {
  const paneId = String(info?.paneId || '');
  if (!paneId) return { ok: false, error: 'No terminal panel was named.' };
  const savedAt = new Date(),
    views = (Array.isArray(info.views) ? info.views : []).slice(0, 6);
  if (!views.length) return { ok: false, error: 'No terminal view to save.' };
  const r = (await Promise.resolve(deps.replay(paneId)).catch(() => null)) || {};
  const buffer = String(r.buffer || ''),
    tail = buffer.length > TAIL ? buffer.slice(-TAIL) : buffer;
  const cli = String(info.cli || r.agent || '');
  const version =
    cli && cli !== 'Terminal'
      ? await Promise.race([
          Promise.resolve(deps.version(cli)).catch(() => ''),
          new Promise(res => setTimeout(() => res(''), VERSION_MS).unref?.()),
        ])
      : '';
  const folder = path.join(
    deps.dir,
    stamp(new Date(Number(info.at) || savedAt)) + '_' + safe(paneId)
  );
  await fs.promises.mkdir(folder, { recursive: true });
  const write = (name, text) =>
    fs.promises.writeFile(path.join(folder, name), text, 'utf8').then(() => name);
  const files = [];
  const meta = views.map((v, i) => {
    const text = String(v.text || '').slice(0, TEXT),
      name = i ? 'screen-' + (i + 1) + '-' + fileFor(v.where) + '.txt' : 'screen.txt';
    files.push(write(name, text));
    const lines = text.split('\n'),
      from = Math.max(0, Number(v.viewportY) || 0),
      rows = Number(v.rows) || 0;
    if (!i) files.push(write('visible.txt', lines.slice(from, from + rows).join('\n')));
    const { text: _drop, ...rest } = v;
    return { ...rest, file: name, lines: lines.length };
  });
  files.push(write('pty-tail.log', tail));
  const record = {
    what: 'Technically Not terminal screen capture (docs/ISSUES.md: rows missing from the middle of a reply). Compare with: node tools/terminal-capture-compare.js "<this folder>"',
    capturedAt: new Date(Number(info.at) || savedAt).toISOString(),
    capturedLocal: local(new Date(Number(info.at) || savedAt)),
    savedAt: savedAt.toISOString(),
    paneId,
    cli,
    cliVersion: version,
    app: deps.appVersion || '',
    platform: process.platform + ' ' + (process.getSystemVersion?.() || ''),
    pty: {
      cols: r.cols || 0,
      rows: r.rows || 0,
      running: !!r.running,
      saved: !!r.saved,
      startedAt: r.startedAt || 0,
      lastOutputAt: r.lastOutputAt || 0,
      chars: buffer.length,
      keptChars: tail.length,
      sizeNotes: sizeNotes(tail),
    },
    views: meta,
    sizeHistory: Array.isArray(info.sizes) ? info.sizes.slice(-40) : [],
    window: info.window || null,
    files: {
      screen:
        'screen.txt: every row of the view (scrollback, then the screen), as xterm holds them',
      visible: 'visible.txt: the rows on screen at that moment',
      pty:
        'pty-tail.log: the raw output the view was drawn from (last ' +
        Math.round(TAIL / 1024) +
        ' KB, with size notes)',
    },
  };
  files.push(write('capture.json', JSON.stringify(record, null, 2)));
  return { ok: true, folder, files: await Promise.all(files) };
}

module.exports = { save, _stamp: stamp };

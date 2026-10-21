// Technically Not desktop · what-it-made.js — the main-process half of "What it made"
// (src/scripts/170-what-it-made.js): what an agent made in a task, shown in the task's "Worked for"
// block. The window names a panel and a path its conversation wrote; the file is found here
// against that panel's own folders, as the design cards' files are (thread-designs.js `locate`),
// and must be inside them.
//
// - check(paneId, file, { since }): is the file there (and changed at or after `since`, for a file
// a command named): { ok, name, size }.
// - text(paneId, file): a document's or a data file's text, at most TEXT_MAX bytes: { ok, name,
//   text, cut }.
// - alive(url): does anything answer at a local address (localhost, 127.0.0.1, [::1]) right now.
//   Asked once when a site is drawn or pressed, never on a timer.
'use strict';
const fs = require('fs');
const net = require('net');
const designs = require('./thread-designs');

const DOCUMENT = /\.(md|markdown|txt|rst|adoc)$/i;
const DATA = /\.(csv|tsv|json)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const ANY = new RegExp(
  [DOCUMENT, DATA, VIDEO, designs.PICTURE, designs.PAGE].map(kind => kind.source).join('|'),
  'i'
);

// a document or data file is read only up to this
const TEXT_MAX = 256 * 1024;

// a file changed this long before the command's own start still counts (two different clocks)
const SINCE_SLACK_MS = 3000;
const ALIVE_MS = 1500;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function check(paneId, file, options = {}) {
  const at = designs.locate(paneId, file, ANY);
  if (!at.ok) return at;
  const since = Number(options.since) || 0;
  if (since && at.stat.mtimeMs < since - SINCE_SLACK_MS)
    return { ok: false, error: 'not changed by this command' };
  return { ok: true, name: at.name, size: at.stat.size };
}

async function text(paneId, file) {
  const kind = new RegExp(DOCUMENT.source + '|' + DATA.source, 'i');
  const at = designs.locate(paneId, file, kind);
  if (!at.ok) return at;
  const size = Math.min(at.stat.size, TEXT_MAX);
  const handle = await fs.promises.open(at.real, 'r');
  try {
    const bytes = Buffer.alloc(size);
    await handle.read(bytes, 0, size, 0);
    return {
      ok: true,
      name: at.name,
      text: bytes.toString('utf8'),
      cut: at.stat.size > TEXT_MAX,
    };
  } finally {
    await handle.close();
  }
}

// Only an address on this computer, and only its host and port are used.
function localAddress(raw) {
  let address = null;
  try {
    address = new URL(String(raw || ''));
  } catch {
    return null;
  }
  if (!/^https?:$/.test(address.protocol) || !LOCAL_HOSTS.has(address.hostname)) return null;
  if (address.username || address.password) return null;
  return address;
}

function alive(raw) {
  const address = localAddress(raw);
  if (!address) return Promise.resolve(false);
  const port = Number(address.port) || (address.protocol === 'https:' ? 443 : 80);
  const host = address.hostname === '[::1]' ? '::1' : address.hostname;
  return new Promise(resolve => {
    const socket = net.connect({ host, port, autoSelectFamily: true });
    const done = answer => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(ALIVE_MS, () => done(false));
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}

module.exports = { check, text, alive, localAddress, TEXT_MAX };

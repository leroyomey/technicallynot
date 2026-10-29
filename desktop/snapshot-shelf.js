// Technically Not desktop · snapshot-shelf.js — the Snapshots box: the last five pictures and the
// last five clips taken with the snapshot key (snapshot-service.js), so a user can take several
// back to back and copy any of them again later. Pictures stay in memory only (a snapshot is never
// written to disk); clips are the files snapshot-clip.js already saved, held from the usual
// clean-up while they are in the box (attachment-service.js `keep`). Everything here is gone when
// the app quits. The page shows the box from the three-dots menu
// (src/scripts/151-snapshot-shelf.js).
'use strict';
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { clipboard, ClipboardItem, nativeImage } = require('electron');
const attachments = require('./attachment-service');

// How many of each kind the box keeps. A sixth pushes the oldest out.
const MAX = 5;

// Newest first. Picture: { id, at, png, width, height, thumb }. Clip: { id, at, files, text, still
// }.
let pictures = [];
let clips = [];

// Told after every change, with the list the page draws (main.js sends it to the window).
let notify = () => {};

// The clip's video and its text line on the clipboard (snapshot-service.js `copyClip`), handed in
// by main.js so the two files do not require each other.
let copyClipFile = async () => false;

function init(options = {}) {
  if (typeof options.onChange === 'function') notify = options.onChange;
  if (typeof options.copyClip === 'function') copyClipFile = options.copyClip;
}

const newId = () => crypto.randomBytes(6).toString('hex');
const changed = () => notify(list());

// A small picture for the box, at most 240 by 160 pixels, made once when the picture comes in.
function thumbnail(image) {
  const size = image.getSize();
  if (!size.width || !size.height) return '';
  const scale = Math.min(1, 240 / size.width, 160 / size.height);
  return image
    .resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'good',
    })
    .toDataURL();
}

// A finished picture, as the PNG that went to the clipboard. `image` is that picture already
// decoded, when the caller has it: decoding the PNG again held the main thread (stalls.log).
function addPicture(png, width, height, image = null) {
  if (!Buffer.isBuffer(png) || !png.length) return;
  let thumb = '';
  try {
    thumb = thumbnail(image || nativeImage.createFromBuffer(png));
  } catch {}
  pictures.unshift({ id: newId(), at: Date.now(), png, width, height, thumb });
  pictures = pictures.slice(0, MAX);
  changed();
}

// A finished clip: its video, its frames and the line that went to the clipboard.
function addClip(video, frames, text) {
  if (typeof video !== 'string' || !video) return;
  const files = [video, ...(Array.isArray(frames) ? frames : [])];
  attachments.keep(video, true);
  clips.unshift({
    id: newId(),
    at: Date.now(),
    files,
    text: String(text || ''),
    still: frames?.[0] ? pathToFileURL(frames[0]).href : '',
  });

  // The clip pushed out goes back to the usual rule: kept if it was pasted in the app, deleted
  // at the next sweep if nothing names it.
  const out = clips.slice(MAX);
  clips = clips.slice(0, MAX);
  for (const old of out) attachments.keep(old.files[0], false);
  if (out.length)
    try {
      attachments.sweep();
    } catch {}
  changed();
}

// What the page draws: no PNG bytes and no file paths beyond the clip's own name.
function list() {
  return {
    max: MAX,
    pictures: pictures.map(item => ({
      id: item.id,
      at: item.at,
      width: item.width,
      height: item.height,
      thumb: item.thumb,
    })),
    clips: clips.map(item => ({
      id: item.id,
      at: item.at,
      name: path.basename(item.files[0]),
      still: item.still,
    })),
  };
}

// Copies one again, the same way the snapshot key copied it.
async function copy(kind, id) {
  if (kind === 'picture') {
    const item = pictures.find(one => one.id === id);
    if (!item) return { ok: false, error: { message: 'This snapshot is no longer in the box.' } };
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([item.png], { type: 'image/png' }) }),
    ]);
    return { ok: true, value: true };
  }
  if (kind === 'clip') {
    const item = clips.find(one => one.id === id);
    if (!item) return { ok: false, error: { message: 'This clip is no longer in the box.' } };
    await clipboard.writeText(item.text);
    await copyClipFile(item.files[0], item.text);
    return { ok: true, value: true };
  }
  return { ok: false, error: { message: 'Unknown kind.' } };
}

// One picture's full PNG, for the markup dialog (151): the page draws on it and sends the marked
// copy as a new attachment. The kept picture itself never changes.
function picture(id) {
  const item = pictures.find(one => one.id === id);
  if (!item) return { ok: false, error: { message: 'This snapshot is no longer in the box.' } };
  return { ok: true, value: { png: item.png, width: item.width, height: item.height } };
}

// Deletes one: a picture leaves memory, a clip's files leave the disk.
async function remove(kind, id) {
  if (kind === 'picture') {
    pictures = pictures.filter(one => one.id !== id);
  } else if (kind === 'clip') {
    const item = clips.find(one => one.id === id);
    clips = clips.filter(one => one.id !== id);
    if (item) await attachments.removeClip(item.files);
  }
  changed();
  return { ok: true, value: true };
}

// Empties the box: every picture and every clip in it.
async function clear() {
  const gone = clips;
  pictures = [];
  clips = [];
  for (const item of gone) await attachments.removeClip(item.files);
  changed();
  return { ok: true, value: true };
}

module.exports = { init, addPicture, addClip, list, copy, picture, remove, clear, MAX };

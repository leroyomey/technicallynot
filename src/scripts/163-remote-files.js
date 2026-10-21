// Technically Not · 163-remote-files.js — Desktop only: the Files tab of another computer's thread
// (plan items 42 and 43).
//
// While another computer's agent fills the thread's main area (138 `TnaiThreadHistory.remote()`),
// the side column's Files tab (131) shows that computer's project files instead of this
// computer's file rail: one folder at a time, folders first, a press on a folder opens it and a
// press on a file shows its text read-only, in the look of 131's own file view. "Edit" turns the
// text into a box and "Save" sends it to that computer, which saves it through its own save path
// (desktop/remote-browse.js holds every rule: the right, the path, the hidden secrets, the size,
// the version, the lock). Kinds that are never sent (pictures, programs …) say so in one line.
// "Live preview" shows a picture of the page that computer's Live preview shows, with its
// address; "Take again" asks for a new one. A press on the picture does nothing over there yet.
//
// Nothing here asks the main process anything while no other computer's thread is open; the
// state of the feature arrives by push (`remote.on`). The rail itself is never moved or rebuilt:
// it is hidden while this part shows (`.tnt-remote-on`, src/styles/35-thread-side.css).
//
// `window.TnaiRemoteFiles` (`state`). Tests: desktop `remote-files` (written, run with the batch).
(() => {
  'use strict';
  const native = window.tnaiNative?.remote;
  if (!native?.askFiles || !native.onFiles) return;

  const SEP = '\n';
  const icon = (name, size) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const say = message =>
    typeof window.toast === 'function' ? window.toast(message) : console.info(message);
  const call = async (name, ...args) => {
    try {
      const r = await native[name](...args);
      if (r && r.ok === false) return { failed: (r.error && r.error.code) || 'failed' };
      return r && typeof r === 'object' && 'value' in r ? r.value : r;
    } catch {
      return { failed: 'failed' };
    }
  };

  // The last pushed state of the feature (never asked for here).
  let pushed = null;
  native.on?.(state => {
    pushed = state;
    follow();
  });

  // ---------- the part ----------
  const part = el('div', 'tnt-remotefiles');
  part.hidden = true;
  part.innerHTML =
    '<div class="tnt-fileview-head">' +
    '<button type="button" class="tnt-rf-back" aria-label="Back" title="Back">' +
    icon('arrow-left', 16) +
    '</button><strong class="tnt-fileview-name"></strong>' +
    '<button type="button" class="tnt-rf-edit" aria-label="Edit this file" title="Edit" hidden>' +
    icon('pencil', 16) +
    '</button>' +
    '<button type="button" class="tnt-rf-save" aria-label="Save it on that computer" ' +
    'title="Save" hidden>' +
    icon('check', 16) +
    '</button>' +
    '<button type="button" class="tnt-rf-again" aria-label="Take again" title="Take again" hidden>' +
    icon('rotate-cw', 16) +
    '</button>' +
    '<button type="button" class="tnt-rf-preview" aria-label="Its Live preview" ' +
    'title="Its Live preview">' +
    icon('monitor-play', 16) +
    '</button></div>' +
    '<p class="tnt-fileview-note" hidden></p>' +
    '<ul class="tnt-rf-list" aria-label="Files"></ul>' +
    '<pre class="tnt-fileview-text" tabindex="0" hidden></pre>' +
    '<textarea class="tnt-fileview-text tnt-rf-box" spellcheck="false" hidden ' +
    'aria-label="The file’s text"></textarea>' +
    '<figure class="tnt-rf-shot" hidden><img alt="" draggable="false">' +
    '<figcaption class="tnt-fileview-note"></figcaption></figure>';
  const backButton = part.querySelector('.tnt-rf-back');
  const nameLine = part.querySelector('.tnt-fileview-name');
  const editButton = part.querySelector('.tnt-rf-edit');
  const saveButton = part.querySelector('.tnt-rf-save');
  const againButton = part.querySelector('.tnt-rf-again');
  const previewButton = part.querySelector('.tnt-rf-preview');
  const note = part.querySelector('.tnt-fileview-note');
  const listNode = part.querySelector('.tnt-rf-list');
  const textNode = part.querySelector('pre.tnt-fileview-text');
  const box = part.querySelector('.tnt-rf-box');
  const shot = part.querySelector('.tnt-rf-shot');
  const shotImage = shot.querySelector('img');
  const shotLine = shot.querySelector('figcaption');

  // ---------- where the user is ----------
  // pc: the other computer's id ('' while none of its threads is open). view: 'list' | 'file' |
  // 'preview'. folder: the folder shown. file: the file shown. editing: the box is open.
  const at = { pc: '', name: '', view: 'list', folder: '', file: '', editing: false };
  let held = { list: null, file: null, save: null };
  let picture = null;
  let lastSave = null;

  // The Files tab's box, handed over by 131 each time that tab shows (`place`).
  let host = null;
  const tabShown = () => !!host && host.isConnected && !host.hidden;

  // The first folder is asked once per computer, when its tab shows, not before.
  let firstAsked = false;
  const openRemote = () => {
    try {
      return String(window.TnaiThreadHistory?.remote?.() || '');
    } catch {
      return '';
    }
  };
  const computerOf = pcId => {
    const list = pushed && Array.isArray(pushed.computers) ? pushed.computers : [];
    return list.find(pc => pc && pc.id === pcId) || null;
  };
  const nameOf = pcId => {
    try {
      const found = (window.TnaiRemoteAgents?.shown?.() || []).find(pc => pc.id === pcId);
      if (found && found.name) return found.name;
    } catch {
      /* the next push names it */
    }
    return computerOf(pcId)?.name || 'the other computer';
  };

  // ---------- following the open thread ----------
  function follow() {
    const key = openRemote();
    const pcId = key ? key.split(SEP)[0] : '';
    if (!host) return;
    if (part.parentNode !== host) host.append(part);
    const on = !!pcId;
    host.classList.toggle('tnt-remote-on', on);
    part.hidden = !on;
    if (!on) {
      at.pc = '';
      return;
    }
    if (pcId !== at.pc) {
      at.pc = pcId;
      at.view = 'list';
      at.folder = '';
      at.file = '';
      at.editing = false;
      held = { list: null, file: null, save: null };
      picture = null;
      lastSave = null;
      firstAsked = false;
    }
    if (!firstAsked && tabShown()) {
      firstAsked = true;
      ask('list', '');
    }
    at.name = nameOf(pcId);
    paint();
  }

  // ---------- asking ----------
  const SENT_WORDS = {
    not_sent: 'It could not be asked: that computer is not connected now.',
    no_project: 'That computer does not have this project open, so its files are not shown.',
    bad_path: 'That name cannot be asked for.',
    not_read: 'Open the whole file again before saving.',
    large: 'Files over 40 KB are read here but not saved from here.',
    failed: 'It could not be asked. Try again in a moment.',
  };

  async function ask(op, path, text) {
    const r = await call('askFiles', at.pc, op, path, text);
    const state = r && (r.state || r.failed);
    if (state && state !== 'asked') {
      setNote(SENT_WORDS[state] || SENT_WORDS.failed);
      return false;
    }
    return true;
  }

  async function reread(withPicture) {
    if (!at.pc) return;
    const got = await call('files', at.pc);
    if (got && !got.failed) held = got;
    if (withPicture) {
      const shown = await call('preview', at.pc);
      picture = shown && !shown.failed ? shown : null;
    }
    afterSave();
    paint();
  }
  native.onFiles(info => {
    if (info && info.peer === at.pc) reread(info.preview === true);
  });

  // A save that landed on this computer from another one is said where it lands.
  native.onLanded?.(info => {
    if (!info || info.kind !== 'saved') return;
    say(
      String(info.by || 'Another computer') + ' saved ' + String(info.path || 'a file') + ' here.'
    );
  });

  // ---------- the words for an answer ----------
  const STATE_WORDS = {
    asked: 'Asking…',
    no_answer:
      'No answer. That computer may not have given this one full control, or it is busy; try again.',
    refused: 'That computer refused it.',
    busy: 'That computer is busy sending other things. Try again in a moment.',
    project: 'That computer has another project open now.',
    missing: 'It is not there any more.',
    hidden: 'This is kept private on that computer and is never sent.',
    large: 'It is too large to save from here.',
    changed: 'The file changed on that computer since you opened it. Open it again, then edit.',
    failed: 'Something went wrong on the way. Try again.',
    none: 'That computer’s Live preview shows no page now.',
    guarded:
      'This file can make tools on that computer run commands, so it is not saved from here.',
  };
  const KIND_WORDS = {
    picture: 'a picture',
    sound: 'a sound',
    video: 'a video',
    PDF: 'a PDF',
    archive: 'an archive',
    font: 'a font',
    program: 'a program file',
    document: 'a document of another program',
    database: 'a database',
    binary: 'not text',
  };

  let noteText = '';
  const setNote = text => {
    noteText = text || '';
    paint();
  };

  // Each read from the main process brings new objects, so the outcome already said is known by
  // its path, state and holder, never by the object (otherwise "Saved on" came back after every
  // later read and covered the line of the file shown then).
  function afterSave() {
    const s = held.save;
    if (!s || s.state === 'asked') return;
    const said = [s.path, s.state, s.holder || ''].join('|');
    if (said === lastSave) return;
    lastSave = said;
    if (s.state === 'saved') {
      at.editing = false;
      noteText = 'Saved on ' + at.name + '.';
      return;
    }
    noteText =
      s.state === 'locked'
        ? 'Not saved: ' + (s.holder || 'another agent') + ' is editing this file on that computer.'
        : 'Not saved. ' + (STATE_WORDS[s.state] || STATE_WORDS.failed);
  }

  // ---------- drawing ----------
  function paint() {
    if (!at.pc) return;
    const list = held.list;
    const file = held.file;
    const inFile = at.view === 'file';
    const inShot = at.view === 'preview';
    const readable = inFile && file && file.path === at.file && file.state === 'shown';
    const head = inShot
      ? at.name + ' · Live preview'
      : inFile
        ? at.file.split('/').pop()
        : at.name + (at.folder ? ' · ' + at.folder : '');
    if (nameLine.textContent !== head) nameLine.textContent = head;
    nameLine.title = inFile ? at.file : at.folder || at.name;
    backButton.hidden = !inFile && !inShot && !at.folder;
    previewButton.hidden = inShot;

    // Ask again: for the picture, and for a folder whose answer did not come
    const listStuck =
      !inFile && !inShot && (!list || (list.state !== 'shown' && list.state !== 'asked'));
    againButton.hidden = !inShot && !listStuck;
    editButton.hidden = !readable || file.cut === true || file.readOnly === true || at.editing;
    saveButton.hidden = !readable || !at.editing;
    const saving = held.save && held.save.state === 'asked';
    saveButton.disabled = !!saving;

    // the list
    listNode.hidden = inFile || inShot;
    if (!listNode.hidden) paintList(list);

    // the file
    textNode.hidden = !readable || at.editing;
    box.hidden = !readable || !at.editing;
    if (readable && !at.editing && textNode.dataset.hash !== String(file.size) + file.path) {
      textNode.dataset.hash = String(file.size) + file.path;
      if (window.TnaiCodeColors) window.TnaiCodeColors.paint(textNode, file.text, file.path);
      else textNode.textContent = file.text;
    }

    // the picture
    shot.hidden = !inShot || !picture || !picture.data;
    if (!shot.hidden) {
      const source = 'data:image/jpeg;base64,' + picture.data;
      if (shotImage.src !== source) shotImage.src = source;
      shotImage.alt = 'The page ' + picture.url + ' as ' + at.name + ' shows it';
      shotImage.title = 'A picture only: a press here does nothing on ' + at.name + ' yet.';
      shotLine.textContent = picture.url;
    }

    // the one line
    let line = noteText;
    if (!line && inFile) {
      if (!file || file.path !== at.file) line = STATE_WORDS.asked;
      else if (file.state === 'binary')
        line = 'This is ' + (KIND_WORDS[file.kind] || KIND_WORDS.binary) + ', so it is not sent.';
      else if (file.state !== 'shown') line = STATE_WORDS[file.state] || STATE_WORDS.failed;
      else if (file.cut) line = 'The first 40 KB of a longer file. It is read-only here.';
      else if (file.readOnly)
        line = 'This file can make tools on that computer run commands, so it is read-only here.';
      else if (saving) line = 'Saving on ' + at.name + '…';
    }
    if (!line && inShot) {
      if (!picture) line = STATE_WORDS.asked;
      else if (picture.state === 'asked')
        line = picture.data ? 'Taking a new picture…' : STATE_WORDS.asked;
      else if (picture.state !== 'shown') line = STATE_WORDS[picture.state] || STATE_WORDS.failed;
      else line = 'A picture of the page. A press on it does nothing on ' + at.name + ' yet.';
    }
    if (!line && !inFile && !inShot) {
      if (!list || list.path !== at.folder) line = STATE_WORDS.asked;
      else if (list.state !== 'shown') line = STATE_WORDS[list.state] || STATE_WORDS.failed;
      else if (list.hidden || list.more) {
        const parts = [];
        if (list.hidden) parts.push(list.hidden + ' kept private and not shown');
        if (list.more) parts.push(list.more + ' more not listed');
        line = parts.join(' · ') + '.';
      } else if (!list.entries.length) line = 'This folder is empty.';
    }
    if (note.textContent !== line) note.textContent = line;
    note.hidden = !line;
  }

  function paintList(list) {
    const entries = list && list.state === 'shown' && list.path === at.folder ? list.entries : [];
    const key = at.folder + SEP + entries.map(entry => entry.join('/')).join(SEP);
    if (listNode.dataset.key === key) return;
    listNode.dataset.key = key;
    listNode.replaceChildren(
      ...entries.map(([name, type, , kind]) => {
        const item = el('li');
        const button = el('button', 'tnt-rf-row');
        button.type = 'button';
        button.dataset.name = name;
        button.dataset.type = type;
        button.innerHTML = icon(
          type === 'd' ? 'folder' : kind === 'text' ? 'file-text' : 'file',
          14
        );
        button.append(el('span', 'tnt-rf-row-name', name));
        button.title = (at.folder ? at.folder + '/' : '') + name;
        item.append(button);
        return item;
      })
    );
  }

  // ---------- what the user does ----------
  listNode.addEventListener('click', event => {
    const row = event.target.closest?.('.tnt-rf-row');
    if (!row) return;
    const path = (at.folder ? at.folder + '/' : '') + row.dataset.name;
    noteText = '';
    if (row.dataset.type === 'd') {
      at.folder = path;
      held.list = null;
      paint();
      ask('list', path);
      return;
    }
    at.view = 'file';
    at.file = path;
    at.editing = false;
    paint();
    ask('read', path);
  });

  backButton.addEventListener('click', () => {
    noteText = '';
    if (at.view === 'file' || at.view === 'preview') {
      at.view = 'list';
      at.editing = false;
      paint();
      if (!held.list || held.list.path !== at.folder) ask('list', at.folder);
      return;
    }
    const up = at.folder.includes('/') ? at.folder.slice(0, at.folder.lastIndexOf('/')) : '';
    at.folder = up;
    held.list = null;
    paint();
    ask('list', up);
  });

  editButton.addEventListener('click', () => {
    const file = held.file;
    if (!file || file.state !== 'shown' || file.cut) return;
    at.editing = true;
    box.value = file.text;
    noteText = 'Editing the file on ' + at.name + '. Save sends it there.';
    paint();
    box.focus({ preventScroll: true });
  });

  saveButton.addEventListener('click', async () => {
    // a new save: its outcome is said even when it is the same as the last one
    lastSave = null;
    noteText = '';
    paint();
    await ask('save', at.file, box.value);
  });

  // Escape leaves the box without saving; the text the user typed is dropped.
  box.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    at.editing = false;
    noteText = '';
    paint();
  });

  previewButton.addEventListener('click', async () => {
    at.view = 'preview';
    at.editing = false;
    noteText = '';
    paint();
    if (await askPicture()) reread(true);
  });
  againButton.addEventListener('click', async () => {
    noteText = '';
    if (at.view !== 'preview') {
      held.list = null;
      paint();
      ask('list', at.folder);
      return;
    }
    if (await askPicture()) reread(true);
  });

  async function askPicture() {
    const r = await call('askPreview', at.pc);
    if (r && r.state === 'asked') return true;
    setNote(SENT_WORDS.not_sent);
    return false;
  }

  window.addEventListener('tnai:thread-view', follow);
  window.addEventListener('tnai:threads-shown', follow);
  window.addEventListener('tnai:threads-painted', follow);
  window.addEventListener('tnai:remote-agents-changed', follow);
  window.TnaiRemoteFiles = {
    // 131: the Files tab shows, in this box
    place(node) {
      if (!node || host === node) {
        if (node) follow();
        return;
      }
      host = node;
      follow();
    },
    state: () => ({
      ...at,
      held: { ...held },
      picture: picture ? { ...picture, data: !!picture.data } : null,
    }),
  };
})();

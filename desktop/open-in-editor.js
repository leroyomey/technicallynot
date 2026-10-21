// Technically Not desktop · open-in-editor.js — "Open in VS Code / Cursor / File Explorer" in a
// thread's "..." menu (src/scripts/137-thread-more.js). Lists only the editors found on this
// computer, and opens the thread's own folder (its worktree when it has one) in the one chosen.
//
// An editor is found at its usual install place, else as its command on PATH. The folder is never
// taken from the window: main.js looks it up from the thread's panel, and this checks that it is
// an existing folder. The editor starts on its own (detached, no shell), so it stays open when
// Technically Not closes. The system's file manager is always there (Electron `shell.openPath`).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// The editors we know, with where they install themselves and their command on PATH.
function knownEditors(env, platform) {
  const local = env.LOCALAPPDATA || '';
  const programs = env.ProgramFiles || 'C:\\Program Files';
  if (platform === 'win32')
    return [
      {
        id: 'vscode',
        label: 'VS Code',
        places: [
          path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
          path.join(programs, 'Microsoft VS Code', 'Code.exe'),
        ],
        command: 'code.cmd',
      },
      {
        id: 'cursor',
        label: 'Cursor',
        places: [path.join(local, 'Programs', 'cursor', 'Cursor.exe')],
        command: 'cursor.cmd',
      },
    ];
  if (platform === 'darwin')
    return [
      {
        id: 'vscode',
        label: 'VS Code',
        places: ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
        command: 'code',
      },
      {
        id: 'cursor',
        label: 'Cursor',
        places: ['/Applications/Cursor.app/Contents/Resources/app/bin/cursor'],
        command: 'cursor',
      },
    ];
  return [
    { id: 'vscode', label: 'VS Code', places: [], command: 'code' },
    { id: 'cursor', label: 'Cursor', places: [], command: 'cursor' },
  ];
}

// The system's own file manager, by its name on each system.
const filesLabel = platform =>
  platform === 'win32' ? 'File Explorer' : platform === 'darwin' ? 'Finder' : 'Files';

const isFile = file => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

// The command on PATH, as the shell would find it.
function onPath(command, env) {
  const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH');
  const folders = String((key && env[key]) || '').split(path.delimiter);
  for (const folder of folders) {
    if (!folder) continue;
    const file = path.join(folder, command);
    if (isFile(file)) return file;
  }
  return '';
}

// env, platform and start are given by the test; the app uses its own. openPath: Electron's
// shell.openPath (it answers '' when it opened the folder, else the error).
function createOpenInEditor({
  env = process.env,
  platform = process.platform,
  openPath,
  start = spawn,
} = {}) {
  let found = null;

  // The editors on this computer: [{ id, label, file }], the file manager last. Looked up once.
  function list() {
    if (!found) {
      found = [];
      for (const editor of knownEditors(env, platform)) {
        const file = editor.places.find(isFile) || onPath(editor.command, env);
        if (file) found.push({ id: editor.id, label: editor.label, file });
      }
    }
    return [
      ...found.map(({ id, label }) => ({ id, label })),
      { id: 'files', label: filesLabel(platform) },
    ];
  }

  // Opens `folder` in the editor `id`.
  async function open(id, folder) {
    const where = String(folder || '');
    let isFolder = false;
    try {
      isFolder = path.isAbsolute(where) && fs.statSync(where).isDirectory();
    } catch {}
    if (!isFolder) throw new Error('This thread has no folder on this computer.');
    if (id === 'files') {
      const error = await openPath(where);
      if (error) throw new Error(error);
      return true;
    }
    list();
    const editor = found.find(one => one.id === id);
    if (!editor) throw new Error('That editor is not installed on this computer.');

    // A .cmd file needs cmd.exe to run; the folder is passed as one quoted argument, so a folder
    // whose name cmd.exe would read as more than a name (% or ") is refused there.
    const viaCmd = /\.cmd$/i.test(editor.file);
    if (viaCmd && /[%"\r\n]/.test(where))
      throw new Error('This folder name cannot be handed to ' + editor.label + ' safely.');
    const child = viaCmd
      ? start(
          env.ComSpec || 'cmd.exe',
          ['/d', '/s', '/c', '"' + editor.file + '" "' + where + '"'],
          {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            windowsVerbatimArguments: true,
          }
        )
      : start(editor.file, [where], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on?.('error', () => {});
    child.unref?.();
    return true;
  }

  return { list, open };
}

module.exports = { createOpenInEditor, knownEditors, filesLabel };

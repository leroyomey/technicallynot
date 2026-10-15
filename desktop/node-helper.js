// Technically Not · node-helper.js — which program runs the app's small Node scripts: the `tnai`
// and agent command stand-ins in every terminal panel, the watcher that makes sure the app quits,
// and the helper that lists a closed panel's processes.
//
// Today that program is the app's own executable started "as Node" (the environment variable
// ELECTRON_RUN_AS_NODE). That same door lets any program on the PC run its own script under the
// app's name and signature, so it is to be closed in release builds.
// Closing it needs a plain Node runtime shipped in the
// installer, at resources/node/node(.exe).
//
// This file is the one place that decides. When the shipped runtime is there, it is used and the
// app is never started as Node. When it is not (a run from source, or a build made before the
// runtime was added), everything works exactly as before. So this code is safe to ship ahead of
// the runtime, and the door is closed by a build setting only once the runtime is in the build.
const fs = require('fs');
const path = require('path');
const buildInfo = require('./build-info');

// → { exe, asNode }: the program to run, and whether it must be told to behave as Node.
//   resourcesPath: the installed app's resources folder (process.resourcesPath).
//   release: whether this copy is a release build. Only a release build takes the shipped runtime:
//   a run from source has a resources folder too (node_modules/electron/dist/resources, inside the
//   project and git-ignored), and a node.exe that someone put there must not run the stand-ins.
//   Asked of the app's own code only (build-info.js releaseByCode): a build-info.json in that same
//   folder could be put there together with the node.exe.
//   exists: fs.existsSync, replaceable in tests.
function nodeHelper({
  resourcesPath = process.resourcesPath || '',
  execPath = process.execPath,
  platform = process.platform,
  release = buildInfo.releaseByCode,
  exists = fs.existsSync,
} = {}) {
  const shipped =
    release && resourcesPath
      ? path.join(resourcesPath, 'node', platform === 'win32' ? 'node.exe' : 'node')
      : '';
  if (shipped && exists(shipped)) return { exe: shipped, asNode: false };
  return { exe: execPath, asNode: true };
}

// The environment for a script run by the helper.
function helperEnv(helper, env = process.env) {
  if (helper.asNode) return { ...env, ELECTRON_RUN_AS_NODE: '1' };

  // a real Node needs no such variable, and must not hand it on to what it starts
  const { ELECTRON_RUN_AS_NODE: _dropped, ...rest } = env;
  return rest;
}

// A path inside double quotes in a .cmd file: a percent sign would start a variable.
const cmdQuoted = text => '"' + String(text).replace(/%/g, '%%') + '"';

// A path inside single quotes in an sh script.
const shQuoted = text => "'" + String(text).replace(/'/g, "'\\''") + "'";

// True when every character of the text is plain ASCII. cmd.exe reads a .cmd file in the
// console's code page, not as UTF-8, so any other letter written into the file (José, 日本語) is
// read back as different letters and the path is "not found".
const isPlainAscii = text => /^[\x20-\x7e]*$/.test(String(text));

// The variable every terminal panel is given with the shipped runtime's path (agent-mesh.js).
// Windows keeps the environment as Unicode, so a path with any letter survives there.
const RUNTIME_VARIABLE = 'TNAI_RUNTIME';

// The Windows .cmd stand-in for one command name.
//   As Node (today): the program comes from the panel's environment, as it always has.
//   Shipped runtime, a path in plain ASCII: the path is written into the file. A terminal panel
//   that was open during an update still holds the old program in its environment, and with the
//   door closed that old value would open the app instead of running the script.
//   Shipped runtime, a path with any other letter (an install under a user name such as José):
//   the path cannot be written into the file, so it is taken from the panel's TNAI_RUNTIME. A
//   panel without that variable (opened before the update, or a tool in it cleared the
//   environment) is told so, in words that are true of both.
//   DisableDelayedExpansion: with delayed expansion switched on in the user's cmd, a "!" in a path
//   would be read as the start of a variable.
//   TNAI_CMD_ARGS (tnai only): the arguments as cmd.exe received them, before Node splits them.
//   PowerShell hands a .cmd an argument such as 'say "hi"' as "say "hi"", and Node's split then
//   drops the inner quotes; agent-shim.js rebuilds the message from this text. The line has no
//   double quote of its own before %*, like the program line, so cmd.exe reads %* the same way
//   in both lines (a quote before it would flip which parts cmd.exe treats as quoted).
function cmdShim(name, helper) {
  const lines = ['@echo off', 'setlocal DisableDelayedExpansion'];
  if (name === 'tnai') lines.push('set TNAI_CMD_ARGS=%*');
  const script = ' "%~dp0tnai-shim.js" ' + name + ' %*';
  if (helper.asNode) {
    lines.push('set "ELECTRON_RUN_AS_NODE=1"');
    lines.push('"%TNAI_NODE%"' + script);
  } else if (isPlainAscii(helper.exe)) {
    lines.push('set "ELECTRON_RUN_AS_NODE="');
    lines.push(cmdQuoted(helper.exe) + script);
  } else {
    lines.push('set "ELECTRON_RUN_AS_NODE="');
    lines.push(
      'if not defined ' +
        RUNTIME_VARIABLE +
        ' echo ' +
        name +
        ': no Technically Not runtime is set in this terminal panel. Close the panel and open it again. 1>&2 & exit /b 1'
    );
    lines.push('"%' + RUNTIME_VARIABLE + '%"' + script);
  }
  lines.push('exit /b %ERRORLEVEL%', '');
  return lines.join('\r\n');
}

// What a terminal panel's environment gets for the stand-ins, beside TNAI_NODE: the shipped
// runtime's path under TNAI_RUNTIME, or nothing while the app runs its scripts itself.
function runtimeEnv(helper) {
  return helper.asNode ? {} : { [RUNTIME_VARIABLE]: helper.exe };
}

// The list a process-list helper sent, when it is what it must be: process ids, which are whole
// numbers above zero. node-pty ends every process in that list, so anything else is not passed
// on. → the list, or null.
function processList(list) {
  const isProcessId = value => Number.isInteger(value) && value > 0;
  return Array.isArray(list) && list.length > 0 && list.every(isProcessId) ? list : null;
}

// The sh stand-in for one command name (Mac, Linux, and `tnai` for Git Bash on Windows, which
// needs MSYS_NO_PATHCONV so its arguments are not rewritten as paths).
function shShim(name, helper, { gitBash = false } = {}) {
  const before = gitBash ? 'MSYS_NO_PATHCONV=1 ' : '';
  const program = helper.asNode
    ? 'ELECTRON_RUN_AS_NODE=1 exec "$TNAI_NODE"'
    : 'exec ' + shQuoted(helper.exe.replace(/\\/g, '/'));
  return '#!/bin/sh\n' + before + program + ' "$TNAI_SHIM" ' + name + ' "$@"\n';
}

// The helper that lists the processes of a closed terminal panel's console (Windows), as one line
// of program text for the shipped runtime: node -e <this> <the .node file> <the shell's pid>.
// node-pty has the same steps in a script file, but in an installed app that file is inside
// app.asar, and a plain Node cannot read a script from inside an asar. The native file it loads is
// unpacked beside the asar, so the runtime is handed that file's path and these few steps as text.
// It answers over the message channel in the shape node-pty's own script uses.
const CONSOLE_LIST_PROGRAM =
  'const list = require(process.argv[1]).getConsoleProcessList(Number(process.argv[2]));' +
  ' process.send({ consoleProcessList: list });' +
  ' process.exit(0);';

// → the path of node-pty's conpty_console_list.node as a real file on disk, or '' when it is not
//   there (then the caller keeps to node-pty's own script, as before).
//   ptyLib: node-pty's lib folder, as require.resolve gives it. In an installed app that path goes
//   through app.asar; the real file is in app.asar.unpacked (package.json asarUnpack).
//   The places are the ones node-pty itself looks in, in its order.
function consoleListNative({ ptyLib, arch = process.arch, exists = fs.existsSync }) {
  const packageFolder = path
    .dirname(ptyLib)
    .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  const places = ['build/Release', 'build/Debug', 'prebuilds/win32-' + arch];
  for (const place of places) {
    const file = path.join(packageFolder, place, 'conpty_console_list.node');
    if (exists(file)) return file;
  }
  return '';
}

module.exports = {
  nodeHelper,
  helperEnv,
  cmdShim,
  shShim,
  runtimeEnv,
  processList,
  CONSOLE_LIST_PROGRAM,
  consoleListNative,
};

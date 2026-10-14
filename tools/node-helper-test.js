// Test of desktop/node-helper.js: node tools/node-helper-test.js (plain Node). Which program runs
// the app's small Node scripts, and what the command stand-ins in a terminal panel look like:
// unchanged while no Node runtime is shipped, and through the shipped runtime (never the app "as
// Node") once it is.
const path = require('path');
const {
  nodeHelper,
  helperEnv,
  cmdShim,
  shShim,
  runtimeEnv,
  processList,
  CONSOLE_LIST_PROGRAM,
  consoleListNative,
} = require('../desktop/node-helper.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

const APP = 'C:\\Programs\\App\\TechnicallyNot.ai.exe';
const RES = 'C:\\Programs\\App\\resources';
const SHIPPED = path.join(RES, 'node', 'node.exe');

// ---- which program ----
{
  const source = nodeHelper({ resourcesPath: '', execPath: APP, exists: () => true });
  check(
    'a run from source: the app itself, as Node',
    source.exe === APP && source.asNode === true,
    source
  );

  // A run from source has a resources folder too (Electron's own, inside the project). A node.exe
  // put there must not be taken: only a release build has a shipped runtime.
  const looked = [];
  const sourceWithFile = nodeHelper({
    resourcesPath: RES,
    execPath: APP,
    platform: 'win32',
    release: false,
    exists: file => (looked.push(file), true),
  });
  check(
    'a run from source with a node.exe in its resources folder: still the app itself, not looked at',
    sourceWithFile.exe === APP && sourceWithFile.asNode === true && looked.length === 0,
    [sourceWithFile, looked]
  );
  check(
    'this test run is not a release build, so by default no runtime is taken',
    nodeHelper({ resourcesPath: RES, execPath: APP, exists: () => true }).asNode === true
  );

  // The same with a build-info.json that says "release" put beside the node.exe. In a run from
  // source both sit in one folder inside the project, so the file must not be what makes the
  // program trusted. Run in a process of its own, which is told that the planted folder is its
  // resources folder before build-info.js is loaded (it reads the file once, when loaded).
  {
    const fs = require('fs');
    const os = require('os');
    const { spawnSync } = require('child_process');
    const planted = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-planted-resources-'));
    try {
      fs.writeFileSync(path.join(planted, 'build-info.json'), '{"release":true}');
      fs.mkdirSync(path.join(planted, 'node'));
      const program = path.join(
        planted,
        'node',
        process.platform === 'win32' ? 'node.exe' : 'node'
      );
      fs.writeFileSync(program, 'not a real program');
      const asked =
        // defineProperty: in Electron's Node the value is there already and cannot be assigned
        'Object.defineProperty(process, "resourcesPath", { value: process.cwd(), configurable: true });' +
        ' const info = require(process.argv[1]);' +
        ' const helper = require(process.argv[2]).nodeHelper({ resourcesPath: process.cwd(), execPath: "THE-APP" });' +
        ' console.log(JSON.stringify({ release: info.release, byCode: info.releaseByCode, helper }));';
      const run = spawnSync(
        process.execPath,
        [
          '-e',
          asked,
          path.join(__dirname, '..', 'desktop', 'build-info.js'),
          path.join(__dirname, '..', 'desktop', 'node-helper.js'),
        ],
        { cwd: planted, encoding: 'utf8' }
      );
      let answer = {};
      try {
        answer = JSON.parse(run.stdout);
      } catch {
        answer = { error: run.stdout + run.stderr };
      }
      check(
        'a planted build-info.json is read: "release" means what it always meant',
        answer.release === true && answer.byCode === false,
        answer
      );
      check(
        'a planted build-info.json beside a planted node.exe: still the app itself, as Node',
        answer.helper?.exe === 'THE-APP' && answer.helper?.asNode === true,
        answer
      );
    } finally {
      fs.rmSync(planted, { recursive: true, force: true });
    }
    check('the planted folder is gone', !fs.existsSync(planted));
  }

  const oldBuild = nodeHelper({
    resourcesPath: RES,
    execPath: APP,
    platform: 'win32',
    release: true,
    exists: () => false,
  });
  check(
    'a build with no runtime in it: the app itself, as Node',
    oldBuild.exe === APP && oldBuild.asNode,
    oldBuild
  );

  const asked = [];
  const newBuild = nodeHelper({
    resourcesPath: RES,
    execPath: APP,
    platform: 'win32',
    release: true,
    exists: file => (asked.push(file), true),
  });
  check(
    'a build with the runtime: the runtime, not as Node',
    newBuild.exe === SHIPPED && newBuild.asNode === false,
    newBuild
  );
  check(
    'it looks in resources/node/node.exe and nowhere else',
    asked.length === 1 && asked[0] === SHIPPED,
    asked
  );

  const mac = nodeHelper({
    resourcesPath: '/App/Resources',
    execPath: '/App/app',
    platform: 'darwin',
    release: true,
    exists: () => true,
  });
  check(
    'Mac and Linux: resources/node/node',
    mac.exe === path.join('/App/Resources', 'node', 'node'),
    mac
  );
}

// ---- the environment ----
{
  const asNode = helperEnv({ exe: APP, asNode: true }, { PATH: 'p', OTHER: '1' });
  check(
    'as Node: the variable is set and the rest kept',
    asNode.ELECTRON_RUN_AS_NODE === '1' && asNode.PATH === 'p' && asNode.OTHER === '1'
  );
  const real = helperEnv({ exe: SHIPPED, asNode: false }, { PATH: 'p', ELECTRON_RUN_AS_NODE: '1' });
  check(
    'the runtime: the variable is taken out, the rest kept',
    !('ELECTRON_RUN_AS_NODE' in real) && real.PATH === 'p',
    real
  );
}

// ---- the stand-ins while the app runs as Node: what was written before, plus one word on the
// setlocal line (a "!" in a path must not be read as a variable) ----
{
  const today = { exe: APP, asNode: true };
  check(
    'Windows .cmd, as before but for DisableDelayedExpansion',
    cmdShim('claude', today) ===
      [
        '@echo off',
        'setlocal DisableDelayedExpansion',
        'set "ELECTRON_RUN_AS_NODE=1"',
        '"%TNAI_NODE%" "%~dp0tnai-shim.js" claude %*',
        'exit /b %ERRORLEVEL%',
        '',
      ].join('\r\n'),
    cmdShim('claude', today)
  );
  check(
    'Mac and Linux sh, unchanged',
    shShim('codex', today) ===
      '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$TNAI_NODE" "$TNAI_SHIM" codex "$@"\n',
    shShim('codex', today)
  );
  check(
    'the tnai script for Git Bash, unchanged',
    shShim('tnai', today, { gitBash: true }) ===
      '#!/bin/sh\nMSYS_NO_PATHCONV=1 ELECTRON_RUN_AS_NODE=1 exec "$TNAI_NODE" "$TNAI_SHIM" tnai "$@"\n',
    shShim('tnai', today, { gitBash: true })
  );
}

// ---- the stand-ins with the shipped runtime ----
{
  const shipped = { exe: SHIPPED, asNode: false };
  const cmd = cmdShim('tnai', shipped);
  check(
    '.cmd: the runtime path is written into the file',
    cmd.includes('"' + SHIPPED + '" "%~dp0tnai-shim.js" tnai %*'),
    cmd
  );
  check(
    '.cmd: the program is not taken from the panel (an old panel still names the app)',
    !cmd.includes('%TNAI_NODE%')
  );
  check(
    '.cmd: nothing starts the app as Node',
    !cmd.includes('ELECTRON_RUN_AS_NODE=1') && cmd.includes('set "ELECTRON_RUN_AS_NODE="')
  );
  check(
    '.cmd: Windows line ends and the exit code handed on',
    cmd.endsWith('exit /b %ERRORLEVEL%\r\n')
  );

  // A path with a letter outside plain ASCII cannot be written into a .cmd file: cmd.exe reads the
  // file in the console's code page and would look for other letters.
  for (const folder of ['José', '日本語']) {
    const exe = 'C:\\Users\\' + folder + '\\App\\resources\\node\\node.exe';
    const text = cmdShim('tnai', { exe, asNode: false });
    check(
      '.cmd, install path with "' + folder + '": the file holds plain ASCII only',
      /^[\x00-\x7f]*$/.test(text),
      text
    );
    check(
      '.cmd, install path with "' + folder + '": the runtime comes from the panel\'s TNAI_RUNTIME',
      text.includes('"%TNAI_RUNTIME%" "%~dp0tnai-shim.js" tnai %*') &&
        !text.includes('%TNAI_NODE%'),
      text
    );
    check(
      '.cmd, install path with "' + folder + '": a panel without the variable is told to reopen',
      /if not defined TNAI_RUNTIME echo tnai: .*open it again.* & exit \/b 1/.test(text),
      text
    );

    // The variable is also missing when a tool started in the panel cleared the environment, so
    // the sentence says what is the case and not why.
    check(
      '.cmd, install path with "' +
        folder +
        '": the sentence is true whatever removed the variable',
      text.includes(
        'echo tnai: no Technically Not runtime is set in this terminal panel. Close the panel and open it again. 1>&2 & exit /b 1'
      ) && !/was updated/.test(text),
      text
    );
    check(
      'the panel is given that path under TNAI_RUNTIME',
      runtimeEnv({ exe, asNode: false }).TNAI_RUNTIME === exe
    );
  }
  check(
    'while the app runs its scripts itself, the panel gets no TNAI_RUNTIME',
    !('TNAI_RUNTIME' in runtimeEnv({ exe: APP, asNode: true }))
  );

  const odd = cmdShim('tnai', { exe: 'C:\\Users\\50%off\\node.exe', asNode: false });
  check(
    '.cmd: a percent sign in the path is doubled, so it is no variable',
    odd.includes('"C:\\Users\\50%%off\\node.exe"'),
    odd
  );

  const sh = shShim('claude', { exe: '/App/Resources/node/node', asNode: false });
  check(
    'sh: the runtime path, quoted, and no "as Node"',
    sh === '#!/bin/sh\nexec \'/App/Resources/node/node\' "$TNAI_SHIM" claude "$@"\n',
    sh
  );
  const quote = shShim('claude', { exe: "/Users/o'brien/node", asNode: false });
  check(
    'sh: a quote mark in the path cannot end the quoting',
    quote.includes("'/Users/o'\\''brien/node'"),
    quote
  );
  const bash = shShim('tnai', shipped, { gitBash: true });
  check(
    'Git Bash: forward slashes and no path rewriting',
    bash.startsWith(
      "#!/bin/sh\nMSYS_NO_PATHCONV=1 exec 'C:/Programs/App/resources/node/node.exe' "
    ),
    bash
  );
}

// ---- a stand-in written for a shipped runtime really runs (this Node stands in for the runtime)
// --
{
  const fs = require('fs');
  const os = require('os');
  const { spawnSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai node helper '));
  const runtime = { exe: process.execPath, asNode: false };

  // what the stand-in runs: it prints the command name, its arguments and the "as Node" variable
  fs.writeFileSync(
    path.join(dir, 'tnai-shim.js'),
    'console.log(JSON.stringify([process.argv.slice(2), process.env.ELECTRON_RUN_AS_NODE || ""]));\n' +
      'process.exit(7);\n'
  );
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', TNAI_NODE: 'C:\\nowhere\\old-app.exe' };
  let run;
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'tnai.cmd'), cmdShim('tnai', runtime));

    // one command line for the system's shell, the way a terminal panel runs a stand-in
    run = spawnSync('"' + path.join(dir, 'tnai.cmd') + '" agents "two words"', {
      shell: true,
      env,
      encoding: 'utf8',
    });
  } else {
    const file = path.join(dir, 'tnai');
    fs.writeFileSync(file, shShim('tnai', runtime), { mode: 0o755 });
    run = spawnSync(file, ['agents', 'two words'], {
      env: { ...env, TNAI_SHIM: path.join(dir, 'tnai-shim.js') },
      encoding: 'utf8',
    });
  }
  let printed = null;
  try {
    printed = JSON.parse(run.stdout.trim());
  } catch {
    /* reported below */
  }
  check(
    'run for real, from a folder with spaces: the script got the name and its arguments',
    JSON.stringify(printed?.[0]) === '["tnai","agents","two words"]',
    [run.stdout, run.stderr]
  );
  check(
    'run for real: the old program named in the panel was not used, and "as Node" was not handed on',
    printed?.[1] === '',
    printed
  );
  check("run for real: the script's exit code comes back", run.status === 7, run.status);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- where the process-list helper's native file is (needs no runtime, no real file) ----
{
  const sourceLib = 'C:\\Project\\node_modules\\node-pty\\lib';
  const sourceFile =
    'C:\\Project\\node_modules\\node-pty\\prebuilds\\win32-x64\\conpty_console_list.node';
  const fromSource = consoleListNative({
    ptyLib: sourceLib,
    arch: 'x64',
    exists: file => file === path.join(sourceFile),
  });
  check(
    'native file, a run from source: beside node-pty',
    fromSource === path.join(sourceFile),
    fromSource
  );

  const installedLib = 'C:\\App\\resources\\app.asar\\node_modules\\node-pty\\lib';
  const asked = [];
  const installed = consoleListNative({
    ptyLib: installedLib,
    arch: 'x64',
    exists: file => (asked.push(file), file.includes('prebuilds')),
  });
  check(
    'native file, an installed app: in app.asar.unpacked, never inside the asar',
    installed ===
      path.join(
        'C:\\App\\resources\\app.asar.unpacked\\node_modules\\node-pty\\prebuilds\\win32-x64',
        'conpty_console_list.node'
      ) && asked.every(file => !/app\.asar[\\/]/.test(file)),
    [installed, asked]
  );
  check(
    'native file, a build made on this PC: build/Release comes first, as node-pty looks',
    consoleListNative({ ptyLib: sourceLib, arch: 'x64', exists: () => true }).includes(
      path.join('build', 'Release')
    )
  );
  check(
    'native file not there: empty, so the caller keeps to what it did before',
    consoleListNative({ ptyLib: installedLib, arch: 'arm64', exists: () => false }) === ''
  );

  // what the list helper sends is handed to node-pty, which ends every process named in it
  check('process list: process ids are passed on', processList([4, 1200])?.length === 2);
  const notLists = [undefined, null, 'x', {}, [], [0], [-5], [1.5], ['12'], [12, null], [NaN]];
  check(
    'process list: anything that is not a list of whole numbers above zero is not',
    notLists.every(value => processList(value) === null),
    notLists.filter(value => processList(value) !== null)
  );
  check(
    'the one-line program answers in the shape node-pty reads',
    CONSOLE_LIST_PROGRAM.includes('consoleProcessList') &&
      CONSOLE_LIST_PROGRAM.includes('process.argv[1]') &&
      CONSOLE_LIST_PROGRAM.includes('process.argv[2]')
  );
}

// ---- the two rules are wired into the app (read from the source: these files need Electron) ----
{
  const fs = require('fs');
  const sourceOf = name => fs.readFileSync(path.join(__dirname, '..', 'desktop', name), 'utf8');
  check(
    'agent-mesh.js gives every terminal panel the runtime path (TNAI_RUNTIME)',
    /\.\.\.\s*runtimeEnv\s*\(\s*helper\s*\)/.test(sourceOf('agent-mesh.js'))
  );
  check(
    "pty-service.js passes the list helper's answer through the shape check",
    /finish\s*\(\s*processList\s*\(\s*message\?\.consoleProcessList\s*\)\s*\|\|\s*\[\s*shell\s*\]\s*\)/.test(
      sourceOf('pty-service.js')
    )
  );
}

// Waits for a child process to end. → true when it ended within the time, false when it did not.
function ended(child, withinMs) {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), withinMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

// ---- with the real Node runtime the installer ships (fetched by tools/fetch-node-runtime.js) ----
// The app's own scripts, run by that runtime from a made-up resources folder, with nothing started
// as Node: the real stand-in script behind .cmd and sh stand-ins, the quit watcher's text taken
// from main.js, and node-pty's process-list helper over the message channel. Skipped when the
// runtime was not fetched on this computer.
async function withShippedRuntime() {
  const fs = require('fs');
  const os = require('os');
  const { spawn, spawnSync } = require('child_process');
  const windows = process.platform === 'win32';
  const osName = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
  const fetched = path.join(
    __dirname,
    '..',
    'build-resources',
    'node',
    osName + '-' + process.arch
  );
  const programName = windows ? 'node.exe' : 'node';
  if (!fs.existsSync(path.join(fetched, programName))) {
    console.log('skip: no fetched Node runtime here (node tools/fetch-node-runtime.js gets it)');
    return;
  }

  // resources/node is a link to the fetched folder, so the 90 MB program is not copied
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai shipped node '));
  const resources = path.join(dir, 'resources');
  fs.mkdirSync(resources);
  fs.symlinkSync(fetched, path.join(resources, 'node'), 'junction');
  const helper = nodeHelper({
    resourcesPath: resources,
    execPath: 'C:\\nowhere\\app.exe',
    release: true,
  });
  check(
    'shipped runtime: found in the resources folder, not as Node',
    helper.exe === path.join(resources, 'node', programName) && helper.asNode === false,
    helper
  );
  const versions = spawnSync(
    helper.exe,
    ['-p', 'process.versions.node + "|" + (process.versions.electron || "")'],
    { encoding: 'utf8' }
  );
  check(
    'shipped runtime: a plain Node, no Electron in it',
    /^\d+\.\d+\.\d+\|\s*$/.test(versions.stdout),
    versions.stdout
  );

  // The stand-in folder as the app writes it (agent-mesh.js writeShims): the real script under the
  // name tnai-shim.js, and a stand-in file per command name.
  const shims = path.join(dir, 'agent shims');
  fs.mkdirSync(shims);
  const shimScript = path.join(shims, 'tnai-shim.js');
  fs.copyFileSync(path.join(__dirname, '..', 'desktop', 'agent-shim.js'), shimScript);

  // a made-up CLI later on PATH: what the stand-in must find and run when no app answers
  const cliFolder = path.join(dir, 'cli');
  fs.mkdirSync(cliFolder);
  if (windows) {
    fs.writeFileSync(
      path.join(cliFolder, 'fakecli.cmd'),
      '@echo off\r\necho fake cli got %*\r\necho node-mode=[%ELECTRON_RUN_AS_NODE%]\r\nexit /b 5\r\n'
    );
  } else {
    fs.writeFileSync(
      path.join(cliFolder, 'fakecli'),
      '#!/bin/sh\necho "fake cli got $*"\necho "node-mode=[$ELECTRON_RUN_AS_NODE]"\nexit 5\n',
      { mode: 0o755 }
    );
  }

  // A terminal panel's environment after an update: it still names the old program and "as Node".
  // No panel token and no port, so the script must behave as it does without the app.
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', TNAI_NODE: 'C:\\nowhere\\old-app.exe' };
  delete env.TNAI_PANE_TOKEN;

  // A test run inside a Technically Not panel inherits the panel's runtime; the old panel has none.
  delete env.TNAI_RUNTIME;
  delete env.TNAI_MESH_PORT;
  env.TNAI_SHIM = shimScript;
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = [shims, cliFolder, env[pathKey]].join(path.delimiter);

  // runs one stand-in the way a terminal panel does: by its name, through the system's shell
  const runStandIn = (name, words) => {
    if (windows) {
      fs.writeFileSync(path.join(shims, name + '.cmd'), cmdShim(name, helper));
      return spawnSync('"' + path.join(shims, name + '.cmd') + '" ' + words, {
        shell: true,
        env,
        encoding: 'utf8',
      });
    }
    fs.writeFileSync(path.join(shims, name), shShim(name, helper), { mode: 0o755 });
    return spawnSync(path.join(shims, name) + ' ' + words, { shell: true, env, encoding: 'utf8' });
  };

  const help = runStandIn('tnai', 'help');
  check(
    'real script, shipped runtime: `tnai help` prints the commands',
    help.status === 0 && help.stdout.startsWith('tnai: talk to the other AI agents'),
    [help.status, help.stdout.slice(0, 80), help.stderr]
  );
  const agents = runStandIn('tnai', 'agents');
  check(
    'real script, shipped runtime: `tnai agents` without the app says so and exits 2',
    agents.status === 2 && agents.stderr.includes('was not started by Technically Not'),
    [agents.status, agents.stderr]
  );
  const cli = runStandIn('fakecli', 'one "two words"');
  check(
    'real script, shipped runtime: an agent command finds the real CLI and runs it with its words',
    cli.stdout.includes('fake cli got') && cli.stdout.includes('two words'),
    [cli.stdout, cli.stderr]
  );
  check(
    'real script, shipped runtime: the CLI does not inherit "as Node", and its exit code comes back',
    cli.stdout.includes('node-mode=[]') && cli.status === 5,
    [cli.status, cli.stdout]
  );

  // The sh stand-in of `tnai` for Git Bash (Claude Code's Bash tool runs it on Windows).
  if (windows) {
    const gitSh = path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Git',
      'bin',
      'sh.exe'
    );
    if (fs.existsSync(gitSh)) {
      fs.writeFileSync(path.join(shims, 'tnai'), shShim('tnai', helper, { gitBash: true }));
      const bash = spawnSync(gitSh, [path.join(shims, 'tnai'), 'agents'], {
        env,
        encoding: 'utf8',
      });
      check(
        'real script, shipped runtime: the Git Bash stand-in runs it too',
        bash.status === 2 && bash.stderr.includes('was not started by Technically Not'),
        [bash.status, bash.stderr]
      );
    } else console.log('skip: no Git Bash here for the sh stand-in');
  }

  // Install folders whose names cmd.exe cannot read out of a .cmd file, or reads differently: an
  // accent, letters that are not Latin, and a "!" with delayed expansion switched on. Each gets
  // its own made-up install with the real runtime, and `tnai help` is run through cmd.exe.
  if (windows) {
    const installedIn = folderName => {
      const install = path.join(dir, folderName, 'resources');
      fs.mkdirSync(install, { recursive: true });
      fs.symlinkSync(fetched, path.join(install, 'node'), 'junction');
      return nodeHelper({
        resourcesPath: install,
        execPath: 'C:\\nowhere\\app.exe',
        release: true,
      });
    };
    let standInFolders = 0;
    const runThroughCmd = (runtime, { panelEnv, delayedExpansion = false }) => {
      const folder = path.join(dir, 'stand-ins ' + ++standInFolders);
      fs.mkdirSync(folder);
      fs.copyFileSync(shimScript, path.join(folder, 'tnai-shim.js'));
      fs.writeFileSync(path.join(folder, 'tnai.cmd'), cmdShim('tnai', runtime));

      // one command line handed to cmd.exe as it is, the way a shell starts a .cmd file
      const line = '""' + path.join(folder, 'tnai.cmd') + '" help"';
      const flags = delayedExpansion ? ['/v:on'] : [];
      return spawnSync('cmd.exe', [...flags, '/d', '/s', '/c', line], {
        env: { ...env, ...panelEnv },
        encoding: 'utf8',
        windowsVerbatimArguments: true,
      });
    };
    const printsHelp = run =>
      run.status === 0 && run.stdout.startsWith('tnai: talk to the other AI agents');

    for (const folderName of ['José', '日本語']) {
      const runtime = installedIn(folderName);
      const inPanel = runThroughCmd(runtime, { panelEnv: runtimeEnv(runtime) });
      check(
        'run for real, installed under "' + folderName + '": the .cmd stand-in works',
        printsHelp(inPanel),
        [inPanel.status, inPanel.stdout.slice(0, 60), inPanel.stderr]
      );
      const oldPanel = runThroughCmd(runtime, { panelEnv: {} });
      check(
        'run for real, installed under "' +
          folderName +
          '": a panel from before the update is told to reopen',
        oldPanel.status === 1 && /open it again/.test(oldPanel.stderr),
        [oldPanel.status, oldPanel.stderr]
      );
    }

    const bang = installedIn('bang!x!');
    const expanded = runThroughCmd(bang, { panelEnv: runtimeEnv(bang), delayedExpansion: true });
    check(
      'run for real, a "!" in the install path with delayed expansion on: the .cmd stand-in works',
      printsHelp(expanded),
      [expanded.status, expanded.stdout.slice(0, 60), expanded.stderr]
    );
  }

  // The quit watcher: the text main.js hands to the helper, taken from the file so this test runs
  // what ships. It must leave by itself when the app is gone, and end an app that stays.
  const mainText = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
  const watcherText = (mainText.match(/const\s+watcher\s*=\s*`([^`]+)`/) || [])[1] || '';
  check(
    'quit watcher: its text is found in main.js',
    watcherText.includes('${process.pid}') && watcherText.includes('10000'),
    watcherText
  );
  const startWatcher = (pid, waitMs) =>
    spawn(
      helper.exe,
      ['-e', watcherText.replace('${process.pid}', String(pid)).replace('10000', String(waitMs))],
      { env: helperEnv(helper, env), stdio: 'ignore', windowsHide: true }
    );
  const standInApp = lifeMs =>
    spawn(helper.exe, ['-e', 'setTimeout(() => {}, ' + lifeMs + ')'], {
      stdio: 'ignore',
      windowsHide: true,
    });

  // The times below are upper limits for a busy computer, never waits: each step goes on the
  // moment the process it watches has ended. Both processes are waited for before either exit
  // code is read, because their two "ended" notices can arrive in either order.
  const quitting = standInApp(600);
  const idleWatcher = startWatcher(quitting.pid, 10000);
  const appQuit = await ended(quitting, 15000);
  const watcherLeft = await ended(idleWatcher, 15000);
  check(
    'quit watcher, shipped runtime: leaves by itself once the app has quit',
    appQuit && watcherLeft && quitting.exitCode === 0,
    [appQuit, watcherLeft, idleWatcher.exitCode, quitting.exitCode]
  );
  idleWatcher.kill();

  const hanging = standInApp(60000);
  const killingWatcher = startWatcher(hanging.pid, 1200);
  const wasEnded = await ended(hanging, 20000);
  check(
    'quit watcher, shipped runtime: ends an app that is still there after the wait',
    wasEnded && hanging.exitCode !== 0,
    [wasEnded, hanging.exitCode, hanging.signalCode]
  );
  check('quit watcher, shipped runtime: then leaves', await ended(killingWatcher, 15000));
  hanging.kill();
  killingWatcher.kill();

  // The helper that lists the processes of a closed panel's console, started the way
  // pty-service.js starts it with a shipped runtime: one line of program text and the native file
  // by its path, the answer over the message channel.
  if (windows) {
    const nativeFile = consoleListNative({
      ptyLib: path.dirname(require.resolve('node-pty/lib/windowsPtyAgent')),
    });
    check(
      'process-list helper: the native file is found in a run from source',
      nativeFile.endsWith('conpty_console_list.node') && fs.existsSync(nativeFile),
      nativeFile
    );

    // A shell with a console of its own and no window, as a panel's shell has, and a child process
    // under it. It prints a word once it runs: asked before that, its console may not exist yet.
    const shell = spawn('cmd.exe', ['/d', '/c', 'echo ready& ping -n 30 127.0.0.1 >nul'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    await new Promise(resolve => {
      shell.stdout.once('data', resolve);
      shell.once('exit', resolve);
    });

    // the answer itself is waited for; the helper's end can be noticed before its answer is read
    const agent = spawn(helper.exe, ['-e', CONSOLE_LIST_PROGRAM, nativeFile, String(shell.pid)], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: helperEnv(helper, env),
      windowsHide: true,
    });
    const list = await new Promise(resolve => {
      const giveUp = setTimeout(() => resolve(null), 15000);
      const answer = value => {
        clearTimeout(giveUp);
        resolve(value);
      };
      agent.once('message', message => answer(message.consoleProcessList));

      // the channel closes only after every message sent on it was read
      agent.once('disconnect', () => answer(null));
    });
    check(
      'process-list helper, shipped runtime: the list comes back with the shell in it',
      Array.isArray(list) && list.includes(shell.pid),
      [agent.exitCode, list]
    );
    check(
      'process-list helper, shipped runtime: the child process under the shell is in it too',
      Array.isArray(list) && list.filter(pid => pid !== shell.pid && pid !== agent.pid).length >= 1,
      [shell.pid, agent.pid, list]
    );
    agent.kill();
    spawnSync('taskkill', ['/T', '/F', '/PID', String(shell.pid)], { stdio: 'ignore' });
  }

  fs.rmSync(dir, { recursive: true, force: true });
}

withShippedRuntime().then(() => {
  console.log(`\n${passed} passed, ${failed} failed (Node ${process.versions.node})`);
  process.exit(failed ? 1 : 0);
});

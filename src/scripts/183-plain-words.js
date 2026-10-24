/*
 * Technically Not · 183-plain-words.js — what an agent is doing, in plain words.
 *
 * The thread list's second line and the open thread's Working line said what the tool reported,
 * word for word: "Running cd "/c/Users/…/Muppet Avatar" && tracker/.venv/Scripts/python
 * soak_test.py". This file turns one tool call into a few plain words ("Running a test"), the
 * folder it runs in ("Muppet Avatar", shown as a chip where there is room) and the raw text, which
 * stays the tip on hover. Nothing is guessed beyond the call itself: a command is named by what it
 * starts, a file step by the file's own name.
 *
 * Every agent CLI whose steps reach the app gets the same words: Claude Code's hooks, OpenCode's
 * steps (desktop/agent-hooks.js maps their tool names to Claude Code's), and the file steps read
 * from the output of the other CLIs (13). Callers: 53 `doing`, 104 `describe`, 119's sub-agent
 * rows.
 *
 * `window.TnaiPlainWords` (`step`, `file`); in Node `module.exports`, for
 * tools/plain-words-test.js.
 */
(() => {
  'use strict';

  // ---------- small helpers ----------
  const clip = (text, size) => {
    const flat = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    return flat.length > size ? flat.slice(0, size - 1) + '…' : flat;
  };

  // The last part of a path, with or without quotes and slashes at its end.
  const lastPart = path =>
    String(path || '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || '';

  // ---------- a shell command ----------
  // A command that starts by moving into a folder ("cd X && …", "Set-Location X; …"): the folder,
  // and the command after it.
  const MOVE_INTO =
    /^\s*(?:cd|pushd|set-location|sl)\s+(?:\/d\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;|\|\|)\s*/i;

  function splitFolder(command) {
    const moved = String(command || '').match(MOVE_INTO);
    if (!moved) return { folder: '', rest: String(command || '').trim() };
    return { folder: lastPart(moved[1]), rest: command.slice(moved[0].length).trim() };
  }

  // The program a command starts, without its folder and ".exe": "tracker/.venv/Scripts/python"
  // is "python".
  function programOf(command) {
    const first = String(command || '')
      .trim()
      .match(/^(?:&\s*)?("[^"]+"|'[^']+'|\S+)/);
    return first
      ? lastPart(first[1])
          .toLowerCase()
          .replace(/\.(exe|cmd|bat)$/, '')
      : '';
  }

  // The first script file a command names ("node tools/format-code.js x" is format-code.js).
  function scriptOf(command) {
    const named = String(command || '').match(
      /(?:^|\s)["']?([^\s"']+\.(?:js|mjs|cjs|ts|py|ps1|sh|rb))\b/i
    );
    return named ? lastPart(named[1]) : '';
  }

  // A test, wherever it is named in the command: a test runner, "npm test", or a file whose name
  // says test ("soak_test.py", "thread-list-test.js", "test_rows.py").
  const TEST =
    /\b(?:pytest|jest|vitest|mocha|playwright\s+test|(?:cargo|go|dotnet|deno|bun)\s+test|(?:npm|pnpm|yarn)\s+(?:run\s+)?test)\b|[\w.-]*(?:[-_.]test|test[-_])[\w.-]*\.(?:js|mjs|cjs|ts|py)\b|[\\/]tests?[\\/]/i;
  const CHECK = /\bcheck-syntax\b|\bdesktop-check\b|[\w-]+-check\.(?:js|mjs)\b|\bformat:check\b/i;
  const INSTALL =
    /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|ci)\b|\bpip3?\s+install\b|\b(?:winget|choco|scoop|brew|apt|apt-get)\s+install\b|\bcargo\s+(?:add|install)\b/i;
  const BUILD =
    /\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:build|dist|pack)\b|\btsc\b|\b(?:cargo|go|dotnet)\s+build\b|\bvite\s+build\b|\belectron-builder\b|^make\b/i;
  const FORMAT = /\b(?:prettier|eslint|format-code|ruff|black|lint)\b/i;

  // What a program does, by its name, when nothing above named it.
  const PROGRAMS = [
    [/^(?:ls|dir|tree|get-childitem|gci|find|fd|wc)$/, 'Listing files'],
    [/^(?:cat|type|head|tail|less|more|get-content|gc)$/, 'Reading a file'],
    [/^(?:grep|rg|findstr|select-string|sls)$/, 'Searching the code'],
    [/^(?:curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm)$/, 'Fetching a page'],
    [/^(?:mkdir|md|new-item|ni|touch)$/, 'Making files'],
    [/^(?:cp|copy|copy-item|mv|move|move-item|ren|rename-item)$/, 'Moving files'],
    [/^(?:rm|del|rmdir|rd|remove-item)$/, 'Removing files'],
    [/^(?:sleep|start-sleep|timeout)$/, 'Waiting'],
    [/^(?:echo|write-output|write-host|printf)$/, 'Printing a note'],
    [/^(?:tnai)$/, 'Coordinating agents'],
    [/^(?:gh)$/, 'Using GitHub'],
    [/^(?:taskkill|kill|stop-process)$/, 'Stopping a process'],
    [/^(?:ffmpeg|ffprobe|magick|convert)$/, 'Working on media'],
    [/^(?:blender)$/, 'Running Blender'],
  ];
  const GIT = [
    [/^commit\b/, 'Committing'],
    [/^push\b/, 'Pushing'],
    [/^(?:pull|fetch|clone)\b/, 'Getting changes'],
    [/^(?:add|rm|mv)\b/, 'Staging changes'],
    [/^(?:status|diff|log|show|blame|branch|grep|ls-files|rev-parse)\b/, 'Looking at changes'],
  ];
  const SCRIPT_RUNNERS =
    /^(?:node|python|python3|py|deno|bun|ruby|npx|pwsh|powershell|bash|sh|tsx|ts-node)$/;

  function commandWords(command) {
    const { folder, rest } = splitFolder(command);
    const program = programOf(rest);
    let text = '';
    if (TEST.test(rest)) text = 'Running a test';
    else if (CHECK.test(rest)) text = 'Running a check';
    else if (INSTALL.test(rest)) text = 'Installing packages';
    else if (BUILD.test(rest)) text = 'Building';
    else if (FORMAT.test(rest)) text = 'Formatting code';
    else if (program === 'git') {
      const after = rest.replace(/^\S+\s+(?:-C\s+("[^"]+"|\S+)\s+)?/, '');
      text = (GIT.find(([pattern]) => pattern.test(after)) || [0, 'Using git'])[1];
    } else if (SCRIPT_RUNNERS.test(program)) {
      const script = scriptOf(rest);
      const npmScript = rest.match(/^npm\s+run\s+([\w:.-]+)/i);
      text = script
        ? 'Running ' + script
        : npmScript
          ? 'Running ' + npmScript[1]
          : 'Running a script';
    } else if (program === 'sed' || program === 'awk') {
      // "sed -i" changes the file in place; any other sed or awk only prints part of it
      text = /\s-i\b/.test(rest) ? 'Editing a file' : 'Reading a file';
    } else if (/^(?:npm|pnpm|yarn)$/.test(program)) {
      const npmScript = rest.match(/^\S+\s+(?:run\s+)?([\w:.-]+)/i);
      text = npmScript ? 'Running ' + npmScript[1] : 'Running a command';
    } else {
      const known = PROGRAMS.find(([pattern]) => pattern.test(program));
      const script = scriptOf(rest);
      text = known ? known[1] : script ? 'Running ' + script : 'Running a command';
    }
    return { text, folder };
  }

  // ---------- one tool call ----------
  // Claude Code's tool names (OpenCode's are mapped to them by desktop/agent-hooks.js).
  const FILE_TOOLS = {
    Edit: 'Editing',
    MultiEdit: 'Editing',
    NotebookEdit: 'Editing',
    Write: 'Writing',
    Read: 'Reading',
  };
  const SIMPLE_TOOLS = {
    Glob: 'Looking for files',
    TodoWrite: 'Updating its plan',
    Agent: 'Starting a helper',
    Task: 'Starting a helper',
    AskUserQuestion: 'Asking you a question',
    ExitPlanMode: 'Showing its plan',
    ToolSearch: 'Looking up its tools',
    BashOutput: 'Checking a background task',
    Monitor: 'Watching a background task',
    KillShell: 'Stopping a background task',
    TaskStop: 'Stopping a background task',
  };

  // "mcp__claude-in-chrome__navigate" is the browser; "mcp__github__x" is GitHub.
  function serverWords(tool) {
    const server = tool.split('__')[1] || '';
    if (/^tnai$/i.test(server)) return 'Coordinating agents';
    if (/chrome|browser|playwright|puppeteer/i.test(server)) return 'Using the browser';
    const name = server
      .replace(/^claude_ai_/i, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    return name ? 'Using ' + name : 'Using a tool';
  }

  function hostOf(address) {
    const found = String(address || '').match(/^\w+:\/\/([^/?#]+)/);
    return found ? found[1].replace(/^www\./, '') : clip(address, 40);
  }

  // { text, folder, raw } for one tool call: raw is the call as the tool reported it.
  function step(tool, detail) {
    const name = String(tool || '');
    const said = String(detail || '').trim();
    const raw = said ? (name === 'Bash' || name === 'PowerShell' ? said : name + ' ' + said) : name;
    let text = '';
    let folder = '';
    if (!name) text = 'Thinking';
    else if (name === 'Bash' || name === 'PowerShell') {
      const words = said ? commandWords(said) : { text: 'Running a command', folder: '' };
      text = words.text;
      folder = words.folder;
    } else if (FILE_TOOLS[name])
      text = FILE_TOOLS[name] + (said ? ' ' + lastPart(said) : ' a file');
    else if (SIMPLE_TOOLS[name]) text = SIMPLE_TOOLS[name];
    else if (name === 'Grep')
      text = said ? 'Searching for ' + clip(said, 40) : 'Searching the code';
    else if (name === 'WebFetch') text = said ? 'Reading ' + hostOf(said) : 'Reading a page';
    else if (name === 'WebSearch')
      text = said ? 'Searching the web for ' + clip(said, 40) : 'Searching the web';
    else if (name === 'Skill')
      text = said ? 'Using the ' + clip(said, 40) + ' skill' : 'Using a skill';
    else if (/^mcp__/.test(name)) text = serverWords(name);
    else text = 'Using ' + clip(name, 40);
    return { text, folder, raw };
  }

  // A file step read from a CLI's output (13: a verb such as "Edited" and a path).
  function file(verb, path) {
    const word = String(verb || '');
    const doing = /^(?:read|view)/i.test(word)
      ? 'Reading'
      : /^(?:writ|wrote|creat|added)/i.test(word)
        ? 'Writing'
        : /^delet/i.test(word)
          ? 'Removing'
          : 'Editing';
    return { text: doing + ' ' + lastPart(path), folder: '', raw: word + ' ' + String(path || '') };
  }

  const api = { step, file };
  if (typeof window !== 'undefined') window.TnaiPlainWords = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

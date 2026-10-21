/*
 * Technically Not desktop · cli-commands.js — what the "/" and "$" list above the prompt box
 * (src/scripts/160-prompt-picker.js) offers for the open thread's CLI: the CLI's own built-in
 * commands, the command files the user and the project wrote for it, and the skills it reads.
 *
 * The built-in lists were read from each CLI installed on this PC on 2026-10-21, not written
 * from memory: Claude Code 2.1.306 (the command table inside its program), Codex 0.163.0 (the
 * command names and their help lines inside codex.exe), Cursor Agent 2026.10.14 (its command
 * table in index.js), OpenCode 1.19.3 (its program and opencode.ai/docs/tui) and GitHub Copilot
 * CLI 1.0.98 (`copilot help commands`). A CLI update can add or drop one: check again with
 * those sources, then change the list here.
 *
 * The user's and the project's own files are read when the list opens (a few small folders,
 * never a walk of the project), so a command or skill added a moment ago is there.
 *
 * How each CLI is told to use a skill (checked the same day):
 * - Claude Code, Cursor Agent, OpenCode, GitHub Copilot: "/skill-name";
 * - Codex: "$skill-name".
 * Codex 0.163 has no command files of its own any more, and Copilot CLI has none at all.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// The CLIs' own commands: [name, one short line]. Only commands a person would pick from a list;
// hidden, account-only and debug commands are left out.
const BUILT_IN = {
  'Claude Code': [
    ['/compact', 'Shrink the conversation to a summary'],
    ['/clear', 'Start the conversation fresh'],
    ['/init', 'Write a CLAUDE.md about this project'],
    ['/model', 'Pick the model'],
    ['/effort', 'Set how hard the model thinks'],
    ['/resume', 'Open an earlier conversation'],
    ['/rename', 'Rename this conversation'],
    ['/context', 'How full the context is'],
    ['/usage', 'Session cost and plan usage'],
    ['/status', 'Version, model, account and connections'],
    ['/config', 'The CLI’s own settings'],
    ['/permissions', 'What the agent may do without asking'],
    ['/mcp', 'Manage MCP servers'],
    ['/memory', 'Edit CLAUDE.md files and memory'],
    ['/hooks', 'See the hooks for tool events'],
    ['/plugin', 'Manage plugins'],
    ['/skills', 'List the skills it can use'],
    ['/plan', 'Plan first, change nothing yet'],
    ['/diff', 'See uncommitted changes'],
    ['/rewind', 'Go back to an earlier point'],
    ['/branch', 'Branch the conversation from here'],
    ['/btw', 'Ask a side question without interrupting'],
    ['/copy', 'Copy the last answer'],
    ['/export', 'Save the conversation to a file'],
    ['/add-dir', 'Let it work in one more folder'],
    ['/tasks', 'What runs in the background'],
    ['/security-review', 'Check the pending changes for security'],
    ['/doctor', 'Check the installation'],
    ['/theme', 'Change the CLI’s colors'],
    ['/help', 'Help and every command'],
    ['/login', 'Sign in or switch accounts'],
    ['/logout', 'Sign out'],
  ],
  Codex: [
    ['/compact', 'Shrink the conversation to a summary'],
    ['/new', 'Start a new chat'],
    ['/init', 'Write an AGENTS.md for this project'],
    ['/model', 'Pick the model and reasoning effort'],
    ['/permissions', 'What Codex may do without asking'],
    ['/review', 'Review the current changes'],
    ['/resume', 'Open an earlier chat'],
    ['/fork', 'Fork this chat'],
    ['/rename', 'Rename this chat'],
    ['/plan', 'Switch to Plan mode'],
    ['/goal', 'Set the goal of a long task'],
    ['/status', 'Session settings and token use'],
    ['/diff', 'See the git diff'],
    ['/mention', 'Mention a file'],
    ['/mcp', 'List MCP tools'],
    ['/skills', 'Use skills'],
    ['/hooks', 'See the lifecycle hooks'],
    ['/memories', 'How Codex uses memory'],
    ['/side', 'A side conversation'],
    ['/copy', 'Copy the last answer'],
    ['/export', 'Save the conversation as Markdown'],
    ['/experimental', 'Turn experimental features on or off'],
    ['/theme', 'Pick the colors for code'],
    ['/statusline', 'Choose what the status line shows'],
    ['/feedback', 'Send logs to the Codex team'],
    ['/logout', 'Sign out'],
    ['/quit', 'Exit Codex'],
  ],
  'Cursor Agent': [
    ['/summarize', 'Shrink the conversation to a summary'],
    ['/clear', 'Start a new chat'],
    ['/model', 'Pick the model'],
    ['/resume', 'Open an earlier chat'],
    ['/rename', 'Rename this chat'],
    ['/fork', 'Fork this chat'],
    ['/plan', 'Plan first, change nothing yet'],
    ['/ask', 'Questions only, no changes'],
    ['/goal', 'A goal that keeps going'],
    ['/context', 'How full the context is'],
    ['/usage', 'Plan and on-demand usage'],
    ['/changes', 'Review the changes'],
    ['/commit', 'Stage and commit the changes'],
    ['/rewind', 'Go back to an earlier message'],
    ['/btw', 'A side question'],
    ['/copy', 'Copy a message'],
    ['/mcp', 'Manage MCP servers'],
    ['/rule', 'Manage Cursor rules'],
    ['/command', 'Manage your commands'],
    ['/skills', 'Open the skills menu'],
    ['/plugin', 'Manage plugins'],
    ['/add-dir', 'Let it work in one more folder'],
    ['/config', 'The CLI’s own settings'],
    ['/about', 'Version, system and account'],
    ['/help', 'Help and every command'],
    ['/logout', 'Sign out'],
  ],
  OpenCode: [
    ['/compact', 'Shrink the conversation to a summary'],
    ['/new', 'Start a new session'],
    ['/init', 'Write or update AGENTS.md'],
    ['/models', 'Pick the model'],
    ['/sessions', 'Open an earlier session'],
    ['/rename', 'Rename this session'],
    ['/fork', 'Fork this session'],
    ['/undo', 'Take back the last message and its changes'],
    ['/redo', 'Bring back what /undo took'],
    ['/timeline', 'Jump to a message'],
    ['/skills', 'Browse the skills'],
    ['/connect', 'Add a provider and its key'],
    ['/details', 'Show or hide tool details'],
    ['/thinking', 'Show or hide the thinking'],
    ['/copy', 'Copy the transcript'],
    ['/export', 'Save the conversation as Markdown'],
    ['/themes', 'Pick the colors'],
    ['/help', 'Help'],
  ],
  'GitHub Copilot': [
    ['/compact', 'Shrink the conversation to a summary'],
    ['/clear', 'Start fresh'],
    ['/new', 'Start a new conversation'],
    ['/init', 'Write Copilot instructions for this project'],
    ['/model', 'Pick the model'],
    ['/resume', 'Open an earlier session'],
    ['/rename', 'Rename this session'],
    ['/fork', 'Fork this session'],
    ['/plan', 'Plan before coding'],
    ['/review', 'Review the changes'],
    ['/security-review', 'Check the changes for security'],
    ['/diff', 'See the changes in this folder'],
    ['/pr', 'Work on the pull request'],
    ['/context', 'How full the context is'],
    ['/usage', 'Session usage'],
    ['/permissions', 'Switch the permission mode'],
    ['/agent', 'Pick an agent'],
    ['/skills', 'Manage skills'],
    ['/mcp', 'Manage MCP servers'],
    ['/plugin', 'Manage plugins'],
    ['/tasks', 'Subagents and shell commands'],
    ['/rewind', 'Take back the last turn and its changes'],
    ['/ask', 'A side question'],
    ['/copy', 'Copy the last answer'],
    ['/share', 'Share the session'],
    ['/add-dir', 'Let it work in one more folder'],
    ['/settings', 'The CLI’s own settings'],
    ['/theme', 'Pick the colors'],
    ['/help', 'Help and every command'],
    ['/login', 'Sign in'],
    ['/logout', 'Sign out'],
  ],
};

const home = () => os.homedir();
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(home(), '.claude');
const codexHome = () => process.env.CODEX_HOME || path.join(home(), '.codex');

// Where each CLI reads command files: project folders (relative) and the user's own folders.
const COMMAND_DIRS = {
  'Claude Code': {
    project: ['.claude/commands'],
    user: () => [path.join(claudeHome(), 'commands')],
  },
  'Cursor Agent': {
    project: ['.cursor/commands'],
    user: () => [path.join(home(), '.cursor', 'commands')],
  },
  OpenCode: {
    project: ['.opencode/command', '.opencode/commands'],
    user: () => [
      path.join(home(), '.config', 'opencode', 'command'),
      path.join(home(), '.config', 'opencode', 'commands'),
    ],
  },
};

// Where each CLI reads skills (one folder per skill, with a SKILL.md in it).
const SKILL_DIRS = {
  'Claude Code': {
    project: ['.claude/skills'],
    user: () => [path.join(claudeHome(), 'skills')],
  },
  Codex: {
    project: ['.agents/skills'],
    user: () => [path.join(home(), '.agents', 'skills'), path.join(codexHome(), 'skills')],
  },
  'Cursor Agent': {
    project: ['.agents/skills', '.cursor/skills', '.claude/skills', '.codex/skills'],
    user: () => [
      path.join(home(), '.agents', 'skills'),
      path.join(home(), '.cursor', 'skills'),
      path.join(claudeHome(), 'skills'),
      path.join(codexHome(), 'skills'),
    ],
  },
  OpenCode: {
    project: ['.opencode/skill', '.opencode/skills', '.claude/skills', '.agents/skills'],
    user: () => [
      path.join(home(), '.config', 'opencode', 'skill'),
      path.join(home(), '.config', 'opencode', 'skills'),
      path.join(claudeHome(), 'skills'),
      path.join(home(), '.agents', 'skills'),
    ],
  },
  'GitHub Copilot': {
    project: ['.github/skills', '.agents/skills', '.claude/skills'],
    user: () => [path.join(home(), '.copilot', 'skills'), path.join(home(), '.agents', 'skills')],
  },
};

// The sign that asks a CLI to use a skill.
const skillSign = cli => (cli === 'Codex' ? '$' : '/');

// A list never grows past this, so a folder with thousands of files cannot slow the prompt box.
const MAX_ITEMS = 200;

// Only the start of a file is read: the name and description sit in its first lines.
const HEAD_BYTES = 4096;

async function readHead(file) {
  let handle;
  try {
    handle = await fs.promises.open(file, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } catch {
    return '';
  } finally {
    await handle?.close().catch(() => {});
  }
}

// The `name:` and `description:` of a Markdown file's front matter, else its first plain line.
function describe(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const field = key => {
    const match = front && new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(front[1]);
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
  };
  const body = front ? text.slice(front[0].length) : text;
  const firstLine =
    body
      .split(/\r?\n/)
      .map(line => line.replace(/^#+\s*/, '').trim())
      .find(Boolean) || '';
  const about = field('description') || firstLine;
  return { name: field('name'), about: about.length > 90 ? about.slice(0, 89) + '…' : about };
}

async function entries(dir) {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// The command files in one folder and its subfolders (one level, as the CLIs group them).
async function commandFiles(dir, from) {
  const found = [];
  for (const entry of await entries(dir)) {
    if (entry.isFile() && /\.md$/i.test(entry.name)) found.push(path.join(dir, entry.name));
    else if (entry.isDirectory())
      for (const inner of await entries(path.join(dir, entry.name)))
        if (inner.isFile() && /\.md$/i.test(inner.name))
          found.push(path.join(dir, entry.name, inner.name));
  }
  const out = [];
  for (const file of found.slice(0, MAX_ITEMS)) {
    const { about } = describe(await readHead(file));
    out.push({
      name: '/' + path.basename(file).replace(/\.md$/i, ''),
      about: about || 'Your command',
      kind: 'own',
      from,
    });
  }
  return out;
}

// The skills in one folder: each subfolder with a SKILL.md.
async function skillFolders(dir, from, sign) {
  const out = [];
  for (const entry of (await entries(dir)).slice(0, MAX_ITEMS)) {
    if (!entry.isDirectory()) continue;
    const text = await readHead(path.join(dir, entry.name, 'SKILL.md'));
    if (!text) continue;
    const { name, about } = describe(text);
    const skillName = name || entry.name;
    out.push({ name: skillName, insert: sign + skillName, about, from });
  }
  return out;
}

// The first entry of a name wins: the project's own command or skill comes before the user's,
// as in the CLIs.
function firstOfEach(list) {
  const seen = new Set();
  return list.filter(item => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Everything the list offers for one CLI in the open project: { cli, commands, skills }.
// commands: [{ name, about, kind: 'built-in' | 'own', from }]; skills: [{ name, insert, about,
// from: 'project' | 'user' }].
async function list(cli, projectRoot) {
  const name = String(cli || '');
  if (!BUILT_IN[name]) return { cli: name, known: false, commands: [], skills: [] };

  const root = projectRoot ? String(projectRoot) : '';
  const commandDirs = COMMAND_DIRS[name];
  const skillDirs = SKILL_DIRS[name];
  const sign = skillSign(name);

  const own = [];
  if (commandDirs) {
    if (root)
      for (const rel of commandDirs.project)
        own.push(...(await commandFiles(path.join(root, rel), 'project')));
    for (const dir of commandDirs.user()) own.push(...(await commandFiles(dir, 'user')));
  }

  const skills = [];
  if (skillDirs) {
    if (root)
      for (const rel of skillDirs.project)
        skills.push(...(await skillFolders(path.join(root, rel), 'project', sign)));
    for (const dir of skillDirs.user()) skills.push(...(await skillFolders(dir, 'user', sign)));
  }

  const builtIn = BUILT_IN[name].map(([command, about]) => ({
    name: command,
    about,
    kind: 'built-in',
    from: 'cli',
  }));
  return {
    cli: name,
    known: true,
    skillSign: sign,
    commands: firstOfEach([...builtIn, ...own]),
    skills: firstOfEach(skills),
  };
}

module.exports = { list, describe, BUILT_IN, skillSign };

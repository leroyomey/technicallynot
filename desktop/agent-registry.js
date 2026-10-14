// Technically Not desktop · agent-registry.js — Known agent CLIs: how to find them, check their
// account login, and launch them.
'use strict';
const { execFile } = require('child_process');

// `id` matches the connection value used by the terminal pane picker (src/scripts/05).
// Only CLIs with a verified command are listed. Anything else in the picker stays disabled.
// `home`: env var that points the CLI at a separate config folder, which is how Technically Not
// keeps several accounts per CLI. `startArgs(opts)`: args for a fresh session (`sessionId`, set by
// Technically Not) or for resuming one (`resumeId`). `rules(opts)`: {args, env} that hand
// Technically Not's work rules (`workRules` text, `rulesFile` copy, `rulesPlugin` folder;
// agent-hooks.js) to a CLI through its own instruction setting, never a file in the project.
// `customArgs(opts)`: per-session args: a custom agent's skills (`pluginDirs`), identity and
// lead-agent rules (`appendPrompt`), and Technically Not's live-event hooks and plan tool
// (`settingsFile`, `mcpConfig`, agent-hooks.js); absent = the CLI can't take them per session.
// `signIn`: the CLI's own sign-in flow as offered in Technically Not's sign-in dialog, checked
// against `<cli> login --help` on this PC (claude 2.x, codex-cli 0.155, cursor-agent, opencode
// 1.18). provider = whose sign-in page opens in the system browser; email = the CLI takes an email
// hint; methods = real login flags. The CLIs' own API-key login flows are left out. `apiKey`: the
// CLI runs on the user's own provider key in an API-key account (api-keys.js):
// `env` = the variable the key goes in (only that account's agent process
// gets it), `prefix` = the key's usual start (a typo check), `keyUrl` = where the provider issues
// keys. `loginArgs(login)` turns a validated { email, method } into those flags. no cmd.exe
// metacharacters (& | < > ^ % " !)
const EMAIL = /^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}$/;
const AGENTS = [
  {
    id: 'Claude Code',
    command: 'claude',
    status: ['auth', 'status'],
    login: ['auth', 'login'],
    parse: parseClaude,
    home: 'CLAUDE_CONFIG_DIR',
    shared: ['projects'],
    signIn: {
      provider: 'Anthropic',
      browser: true,
      email: true,
      methods: [
        {
          id: 'claudeai',
          flag: '--claudeai',
          label: 'Claude subscription',
          detail: 'Pro or Max plan on claude.ai (default)',
        },
        {
          id: 'console',
          flag: '--console',
          label: 'Anthropic Console',
          detail: 'API usage billing',
        },
        {
          id: 'sso',
          flag: '--sso',
          label: 'Company SSO',
          detail: 'Your organization’s single sign-on',
        },
      ],
    },
    loginArgs: l => [
      ...(l.method ? [methodFlag('Claude Code', l.method)] : []),
      ...(l.email ? ['--email', l.email] : []),
    ],
    // ANTHROPIC_API_KEY (claude 2.1.283: sent as x-api-key, checked against a local stand-in
    // server); the one-time "use this API key?" question is answered in the account's own
    // .claude.json (account-service.js).
    apiKey: {
      provider: 'Anthropic',
      env: 'ANTHROPIC_API_KEY',
      prefix: 'sk-ant-',
      keyUrl: 'https://console.anthropic.com/settings/keys',
    },
    startArgs: o =>
      o.resumeId ? ['--resume', o.resumeId] : o.sessionId ? ['--session-id', o.sessionId] : [],
    // Model and effort picked under the composer (46); checked in claude 2.1 `--help` (full model
    // names; effort low…max) and its /model, /effort commands.
    pickArgs: o => [
      ...(o.model ? ['--model', o.model] : []),
      ...(o.effort ? ['--effort', o.effort] : []),
    ],
    // Access level under the composer (46); claude 2.1.289
    // `--help`: --permission-mode choices.
    accessArgs: accessFlags({
      ask: ['--permission-mode', 'manual'],
      edits: ['--permission-mode', 'acceptEdits'],
      auto: ['--permission-mode', 'auto'],
      full: ['--permission-mode', 'bypassPermissions'],
      plan: ['--permission-mode', 'plan'],
    }),
    // askOnResume: "Ask first" can be held on a resumed conversation. `claude --resume
    // <session-id>` restores the mode the conversation was in, and `--permission-mode` on the same
    // command line overrides that (Claude Code's own pages, "Manage sessions" › "Permission mode on
    // resume", read 2026-10-10; not yet tried with the real CLI). Used only when a start asks for
    // it (`spec`, opts.askOnResume).
    askOnResume: true,
    models: async () => ({
      models: claudeModels(),
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    }),
    // The appended system prompt goes in as a file (`appendPromptFile`, agent-hooks.js promptFile;
    // claude 2.1 `--append-system-prompt-file`), so the command line stays short.
    customArgs: o => [
      ...(o.pluginDirs || []).flatMap(dir => ['--plugin-dir', dir]),
      ...(o.appendPromptFile
        ? ['--append-system-prompt-file', o.appendPromptFile]
        : o.appendPrompt
          ? ['--append-system-prompt', o.appendPrompt]
          : []),
      ...(o.settingsFile ? ['--settings', o.settingsFile] : []),
      ...(o.mcpConfig ? ['--mcp-config', o.mcpConfig] : []),
      // Extra readable folders (composer attachments, attachment-service.js). Codex needs none: it
      // reads any path, and its --add-dir grants write access.
      ...(o.addDirs || []).flatMap(dir => ['--add-dir', dir]),
      // Settings › Agents › Use Claude in Chrome (agent-hooks.js browser-use): Claude in Chrome for
      // this session (claude 2.1 `--chrome`). Off adds nothing, so the CLI's own setting decides.
      ...(o.chrome ? ['--chrome'] : []),
    ],
  },
  {
    id: 'Codex',
    command: 'codex',
    status: ['login', 'status'],
    login: ['login'],
    parse: parseLoggedInText,
    home: 'CODEX_HOME',
    shared: ['sessions'],
    signIn: {
      provider: 'OpenAI',
      browser: true,
      email: false,
      methods: [
        {
          id: 'browser',
          flag: '',
          label: 'Sign in with ChatGPT',
          detail: 'Opens OpenAI’s page in this PC’s browser (default)',
        },
        {
          id: 'device',
          flag: '--device-auth',
          label: 'Device code',
          detail: 'Shows a code to enter on OpenAI’s page',
        },
      ],
    },
    loginArgs: l => (l.method ? [methodFlag('Codex', l.method)].filter(Boolean) : []),
    // Codex ignores OPENAI_API_KEY for its own login. The key account's config.toml
    // (account-service.js) names a provider whose env_key is this variable (codex-cli 0.157.1: the
    // key reaches api.openai.com, no sign-in screen, nothing written to auth.json).
    apiKey: {
      provider: 'OpenAI',
      env: 'TNAI_OPENAI_API_KEY',
      prefix: 'sk-',
      keyUrl: 'https://platform.openai.com/api-keys',
    },
    // developer_instructions from a profile file, `-p tnai` = $CODEX_HOME/tnai.config.toml layered
    // on the user's config (codex-cli 0.155.1 `--help`; checked with `codex -p NAME debug
    // prompt-input`). A `-c developer_instructions=...` argument outgrew cmd.exe's 8191-char line
    // through .cmd shims. Technically Not's MCP server (agent-hooks.js, per pane): `-c` values that
    // aren't valid TOML are taken as plain strings, so the URL needs no quotes through the .cmd
    // shims. tool_timeout_sec: tnai_wait can wait up to 600 s; Codex's default tool timeout is 60
    // s. default_tools_approval_mode=approve: Technically Not's own tools run without Codex asking
    // for each call (without it `codex exec` refuses them: "MCP tool call requires approval";
    // checked with codex-cli 0.157 against a stand-in server). Live steps: the profile's PreToolUse
    // hook (codexProfile) posts to TNAI_STEP_URL, the panel's /step/<token> beside its MCP URL;
    // without a panel server there is no hook.
    rules: o => {
      const url = mcpUrl(o.mcpConfig),
        step = url ? codexStepFile(o.rulesFile) : '',
        name = codexProfile(o.accountDir || o.codexHome, o.workRules, step);
      return {
        args: [
          ...(name ? ['-p', name] : []),
          ...(url
            ? [
                '-c',
                'mcp_servers.tnai.url=' + url,
                '-c',
                'mcp_servers.tnai.tool_timeout_sec=660',
                '-c',
                'mcp_servers.tnai.default_tools_approval_mode=approve',
              ]
            : []),
        ],
        ...(name && step ? { env: { TNAI_STEP_URL: url.replace('/mcp/', '/step/') } } : {}),
      };
    },
    // --no-daemon: codex-cli 0.157 puts its background server's socket in
    // $CODEX_HOME/app-server-control/, and a socket path of 108+ characters fails to connect ("path
    // must be shorter than SUN_LEN"), which an added account's folder under AppData reaches.
    startArgs: o => [
      ...(o.accountDir &&
      require('path').join(o.accountDir, 'app-server-control', 'app-server-control.sock').length >=
        108
        ? ['--no-daemon']
        : []),
      ...(o.resumeId ? ['resume', o.resumeId] : []),
    ],
    // `-m` and the model_reasoning_effort config key (codex-cli 0.155 `--help`); its own model list
    // with each model's effort levels.
    pickArgs: o => [
      ...(o.model ? ['-m', o.model] : []),
      ...(o.effort ? ['-c', 'model_reasoning_effort=' + o.effort] : []),
    ],
    // codex-cli 0.160 `--help`: -a takes only on-request and never (on-request keeps its default
    // workspace-write sandbox, so it edits inside the project and asks to go past it);
    // --approve-for-me routes approvals through its automatic review. The tnai server's approve
    // mode (rules) stays at every level.
    accessArgs: accessFlags({
      ask: ['-a', 'on-request'],
      auto: ['--approve-for-me'],
      full: ['--dangerously-bypass-approvals-and-sandbox'],
      plan: ['-s', 'read-only'],
    }),
    models: codexModels,
  },
  // `logout` (cursor-agent `--help`: "Sign out and clear stored authentication"): Switch account
  // runs it, then `login`, in one pane.
  {
    id: 'Cursor Agent',
    command: 'cursor-agent',
    status: ['status'],
    login: ['login'],
    logout: ['logout'],
    parse: parseLoggedInText,
    // Effort is part of Cursor's model ids (`--list-models`), so it has no separate effort.
    pickArgs: o => (o.model ? ['--model', o.model] : []),
    models: cursorModels,
    // cursor-agent 2026.10.01 `--help`: no flag to ask (its own permissions decide, and they ask by
    // default), --auto-review (a server classifier runs safe tool calls and asks about the rest),
    // --force (alias --yolo), --mode plan. --approve-mcps (rules) keeps the tnai tools running at
    // every level.
    accessArgs: accessFlags({
      ask: [],
      auto: ['--auto-review'],
      full: ['--force'],
      plan: ['--mode', 'plan'],
    }),
    // No instruction flag: the work rules go in as an always-applied rule and a sessionStart hook
    // of a local plugin (`--plugin-dir`, agent-hooks.js rulesPluginFiles). --trust (cursor-agent
    // 2026.09 `--help`): skips the workspace-trust question that would take a sub-agent's first
    // task. o.trust is set only once the user approved this folder in Technically Not's trust
    // dialog (main.js; trust-service.js granted('Cursor Agent', cwd)). With a pane's MCP config the
    // plugin also carries Technically Not's MCP server (agent-hooks.js cursorPlugin);
    // --approve-mcps (2026.09.28 `--help`) lets its tools run without Cursor asking, as a lead's
    // tnai_delegate must.
    rules: o => ({
      args: [
        ...(o.rulesPlugin ? ['--plugin-dir', o.rulesPlugin] : []),
        ...(o.rulesPlugin && o.mcpConfig ? ['--approve-mcps'] : []),
        ...(o.trust ? ['--trust'] : []),
      ],
    }),
    // `--resume [chatId]` (cursor-agent 2026.09.28 `--help`); the chat id is the one
    // cursor-store.js found for the pane.
    startArgs: o => (o.resumeId ? ['--resume', o.resumeId] : []),
    signIn: { provider: 'Cursor', browser: true, email: false, methods: [] },
  },
  {
    id: 'OpenCode',
    command: 'opencode',
    status: ['auth', 'list'],
    login: ['auth', 'login'],
    parse: parseOpenCode,
    // `opencode auth login` asks which AI provider to use inside the terminal; each provider then
    // runs its own flow.
    signIn: { provider: '', browser: false, email: false, methods: [] },
    // OPENCODE_TUI_CONFIG (a tui.json, opencode 1.18; `theme` left the main config): theme 'system'
    // draws on the terminal's own background (asked with OSC 11, answered by 10) instead of its
    // black one, so its panel matches the others. Config instructions
    // (file paths), added through OPENCODE_CONFIG_CONTENT (checked in opencode 1.18: `opencode
    // debug config`). Technically Not's MCP server as a remote server in the same config
    // (agent-hooks.js, per pane); OpenCode's default permissions allow MCP tools without asking.
    // skills.paths (opencode 1.18.33, `opencode debug skill`): the library skills on for every
    // session, from Technically Not's own folder (skill-service.js launchOptions). `timeout` on
    // that server (opencode 1.18.35: `opencode debug config` keeps it; its own text: "Timeout in ms
    // for MCP server requests", 5 s when not set): tnai_wait can take up to 600 s, so 660 s as
    // Claude Code and Codex get. Not yet tried with a real long wait. Live steps (opencode 1.18.34,
    // one real prompt 2026-10-04): a local plugin file named in the same config (`plugin`, a
    // file:// URL; `opencode debug config` lists it with source OPENCODE_CONFIG_CONTENT) posts each
    // tool call to the panel's step URL (agent-hooks.js stepPlugin; /step/<token> beside the MCP
    // URL). experimental.continue_loop_on_deny (opencode 1.18.35, one real free-model run
    // 2026-10-06): without it a rejected permission request ends the whole turn at once; with it
    // the model is told and goes on, as Claude Code does after a Deny (it then wrote the other file
    // through the shell).
    rules: o => {
      const url = mcpUrl(o.mcpConfig),
        steps = url ? openCodeSteps(o.rulesFile) : '';
      return {
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            instructions: [o.rulesFile],
            experimental: { continue_loop_on_deny: true },
            ...(o.pluginDirs?.length
              ? { skills: { paths: o.pluginDirs.map(dir => require('path').join(dir, 'skills')) } }
              : {}),
            ...(url
              ? { mcp: { tnai: { type: 'remote', url, enabled: true, timeout: 660000 } } }
              : {}),
            ...(steps ? { plugin: [steps] } : {}),
          }),
          ...(steps ? { TNAI_STEP_URL: url.replace('/mcp/', '/step/') } : {}),
          ...openCodeTui(o.rulesFile),
        },
      };
    },
    // serverPort (opencode 1.18.35 `--help`: --port, --hostname; set by pty-service.js from
    // opencode-link.js, only on a tested version): the TUI's own server on loopback, password in
    // its environment. Never --mdns. Not in handArgs: a hand-typed `opencode` starts as before.
    startArgs: o => [
      ...(o.resumeId ? ['--session', o.resumeId] : []),
      ...(o.serverPort ? ['--port', String(o.serverPort), '--hostname', '127.0.0.1'] : []),
    ],
    // `-m provider/model` (opencode 1.18 `--help`); the list is its own `opencode models`.
    pickArgs: o => (o.model ? ['-m', o.model] : []),
    models: openCodeModels,
    // opencode 1.18.34 `--help`: --auto approves what would ask. Its defaults allow most actions
    // without asking (opencode.ai/docs/permissions), so "Ask first" with no flag would be a fake.
    // Ask first, Allow edits and Plan only are a `permission` block in the session config
    // (accessEnv → openCodeAccess, below; the resolved rules read with `opencode debug agent
    // build|plan`, 1.18.35, no prompt), Plan only also starts its own plan agent (`--agent plan`,
    // same `--help`). No automatic reviewer exists, so Auto review stays greyed out.
    accessArgs: accessFlags({ ask: [], edits: [], full: ['--auto'], plan: ['--agent', 'plan'] }),
    accessEnv: openCodeAccessEnv,
    accessOnResume: true,
  },
  // Gemini CLI 0.61 (`gemini --help`): no status or login command. Sign-in = plain `gemini`, whose
  // auth dialog (Sign in with Google / Gemini API key / Vertex AI) opens Google's page in the
  // browser; its state is read from its own files (geminiStatus). `--session-id <uuid>` names a new
  // session and `--resume <uuid>` reopens it (its sessionUtils: "--resume {number}, --resume
  // {uuid}, or --resume latest"), so Technically Not sets the id at start. `-m` takes its own
  // aliases (GEMINI_MODEL_ALIAS_* / resolveModel in 0.61), which it maps to the current models the
  // account can use. No work rules, MCP server or hooks: all three live only in
  // settings.json/GEMINI.md/extensions. System settings (GEMINI_CLI_SYSTEM_SETTINGS_PATH,
  // _DEFAULTS_PATH) in a folder the user can write are refused as insecure (checked in 0.61), so
  // they could only go in through the user's or project's own files. GEMINI_CLI_HOME replaces the
  // home folder (paths.ts homedir()): an account's config is <folder>/.gemini, and .gemini/tmp
  // (chats, per-project slugs found by their .project_root marker) is shared so a session resumes
  // on another account.
  {
    id: 'Gemini CLI',
    command: 'gemini',
    status: null,
    login: [],
    parse: null,
    readStatus: geminiStatus,
    home: 'GEMINI_CLI_HOME',
    shared: ['.gemini/tmp'],
    signIn: { provider: 'Google', browser: true, email: false, methods: [] },
    // GEMINI_API_KEY (0.61 validateAuthMethod), with security.auth.selectedType "gemini-api-key" in
    // the account's settings.json (account-service.js) so no auth dialog.
    apiKey: {
      provider: 'Google',
      env: 'GEMINI_API_KEY',
      prefix: 'AIza',
      keyUrl: 'https://aistudio.google.com/apikey',
    },
    // --skip-trust (0.61 `--help`: "Trust the current workspace for this session"), only once the
    // user allowed the folder in Technically Not's trust dialog.
    startArgs: o => [
      ...(o.trust ? ['--skip-trust'] : []),
      ...(o.resumeId ? ['--resume', o.resumeId] : o.sessionId ? ['--session-id', o.sessionId] : []),
    ],
    pickArgs: o => (o.model ? ['-m', o.model] : []),
    // 0.62 `--help`: --approval-mode default | auto_edit | yolo | plan.
    accessArgs: accessFlags({
      ask: ['--approval-mode', 'default'],
      edits: ['--approval-mode', 'auto_edit'],
      full: ['--approval-mode', 'yolo'],
      plan: ['--approval-mode', 'plan'],
    }),
    models: async () => ({
      models: [
        ['pro', 'Pro'],
        ['flash', 'Flash'],
        ['flash-lite', 'Flash Lite'],
      ].map(([id, label]) => ({ id, label })),
      efforts: [],
    }),
  },
  // Antigravity CLI 1.2.14 (`agy --help`; Google's successor to Gemini CLI for personal accounts).
  // Sign-in = plain `agy` (its own screen: Google OAuth or a Google Cloud project); the session
  // sits in the Windows credential store as `gemini:antigravity`, looked up by name only
  // (agyStatus). No work rules, MCP server or resume yet: rules and MCP load only from the
  // project's `.agents/` or the user's ~/.gemini/config.
  {
    id: 'Antigravity',
    command: 'agy',
    status: null,
    login: [],
    parse: null,
    readStatus: agyStatus,
    signIn: { provider: 'Google', browser: true, email: false, methods: [] },
    // `--model` (1.2.14 `--help`); the list is its own `agy models` ("id<TAB>Label"; effort is part
    // of the id, e.g. gemini-3.8-flash-high).
    pickArgs: o => (o.model ? ['--model', o.model] : []),
    models: agyModels,
    // 1.2.14 `--help`: no flag to ask (its default asks), --mode accept-edits | plan,
    // --dangerously-skip-permissions.
    accessArgs: accessFlags({
      ask: [],
      edits: ['--mode', 'accept-edits'],
      full: ['--dangerously-skip-permissions'],
      plan: ['--mode', 'plan'],
    }),
  },
  // Not installed on this PC: its access flags were never read, so it starts at its own default
  // only.
  {
    id: 'Droid',
    command: 'droid',
    status: null,
    login: null,
    parse: null,
    accessWhy: { all: 'Droid is not installed on this PC, so its flags were not checked' },
  },
  // GitHub Copilot CLI 1.0.88 (npm @github/copilot). `copilot login` (`login --help`: browser flow
  // by default on a desktop, `--device-code`); it also runs on the GitHub CLI's (gh) sign-in or a
  // COPILOT_GITHUB_TOKEN/GH_TOKEN/GITHUB_TOKEN with no login of its own. No status command: sign-in
  // state and the account's models come from its own headless JSON-RPC server (copilotStatus,
  // copilotModels). COPILOT_HOME (`copilot help environment`) moves its config, logged-in users and
  // sessions (session-state/<id>) to an account folder; stored tokens stay in the Windows
  // credential store. Work rules: COPILOT_CUSTOM_INSTRUCTIONS_DIRS names extra folders searched
  // like the project; a .github/instructions/*.instructions.md there with applyTo "**" loads for
  // every file (`copilot instruction list` in 1.0.88). No `logout` command (1.0.88 `--help`), so no
  // Switch account.
  {
    id: 'GitHub Copilot',
    command: 'copilot',
    status: null,
    login: ['login'],
    parse: null,
    readStatus: copilotStatus,
    home: 'COPILOT_HOME',
    signIn: {
      provider: 'GitHub',
      browser: true,
      email: false,
      methods: [
        {
          id: 'browser',
          flag: '',
          label: 'Sign in with GitHub',
          detail: 'Opens GitHub’s page in this PC’s browser (default)',
        },
        {
          id: 'device',
          flag: '--device-code',
          label: 'Device code',
          detail: 'Shows a code to enter on GitHub’s page',
        },
      ],
    },
    loginArgs: l => (l.method ? [methodFlag('GitHub Copilot', l.method)].filter(Boolean) : []),
    // Technically Not's MCP server (agent-hooks.js mcpFile, per pane): `--additional-mcp-config
    // @<file>` takes that same {mcpServers:{tnai:{type:'http',url}}} file for this session only,
    // and `--allow-tool=tnai` (`copilot help permissions`: an MCP server name allows all its tools)
    // runs its tools without asking. An account whose Copilot policy turns third-party MCP off
    // starts without it ("1 MCP server was blocked by policy: 'tnai'", checked in 1.0.88).
    rules: o => {
      const dir = copilotRules(o.rulesFile, o.workRules);
      return {
        args: o.mcpConfig
          ? ['--additional-mcp-config', '@' + o.mcpConfig, '--allow-tool=tnai']
          : [],
        ...(dir
          ? {
              env: {
                COPILOT_CUSTOM_INSTRUCTIONS_DIRS: [
                  process.env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS,
                  dir,
                ]
                  .filter(Boolean)
                  .join(','),
              },
            }
          : {}),
      };
    },
    // `--session-id <uuid>` names a new session, `--resume <id>` reopens one (1.0.88 `--help`). A
    // session with no message yet can't be resumed ("No session, task, or name matched"), so the
    // resumable check stays with the session store.
    startArgs: o =>
      o.resumeId ? ['--resume', o.resumeId] : o.sessionId ? ['--session-id', o.sessionId] : [],
    // `--model` and `--reasoning-effort` (1.0.88 `--help`); models and each one's effort levels
    // from the account's own list.
    pickArgs: o => [
      ...(o.model ? ['--model', o.model] : []),
      ...(o.effort ? ['--reasoning-effort', o.effort] : []),
    ],
    // 1.0.91 `--help`: no flag to ask (its default asks), --allow-all-tools (paths stay checked;
    // --allow-all-paths is separate and not used), --mode plan. Its judge-based approvals need
    // --experimental, so no Auto review. --allow-tool=tnai (rules) keeps the tnai tools running at
    // every level.
    accessArgs: accessFlags({ ask: [], full: ['--allow-all-tools'], plan: ['--mode', 'plan'] }),
    models: copilotModels,
  },
];

// Where each CLI publishes its releases — the one list the update bell (cli-updates.js: `npm` +
// `update`), the release watcher (tools/cli-watch: `feed`, stable versions only) and the
// tested-version check (tools/agent-cli-check.js) read. A new CLI in AGENTS needs a row here too;
// both tools warn about a CLI without a feed. feed: RSS/Atom of its release notes ('' = none public
// yet); npm: its package (stable version + the bell); update: its own update command; match: keep
// only feed entries matching this (shared changelogs).
const RELEASES = {
  'Claude Code': {
    feed: 'https://github.com/anthropics/claude-code/releases.atom',
    notes: 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md',
    npm: '@anthropic-ai/claude-code',
    update: 'claude update',
  },
  Codex: {
    feed: 'https://github.com/openai/codex/releases.atom',
    notes: 'https://github.com/openai/codex/releases',
    npm: '@openai/codex',
    update: 'npm install -g @openai/codex@latest',
  },
  'Cursor Agent': {
    feed: 'https://cursor.com/changelog/rss.xml',
    notes: 'https://cursor.com/changelog',
    match: '\\bcli\\b|cursor-agent|terminal agent',
  }, // editor changelog: CLI entries only
  OpenCode: {
    feed: 'https://github.com/anomalyco/opencode/releases.atom',
    notes: 'https://github.com/anomalyco/opencode/releases',
    npm: 'opencode-ai',
    update: 'opencode upgrade',
  },
  'Gemini CLI': {
    feed: 'https://github.com/google-gemini/gemini-cli/releases.atom',
    notes: 'https://github.com/google-gemini/gemini-cli/releases',
    npm: '@google/gemini-cli',
    update: 'npm install -g @google/gemini-cli@latest',
  },
  // No public release feed or npm package found (2026-09-30); `agy changelog` shows its notes
  // locally and `agy update` updates it (1.2.14 `--help`).
  Antigravity: { feed: '', notes: '', update: 'agy update' },
  // docs.factory.ai CLI reference: the Windows installer (`irm https://app.factory.ai/cli/windows |
  // iex`) updates itself and `droid update` runs it on demand; the npm build (`droid`, same
  // versions) has auto-update off and its `droid update` only says so. Feed titles: "CLI vX,
  // Desktop vY: ...".
  Droid: {
    feed: 'https://docs.factory.ai/changelog/rss.xml',
    notes: 'https://docs.factory.ai/changelog/release-notes',
    match: '\\bCLI v\\d',
    npm: 'droid',
    update: 'droid update',
  },
  // `copilot help config` (1.0.88): an npm install only reports a newer version; installing it
  // stays a manual `npm install`.
  'GitHub Copilot': {
    feed: 'https://github.com/github/copilot-cli/releases.atom',
    notes: 'https://github.com/github/copilot-cli/releases',
    npm: '@github/copilot',
    update: 'npm install -g @github/copilot@latest',
  },
};

const stripAnsi = text =>
  String(text || '')
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '');

function parseClaude(out) {
  try {
    const data = JSON.parse(out.slice(out.indexOf('{')));
    const plan =
      typeof data.subscriptionType === 'string' && data.subscriptionType
        ? ' · ' + data.subscriptionType.charAt(0).toUpperCase() + data.subscriptionType.slice(1)
        : '';
    return {
      loggedIn: !!data.loggedIn,
      account: data.email || '',
      method: data.loggedIn && data.authMethod ? String(data.authMethod) + plan : '',
    };
  } catch {
    return { loggedIn: false, account: '', method: '', note: 'Could not read login status.' };
  }
}

// cursor-agent: "✓ Logged in as <email>". codex: "Logged in using ChatGPT" (no email) or "... using
// an API key - <masked key>": only an email counts as the account, and the method keeps just its
// words, never anything after them.
function parseLoggedInText(out) {
  const text = stripAnsi(out);
  const loggedIn = /logged in/i.test(text) && !/not logged in|logged out/i.test(text);
  const as = (text.match(/logged in as\s+(\S+)/i) || [])[1] || '';
  const using = (
    (text.match(/logged in using\s+(?:an?\s+)?([A-Za-z][A-Za-z. ]{0,30}?)\s*(?:[-–:(]|\r|\n|$)/i) ||
      [])[1] || ''
  ).trim();
  return { loggedIn, account: EMAIL.test(as) ? as : '', method: using };
}

function methodFlag(id, method) {
  const m = AGENTS.find(a => a.id === id)?.signIn?.methods.find(x => x.id === method);
  if (!m) throw new Error('Unknown sign-in method for ' + id + '.');
  return m.flag;
}

// Only a plain email and a known method id reach the command line.
function checkLogin(agent, login) {
  if (!login || typeof login !== 'object') return {};
  const email = typeof login.email === 'string' ? login.email.trim() : '',
    method = typeof login.method === 'string' ? login.method : '';
  if (email && !(agent.signIn?.email && EMAIL.test(email) && email.length <= 254))
    throw new Error(
      agent.signIn?.email
        ? 'That email address cannot be passed to the sign-in page.'
        : agent.id + ' does not take an email for sign-in.'
    );
  if (method && !agent.signIn?.methods.some(m => m.id === method))
    throw new Error('Unknown sign-in method for ' + agent.id + '.');
  return { email, method };
}

// No saved credentials is not "signed out": OpenCode runs on its built-in free models (`opencode
// models`: opencode/*-free) and API keys from env vars (checked in opencode 1.18). loggedIn false
// would make the panel start `opencode auth login` instead of the agent (10-live-terminals.js).
function parseOpenCode(out) {
  const count = Number((stripAnsi(out).match(/(\d+)\s+credentials?/i) || [])[1] || 0);
  return count
    ? {
        loggedIn: true,
        account: count + ' provider credential' + (count > 1 ? 's' : ''),
        method: '',
      }
    : {
        loggedIn: null,
        account: '',
        method: '',
        note: 'Installed. No provider added: OpenCode uses its free models until you add one with `opencode auth login`.',
      };
}

// `more` (only OpenCode's model list passes it): { maxBuffer, cwd } for a longer output or a run
// inside the project folder.
function run(file, args, timeout = 20000, verbatim = false, env = null, more = null) {
  return new Promise(resolve => {
    execFile(
      file,
      args,
      {
        timeout,
        windowsHide: true,
        maxBuffer: more?.maxBuffer || 1 << 20,
        windowsVerbatimArguments: verbatim,
        env: env ? { ...process.env, ...env } : process.env,
        ...(more?.cwd ? { cwd: more.cwd } : {}),
      },
      (error, stdout, stderr) =>
        resolve({ ok: !error, out: String(stdout || '') + String(stderr || '') })
    );
  });
}

// Gemini CLI 0.61 sign-in from its own files in <GEMINI_CLI_HOME or ~>/.gemini, tokens never read:
// settings.json security.auth.selectedType (the method picked in its auth dialog), oauth_creds.json
// (a Google sign-in; its keychain only with GEMINI_FORCE_ENCRYPTED_FILE_STORAGE) and
// google_accounts.json `active`. Antigravity: signed in when the Windows credential store holds its
// `gemini:antigravity` entry (cmdkey lists names only, never the secret).
async function agyStatus() {
  if (process.platform !== 'win32')
    return { loggedIn: null, account: '', method: '', note: 'Installed. Sign in by running agy.' };
  const { ok, out } = await run('cmdkey', ['/list:gemini:antigravity'], 8000);
  const signedIn = ok && /Target:\s*gemini:antigravity/i.test(out);
  return { loggedIn: ok ? signedIn : null, account: '', method: signedIn ? 'Google account' : '' };
}

function geminiStatus(accountDir) {
  const fs = require('fs'),
    P = require('path'),
    dir = P.join(accountDir || process.env.GEMINI_CLI_HOME || require('os').homedir(), '.gemini');
  const json = name => {
    try {
      return JSON.parse(
        fs
          .readFileSync(P.join(dir, name), 'utf8')
          .replace(/^﻿/, '')
          .replace(/^\s*\/\/.*$/gm, '')
      );
    } catch {
      return null;
    }
  };
  const type = json('settings.json')?.security?.auth?.selectedType || '',
    active = json('google_accounts.json')?.active;
  if (type === 'oauth-personal') {
    const ok =
      fs.existsSync(P.join(dir, 'oauth_creds.json')) ||
      process.env.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE === 'true';
    return {
      loggedIn: ok,
      account: ok && typeof active === 'string' && EMAIL.test(active) ? active : '',
      method: ok ? 'Google account' : '',
    };
  }

  // A key typed into its dialog sits in the Windows credential store, which Technically Not doesn't
  // read.
  if (type === 'gemini-api-key')
    return {
      loggedIn: process.env.GEMINI_API_KEY ? true : null,
      account: '',
      method: 'Gemini API key',
      note: process.env.GEMINI_API_KEY ? '' : 'Uses a saved Gemini API key.',
    };
  if (type)
    return {
      loggedIn: null,
      account: '',
      method: type === 'vertex-ai' ? 'Vertex AI' : '',
      note: 'Signs in through ' + type + '.',
    };
  return { loggedIn: false, account: '', method: '' };
}
const runSpec = (spec, timeout, env, more) =>
  run(spec.file, spec.args, timeout, spec.verbatim, env, more);

// Env that points a CLI at an account's own config folder; the default account (no folder) uses the
// CLI's normal home.
const accountEnv = (agent, accountDir) =>
  accountDir && agent.home ? { [agent.home]: accountDir } : {};

// How a missing CLI is installed (Usage & accounts › Not installed › Install): always the
// provider's own latest, by the provider's own command, never a copy kept by
// Technically Not. Read from each provider's install page on 2026-10-06 (Droid and Antigravity
// from the notes above). npm: its package, needs Node.js (the
// page offers Node.js first when npm is not found); win: the provider's Windows PowerShell command;
// page: the provider's install page ('' = none checked). A new CLI in AGENTS needs a row here too,
// or its tile offers nothing.
const INSTALL = {
  'Claude Code': {
    win: 'irm https://claude.ai/install.ps1 | iex',
    page: 'https://code.claude.com/docs/en/setup',
  },
  Codex: { npm: '@openai/codex', page: 'https://github.com/openai/codex#readme' },
  'Cursor Agent': {
    win: "irm 'https://cursor.com/install?win32=true' | iex",
    page: 'https://cursor.com/docs/cli/installation',
  },
  OpenCode: { npm: 'opencode-ai', page: 'https://opencode.ai/docs/' },
  'Gemini CLI': {
    npm: '@google/gemini-cli',
    page: 'https://github.com/google-gemini/gemini-cli#readme',
  },
  Antigravity: { win: 'irm https://antigravity.google/cli/install.ps1 | iex', page: '' },
  Droid: {
    win: 'irm https://app.factory.ai/cli/windows | iex',
    page: 'https://docs.factory.ai/cli/getting-started/quickstart',
  },
  'GitHub Copilot': {
    npm: '@github/copilot',
    page: 'https://github.com/github/copilot-cli#readme',
  },
};

// Node.js by Windows' own package manager (winget ships with Windows 10 1809+ and 11); the second
// part gives that PowerShell the new PATH, so `npm` works in it right after. Not read from
// nodejs.org (its page did not show the command to the checker): untried on a clean PC.
const NODE_INSTALL = {
  win: "winget install OpenJS.NodeJS.LTS; $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
  page: 'https://nodejs.org/en/download',
};

// Resolves a command on PATH to something Windows can start: .exe directly, .cmd/.bat through
// cmd.exe. Where an installer puts a CLI when this run of Technically Not started before it was
// installed (its PATH is the one from launch): Antigravity's install.ps1 copies agy.exe to
// %LOCALAPPDATA%\agy\bin and adds that to the user PATH only for new processes. Claude Code's own
// installer puts claude.exe in %USERPROFILE%\.local\bin and says that folder may not be on PATH yet
// (its setup page).
const INSTALLED_AT = {
  agy: () => require('path').join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe'),
  claude: () => require('path').join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe'),
};

// Windows gives a running program the PATH it had at start, so a CLI (or Node.js) installed since
// is not on it. Before a re-check the user asked for, the folders now on the machine's and the
// user's PATH (the registry, where installers write them) are added behind the ones this run
// already has; nothing is removed or reordered. Programs started afterwards (a new terminal panel,
// an npm shim's `node`) get them.
async function freshPath() {
  if (process.platform !== 'win32') return;
  const key = p =>
    p
      .trim()
      .replace(/[\\/]+$/, '')
      .toLowerCase();
  const have = new Set(
      String(process.env.PATH || '')
        .split(';')
        .map(key)
        .filter(Boolean)
    ),
    add = [];
  for (const hive of [
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
    'HKCU\\Environment',
  ]) {
    const r = await run('reg.exe', ['query', hive, '/v', 'Path'], 8000);
    const value = r.ok ? /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(r.out)?.[1] || '' : '';
    for (const raw of value.split(';')) {
      const dir = raw.trim().replace(/%([^%]+)%/g, (m, n) => process.env[n] ?? m);
      if (dir && !dir.includes('%') && !have.has(key(dir))) {
        have.add(key(dir));
        add.push(dir);
      }
    }
  }

  // Folders where Windows tool managers put a CLI, for a PC whose saved PATH lacks them (a PATH set
  // only in a PowerShell profile, an installer that never wrote it): npm's own folder, Volta, pnpm,
  // bun, scoop and ~/.local/bin. Only folders that exist, behind everything above.
  const fs = require('fs'),
    path = require('path'),
    { APPDATA: roaming, LOCALAPPDATA: local, USERPROFILE: home } = process.env;
  for (const dir of [
    roaming && path.join(roaming, 'npm'),
    local && path.join(local, 'Volta', 'bin'),
    local && path.join(local, 'pnpm'),
    home && path.join(home, '.bun', 'bin'),
    home && path.join(home, 'scoop', 'shims'),
    home && path.join(home, '.local', 'bin'),
  ])
    if (dir && !have.has(key(dir)) && fs.existsSync(dir)) {
      have.add(key(dir));
      add.push(dir);
    }
  if (add.length) process.env.PATH = [process.env.PATH, ...add].filter(Boolean).join(';');
}

async function resolveCommand(command) {
  if (process.platform !== 'win32') {
    const r = await run('which', [command], 8000);
    return r.ok
      ? r.out
          .split(/\r?\n/)
          .map(s => s.trim())
          .find(Boolean) || null
      : null;
  } // mac/Linux: the executable on PATH
  const { ok, out } = await run('where.exe', [command], 8000);
  if (!ok) {
    const known = INSTALLED_AT[command]?.();
    return known && process.env.LOCALAPPDATA && require('fs').existsSync(known) ? known : null;
  }
  const hits = out
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  return hits.find(p => /\.exe$/i.test(p)) || hits.find(p => /\.(cmd|bat)$/i.test(p)) || null;
}

// A .cmd shim argument for one cmd.exe command line (the cross-spawn rule): quoted for the CLI's
// own parser, then every cmd metacharacter caret-escaped twice (cmd /c parses the line, then the
// shim's %* is parsed again), so quotes, & | < > % ^ in a prompt stay literal text. cmd.exe ends a
// command at a line break, so line breaks become spaces. Same rule in agent-shim.js (a standalone
// copy).
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
const cmdArg = a =>
  (
    '"' +
    String(a)
      .replace(/\r?\n/g, ' ')
      .replace(/(\\*)"/g, '$1$1\\"')
      .replace(/(\\*)$/, '$1$1') +
    '"'
  )
    .replace(CMD_META, '^$1')
    .replace(CMD_META, '^$1');

// Codex: Technically Not's work rules as the `tnai` profile in that Codex home (the account folder,
// else CODEX_HOME, else ~/.codex); returns the profile name. A TOML multi-line literal string: kept
// verbatim, only a ''' run (which would end it) is broken up. Technically Not's file starts with
// its marker line; a profile file of that name without it is the user's own and is never replaced
// (Technically Not then uses `tnai-rules`; '' = neither name is free, and Codex starts without the
// rules rather than with the user's profile overwritten).
function mcpUrl(file) {
  try {
    return JSON.parse(require('fs').readFileSync(file, 'utf8')).mcpServers.tnai.url || '';
  } catch {
    return '';
  }
}
const CODEX_MARK = '# Written by Technically Not on every Codex launch';

// Live steps (codex 0.160.0, real prompts 2026-10-04): with `step` (agent-hooks.js codexStep, a
// fixed script) the profile also holds one PreToolUse command hook. Codex runs it only after the
// user trusted it once with `/hooks`, and saves that in this same file as
// `[hooks.state.'<file>:pre_tool_use:0:0']` with `trusted_hash` (seen written by Codex). So a
// rewrite keeps everything from the first `[hooks.state` on: the user's review survives a change of
// the work rules. Technically Not never writes a trust entry itself. The hook text only changes
// when the script's path does (another install folder), which asks for a new review.
function codexProfile(home, text, step = '') {
  const fs = require('fs'),
    P = require('path');
  const dir = home || process.env.CODEX_HOME || P.join(require('os').homedir(), '.codex');
  fs.mkdirSync(dir, { recursive: true });
  const hook = step
    ? '\n[[hooks.PreToolUse]]\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = ' +
      JSON.stringify(/\s/.test(step) ? '"' + step + '"' : step) +
      '\ntimeout = 5\n'
    : '';
  for (const name of ['tnai', 'tnai-rules']) {
    const file = P.join(dir, name + '.config.toml'),
      body =
        CODEX_MARK +
        ' (codex -p ' +
        name +
        "): Technically Not's work rules.\ndeveloper_instructions = '''\n" +
        String(text).replace(/'''/g, "' ''") +
        "\n'''\n" +
        hook;
    let old = null;
    try {
      old = fs.readFileSync(file, 'utf8');
    } catch {}
    if (old != null && !old.startsWith(CODEX_MARK)) continue;

    // A launch without a panel server (no `step`) leaves the hook and its review as they are:
    // without TNAI_STEP_URL the script does nothing.
    const end = old == null ? -1 : old.lastIndexOf("'''"),
      at = end < 0 ? -1 : old.indexOf('\n[hooks.state', end);
    const next =
      body +
      (hook
        ? at < 0
          ? ''
          : old.slice(at)
        : end < 0
          ? ''
          : old.slice(end + 3).replace(/^\r?\n/, ''));
    if (old !== next) fs.writeFileSync(file, next);
    return name;
  }
  return '';
}

// Codex's live-steps script beside the rules file (written by agent-hooks.js codexStep): '' when it
// is not there.
function codexStepFile(rulesFile) {
  if (!rulesFile) return '';
  const file = require('path').join(
    require('path').dirname(rulesFile),
    process.platform === 'win32' ? 'codex-step.cmd' : 'codex-step'
  );
  return require('fs').existsSync(file) ? file : '';
}

// OpenCode's live-steps plugin beside the rules file (written by agent-hooks.js stepPlugin), as the
// file:// URL its config takes: '' when it is not there.
function openCodeSteps(rulesFile) {
  if (!rulesFile) return '';
  const file = require('path').join(require('path').dirname(rulesFile), 'opencode-steps.js');
  return require('fs').existsSync(file) ? require('url').pathToFileURL(file).href : '';
}

// OpenCode's access levels as its own `permission` rules (opencode.ai/docs/permissions: allow | ask
// | deny per tool, a command pattern map for `bash`, the last matching rule wins). Its defaults
// allow edits and commands, so:
// - Ask first: edits ask, commands ask. Allow edits: commands ask, `edit` is left alone (its
// default allows; a user's own stricter rule stays).
// - Plan only (with `--agent plan`, whose own rules refuse edits but allow commands): commands ask
// for that agent. At each of them Technically Not's read-only `tnai` commands (the same list as
// agent-hooks.js SAFE_TNAI, compared by access-levels-check.js) and its MCP tools (`tnai_*`) stay
// allowed. Known limit: `edit: ask` replaces a user's own `edit: deny` for that session; a user's
// `bash` deny patterns stay (merged, seen with a stand-in config file). null = the level adds no
// config (CLI default, Full access).
const OC_SAFE_TNAI = [
  'agents',
  'read',
  'context',
  'locks',
  'lock',
  'unlock',
  'team',
  'skill list',
  'skill match',
  'skill overlaps',
  'preview',
  'show',
  'shot',
];

function openCodeAccess(level) {
  const bash = {
    '*': 'ask',
    ...Object.fromEntries(
      OC_SAFE_TNAI.flatMap(c => [
        ['tnai ' + c, 'allow'],
        ['tnai ' + c + ' *', 'allow'],
      ])
    ),
  };
  if (level === 'ask') return { permission: { edit: 'ask', bash, 'tnai_*': 'allow' } };
  if (level === 'edits') return { permission: { bash, 'tnai_*': 'allow' } };
  if (level === 'plan')
    return { permission: { 'tnai_*': 'allow' }, agent: { plan: { permission: { bash } } } };
  return null;
}

// The session config with that level's rules added (env = what `rules` built, or nothing when the
// work rules are off). The same config also carries a picked effort (pick = { model, effort },
// already cleaned; opts.serverPort = the panel's link, when on). Effort is a model's "variant" in
// OpenCode. Seen with the real 1.18.35 binary and free-model prompts, 2026-10-06:
// - `agent.<name>.variant` alone is ignored. With `agent.<name>.model` naming the same model it is
// used, but only while OpenCode has no level of its own saved for that model (its state file); a
// saved one wins.
// - So both are sent (for its two primary agents), and the link then steps the TUI's own level to
// the picked one (opencode-link.js effort). Without the link only the first half holds, which is
// why efforts are listed only while the link is available (openCodeModels). THE SWITCH for all of
// it. On, because it does the same thing as OpenCode's own effort key and the picker shows the
// level in use. Its consequence, which is why the switch was a deliberate choice:
// picking an effort changes the level OpenCode keeps for that model everywhere, also in
// the user's own OpenCode outside Technically Not. Off: OpenCode lists no efforts, model-pick.js
// refuses an effort, nothing is added to the session config and the link's effort() is never
// called. The checks flip `openCodeEffortOn` to cover both states.
const OPENCODE_EFFORT_ON = true;
let openCodeEffortOn = OPENCODE_EFFORT_ON;

function openCodeAccessEnv(level, env, pick, opts) {
  const effort =
    openCodeEffortOn &&
    pick?.model &&
    pick.effort &&
    openCodeVariants(pick.model).includes(pick.effort)
      ? pick.effort
      : '';
  const add = openCodeAccess(level),
    run = effort ? { model: pick.model, variant: effort } : null;
  if (effort && opts?.serverPort)
    try {
      require('./opencode-link').effort(
        opts.serverPort,
        pick.model,
        effort,
        openCodeVariants(pick.model)
      );
    } catch {}
  if (!add && !run) return {};
  let base = {};
  try {
    base = JSON.parse(env?.OPENCODE_CONFIG_CONTENT || '{}') || {};
  } catch {}
  const plain = v => v && typeof v === 'object' && !Array.isArray(v);
  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = plain(a[k]) && plain(v) ? merge(a[k], v) : v;
    return out;
  };
  return {
    OPENCODE_CONFIG_CONTENT: JSON.stringify(
      merge(merge(base, add || {}), run ? { agent: { build: run, plan: run } } : {})
    ),
  };
}

// OpenCode's TUI settings file beside the rules file: {} when there is no rules folder.
function openCodeTui(rulesFile) {
  if (!rulesFile) return {};
  const fs = require('fs'),
    P = require('path'),
    file = P.join(P.dirname(rulesFile), 'opencode-tui.json'),
    body = '{ "theme": "system" }\n';
  try {
    let old = null;
    try {
      old = fs.readFileSync(file, 'utf8');
    } catch {}
    if (old !== body) fs.writeFileSync(file, body);
    return { OPENCODE_TUI_CONFIG: file };
  } catch {
    return {};
  }
}

// GitHub Copilot: the work rules (agent-hooks.js rulesFile) as one always-applied instructions file
// in Technically Not's own folder beside it; returns that folder for
// COPILOT_CUSTOM_INSTRUCTIONS_DIRS ('' = no rules file).
function copilotRules(rulesFile, text) {
  const fs = require('fs'),
    P = require('path');
  if (!rulesFile) return '';
  let rules = '';
  try {
    rules = fs.readFileSync(rulesFile, 'utf8');
  } catch {
    rules = String(text || '');
  }
  if (!rules.trim()) return '';
  const dir = P.join(P.dirname(rulesFile), 'copilot-rules'),
    file = P.join(dir, '.github', 'instructions', 'tnai-work-rules.instructions.md');
  const body = '---\napplyTo: "**"\n---\n\n' + rules.trim() + '\n';
  let old = null;
  try {
    old = fs.readFileSync(file, 'utf8');
  } catch {}
  if (old !== body) {
    fs.mkdirSync(P.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }

  // the variable is a comma-separated list: a comma in the path would split it
  return dir.includes(',') ? '' : dir;
}

// GitHub Copilot 1.0.88: `copilot --headless --no-auto-update --stdio` is the JSON-RPC server
// (Content-Length framing) its own SDK starts (copilot-sdk/index.js in its package); it answers
// without a model call, so no quota, and exits when its stdin closes (~1.5 s here). Asks `methods`
// in order under the account's COPILOT_HOME; { method: result | null }, null for all when it can't
// start or answer in 20 s.
function copilotAsk(path, accountDir, methods) {
  return new Promise(resolve => {
    const spec = launchSpec(path, ['--headless', '--no-auto-update', '--stdio']),
      out = {};
    let child;
    try {
      child = require('child_process').spawn(spec.file, spec.args, {
        cwd: require('os').tmpdir(),
        windowsHide: true,
        windowsVerbatimArguments: spec.verbatim,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ...(accountDir ? { COPILOT_HOME: accountDir } : {}) },
      });
    } catch {
      return resolve(null);
    }
    let buf = Buffer.alloc(0),
      next = 0,
      done = false;
    const finish = value => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {}
      setTimeout(() => {
        try {
          child.kill();
        } catch {}
      }, 3000).unref();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 20000);
    const ask = () => {
      if (next >= methods.length) return finish(out);
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: next + 1,
        method: methods[next],
        params: {},
      });
      child.stdin.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
    };
    child.on('error', () => finish(null));
    child.on('exit', () => finish(null));
    child.stdin.on('error', () => {});
    child.stdout.on('data', data => {
      buf = Buffer.concat([buf, data]);
      for (;;) {
        const head = buf.indexOf('\r\n\r\n');
        if (head < 0) return;
        const len = Number(
          (/Content-Length:\s*(\d+)/i.exec(buf.slice(0, head).toString()) || [])[1]
        );
        if (!(len >= 0) || buf.length < head + 4 + len) return;
        let msg = null;
        try {
          msg = JSON.parse(buf.slice(head + 4, head + 4 + len).toString('utf8'));
        } catch {}
        buf = buf.slice(head + 4 + len);
        if (msg && msg.id === next + 1) {
          out[methods[next]] = msg.result ?? null;
          next++;
          ask();
        }
      }
    });
    ask();
  });
}

// Sign-in from `auth.getStatus` (isAuthenticated, login, authType) and `account.getCurrentAuth`
// (the Copilot plan GitHub reports for it: access_type_sku "no_access" / chat_enabled false =
// signed in to GitHub without Copilot; is_mcp_enabled). Only these fields are kept.
const COPILOT_VIA = {
  user: 'Copilot sign-in',
  'gh-cli': 'GitHub CLI (gh) sign-in',
  env: 'Token from an environment variable',
  token: 'Token',
  'api-key': 'API key',
  hmac: 'HMAC',
};

async function copilotStatus(accountDir, path) {
  const r = await copilotAsk(path, accountDir, ['auth.getStatus', 'account.getCurrentAuth']);
  const auth = r?.['auth.getStatus'];
  if (!auth)
    return {
      loggedIn: null,
      account: '',
      method: '',
      note: 'Installed. Could not read Copilot’s sign-in state.',
    };
  if (!auth.isAuthenticated) return { loggedIn: false, account: '', method: '' };
  const user = r['account.getCurrentAuth']?.authInfo?.copilotUser || {},
    login = String(auth.login || '');
  const noCopilot = user.access_type_sku === 'no_access' || user.chat_enabled === false;

  // The plan state rides on the method (as Claude Code's plan does), since a note marks a failed
  // status read.
  const plan = noCopilot
    ? ' · no Copilot plan (it offers Copilot Free in its terminal)'
    : user.is_mcp_enabled === false
      ? ' · outside MCP servers off by policy'
      : '';
  return {
    loggedIn: true,
    account: /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : '',
    method: (COPILOT_VIA[auth.authType] || 'Signed in') + plan,
  };
}

// `models.list`: the models this account may use, each with its reasoning-effort levels; policy
// "disabled" ones are left out. Empty when the account has no Copilot access (GitHub answers 403).
// Kept per account folder (keepFresh).
const copilotListed = new Map();

function copilotModels(accountDir) {
  return keepFresh(copilotListed, accountDir || '', () => readCopilotModels(accountDir));
}

async function readCopilotModels(accountDir) {
  const path = cache.get('GitHub Copilot')?.path || (await resolveCommand('copilot'));
  if (!path) return { models: [], efforts: [] };
  const list = (await copilotAsk(path, accountDir, ['models.list']))?.['models.list']?.models || [];
  const models = list
    .filter(m => m && typeof m.id === 'string' && PICK.test(m.id) && m.policy?.state !== 'disabled')
    .map(m => ({
      id: m.id,
      label: typeof m.name === 'string' && m.name ? m.name : m.id,
      group: m.id.split('-')[0],
      efforts: (m.supportedReasoningEfforts || []).filter(e => typeof e === 'string'),
    }));
  return { models, efforts: [...new Set(models.flatMap(m => m.efforts))] };
}

// A model list read from a CLI is reused for LIST_TTL, then re-read in the background while the
// menu gets the last list at once, so a model that a CLI update or the account adds shows up
// without restarting Technically Not. An empty list is never kept; a failed re-read retries in a
// minute.
const LIST_TTL = 10 * 60e3;

function keepFresh(map, key, load) {
  const hit = map.get(key),
    size = v => (Array.isArray(v) ? v : v?.models || []).length;
  const run = () =>
    load().then(value => {
      if (size(value)) map.set(key, { value, at: Date.now() });
      return value;
    });
  if (!hit) return run();
  if (Date.now() - hit.at > LIST_TTL && !hit.pending)
    hit.pending = run()
      .catch(() => {})
      .finally(() => {
        hit.pending = null;
        hit.at = Math.max(hit.at, Date.now() - LIST_TTL + 60e3);
      });
  return Promise.resolve(hit.value);
}

// npm's generated .cmd shim (`"%dp0%\node_modules\...\cli.js|.exe" %*`) started as its program
// directly (a .js through node), so long arguments such as Technically Not's work rules skip
// cmd.exe's 8191-char line limit and its caret escaping. Null for any other .cmd. Same rule in
// agent-shim.js. node.exe beside the shim, else the first on PATH: remembered per folder (a sync
// stat of every PATH folder on each launch), re-checked if it goes away.
const nodeSeen = new Map(); // shim folder -> node.exe path

function nodeFor(dir) {
  const fs = require('fs'),
    P = require('path');
  const hit = nodeSeen.get(dir);
  if (hit && fs.existsSync(hit)) return hit;
  const node = [dir, ...(process.env.PATH || process.env.Path || '').split(P.delimiter)]
    .filter(Boolean)
    .map(d => P.join(d, process.platform === 'win32' ? 'node.exe' : 'node'))
    .find(f => fs.existsSync(f));
  if (node) nodeSeen.set(dir, node);
  else nodeSeen.delete(dir);
  return node;
}

function npmTarget(file) {
  const fs = require('fs'),
    P = require('path');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const m = text.match(/"%dp0%\\([^"%]+\.(js|exe))"\s+%\*\s*$/i);
  if (!m) return null;
  const dir = P.dirname(file),
    target = P.join(dir, m[1]);
  if (!fs.existsSync(target)) return null;
  if (m[2].toLowerCase() === 'exe') return { file: target, pre: [] };
  const node = nodeFor(dir);
  return node ? { file: node, pre: [target] } : null;
}

// .cmd shims need one pre-quoted cmd.exe command line (`verbatim`), or Windows re-quotes the path
// and cmd cannot find it.
function launchSpec(path, args) {
  const npm = /\.cmd$/i.test(path) ? npmTarget(path) : null;
  if (npm) return { file: npm.file, args: [...npm.pre, ...args], verbatim: false };
  return /\.(cmd|bat)$/i.test(path)
    ? {
        file: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', '""' + path + '"' + args.map(a => ' ' + cmdArg(a)).join('') + '"'],
        verbatim: true,
      }
    : { file: path, args, verbatim: false };
}

// Two runs of one CLI in a single pane (logout, then login): one cmd.exe line joined with `&`, so
// the login runs even when logout finds no sign-in. mac/Linux: one `/bin/sh -c` line joined with
// `;`, every word single-quoted for the shell.
const shArg = a => "'" + String(a).replace(/'/g, "'\\''") + "'";

function chainSpec(path, first, second) {
  if (process.platform !== 'win32')
    return {
      file: '/bin/sh',
      args: [
        '-c',
        [path, ...first].map(shArg).join(' ') + '; ' + [path, ...second].map(shArg).join(' '),
      ],
      verbatim: false,
    };
  const part = args => '"' + path + '"' + args.map(a => ' ' + cmdArg(a)).join('');
  return {
    file: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', '"' + part(first) + ' & ' + part(second) + '"'],
    verbatim: true,
  };
}

// The shells "Your terminal" can run on Windows (136's picker), in the order they are offered.
// Each is offered only when it is found on this computer (`shells` below). `find` gives the file
// to start, or '' when the shell is not there.
const fromFolders = (folders, rest) => {
  const fs = require('fs');
  const path = require('path');
  for (const folder of folders) {
    const file = folder ? path.join(folder, rest) : '';
    if (file && fs.existsSync(file)) return file;
  }
  return '';
};
const WINDOWS_SHELLS = [
  {
    id: 'powershell',
    name: 'PowerShell',
    args: ['-NoLogo'],
    find: async () => 'powershell.exe',
  },
  {
    id: 'pwsh',
    name: 'PowerShell 7',
    args: ['-NoLogo'],
    find: async () => (await resolveCommand('pwsh')) || '',
  },
  {
    id: 'cmd',
    name: 'Command Prompt',
    args: [],
    find: async () => process.env.ComSpec || 'cmd.exe',
  },
  {
    id: 'gitbash',
    name: 'Git Bash',
    args: ['--login', '-i'],
    find: async () =>
      fromFolders(
        [
          process.env.ProgramFiles,
          process.env['ProgramFiles(x86)'],
          process.env.LOCALAPPDATA && require('path').join(process.env.LOCALAPPDATA, 'Programs'),
        ],
        'Git\\bin\\bash.exe'
      ),
  },
  {
    id: 'wsl',
    name: 'WSL',
    args: [],

    // wsl.exe is on most computers; it is a shell only where a Linux system is installed
    find: async () => {
      const file = fromFolders([process.env.SystemRoot], 'System32\\wsl.exe');
      if (!file) return '';
      const listed = await run(file, ['-l', '-q'], 5000);
      return listed.ok && listed.out.replace(/\0/g, '').trim() ? file : '';
    },
  },
];

// What was found, looked for once: { id: { id, name, file, args } }.
let shellsFound = null;

function findShells() {
  if (shellsFound) return shellsFound;
  shellsFound = (async () => {
    const found = {};
    if (process.platform !== 'win32') return found;
    for (const shell of WINDOWS_SHELLS) {
      const file = await shell.find().catch(() => '');
      if (file) found[shell.id] = { id: shell.id, name: shell.name, file, args: shell.args };
    }
    return found;
  })();
  return shellsFound;
}

// The shells to choose from for "Your terminal": [{ id, name }], the usual one first. Off Windows
// the list is empty: the terminal runs the user's login shell and there is nothing to choose.
async function shells() {
  return Object.values(await findShells()).map(shell => ({ id: shell.id, name: shell.name }));
}

// Command marks for "Your terminal": PowerShell tells the terminal where each prompt starts and
// how the command before it ended (the marks other terminals use too: OSC 133 A, B and D with
// the exit code). The user's profile is not changed and nothing is typed into the shell: these
// lines are given to this one shell as a start argument, after its profile has run. They wrap
// the prompt the profile set up. That prompt is called in the first statement, together with
// the reading of `$?`, so it still sees whether the last command worked, as without the wrapper.
// A mark for an ended command is sent only when the history holds a new command (not after an
// empty Enter). The exit code is PowerShell's `$LASTEXITCODE`, which keeps the code of the last
// program for as long as no other program runs: it is sent only when it changed since the last
// prompt, and a failure without a new code is sent as 1.
const MARKS_FOR_POWERSHELL = [
  '$global:__tnaiPrompt = $function:prompt',
  '$global:__tnaiSeen = 0',
  '$global:__tnaiCode = $global:LASTEXITCODE',
  'function global:prompt {',

  // read in one statement with the profile's own prompt, so that prompt still sees whether the
  // last command worked: that, the newest error, and what the prompt draws
  '  $tnai = $?, $Error[0], @(& $global:__tnaiPrompt)',
  '  $e = [char]27',
  '  $b = [char]7',

  // PowerShell lists these start lines in the session's own history (Get-History): they are
  // taken out again at the first prompt, so the list holds only what the user ran
  '  if (-not $global:__tnaiReady) {',
  '    $global:__tnaiReady = $true',
  "    Get-History | Where-Object CommandLine -match '__tnaiPrompt' |",
  '      ForEach-Object { Clear-History -Id $_.Id }',
  '  }',
  '  $last = Get-History -Count 1',
  "  $mark = ''",
  '  if ($last -and $last.Id -ne $global:__tnaiSeen) {',
  '    $global:__tnaiSeen = $last.Id',
  '    $code = 0',
  '    if (-not $tnai[0]) {',
  '      $code = 1',

  // A program's exit code is named when it is this command's own: the code changed, or the
  // failure left no new error (a PowerShell command that fails leaves one and keeps the old
  // code; a program that ends with the same code twice leaves none).
  '      $own = [object]::ReferenceEquals($tnai[1], $global:__tnaiError)',
  '      if ($global:LASTEXITCODE -and',
  '          ($own -or $global:LASTEXITCODE -ne $global:__tnaiCode)) {',
  '        $code = $global:LASTEXITCODE',
  '      }',
  '    }',
  '    $global:__tnaiCode = $global:LASTEXITCODE',
  '    $mark = "$e]133;D;$code$b"',
  '  }',
  '  $global:__tnaiError = $tnai[1]',

  // where the shell stands now, for the row over the terminal (a folder of the file system
  // only: in the registry or another drive of PowerShell's there is no folder to name)
  "  $where = ''",
  "  if ($PWD.Provider.Name -eq 'FileSystem') {",
  '    $where = "$e]133;P;Cwd=$($PWD.ProviderPath)$b"',
  '  }',
  '  "$mark$where$e]133;A$b" + (-join $tnai[2]) + "$e]133;B$b"',
  '}',
].join('\n');

// Given encoded, so no quote or dollar sign of it meets a command line.
const marksArgs = () => [
  '-NoExit',
  '-EncodedCommand',
  Buffer.from(MARKS_FOR_POWERSHELL, 'utf16le').toString('base64'),
];

// The other shells get what they can say through a variable of their own start, never through
// their profile and never typed in. Command Prompt draws its prompt from PROMPT: the marks go
// round the prompt it would have drawn, with the folder ($P). It cannot say how a command
// ended (PROMPT is plain text, read once), so its commands get no dot; the folder follows.
function promptForCmd() {
  const own = process.env.PROMPT || '$P$G';
  return '$E]133;P;Cwd=$P$E\\$E]133;A$E\\' + own + '$E]133;B$E\\';
}

// Bash (Git Bash, and the shell of a Linux system under WSL when it is bash) runs
// PROMPT_COMMAND before every prompt. It sends how the command before ended, only when the
// history holds a new line (not after an empty Enter, and not at the first prompt), then
// where the shell stands as a Windows folder (`cygpath` in Git Bash, `wslpath` under WSL),
// and it puts the end-of-prompt mark at the end of PS1 once. Bash keeps `$?` as it was for
// the prompt's own use. A profile that sets PROMPT_COMMAND itself replaces this one: then the
// shell says nothing, as before, and the row names the folder it started in.
const MARKS_FOR_BASH = [
  '__tnai_c=$?',
  '__tnai_h=$(HISTTIMEFORMAT= history 1)',
  'if [ -n "${__tnai_p+x}" ] && [ "$__tnai_h" != "$__tnai_p" ]; then printf "\\033]133;D;%s\\007" "$__tnai_c"; fi',
  '__tnai_p=$__tnai_h',
  '__tnai_w=$(cygpath -w "$PWD" 2>/dev/null || wslpath -w "$PWD" 2>/dev/null || printf %s "$PWD")',
  'printf "\\033]133;P;Cwd=%s\\007\\033]133;A\\007" "$__tnai_w"',
  'case $PS1 in *"133;B"*) ;; *) PS1="$PS1\\[\\033]133;B\\007\\]" ;; esac',
].join('; ');

// What a chosen shell is started with besides its own arguments.
function marksEnv(id) {
  if (id === 'cmd') return { PROMPT: promptForCmd() };
  if (id === 'gitbash') return { PROMPT_COMMAND: MARKS_FOR_BASH };

  // a variable reaches the Linux side only when WSLENV names it
  if (id === 'wsl') {
    const named = (process.env.WSLENV || '').split(':').filter(Boolean);
    if (!named.includes('PROMPT_COMMAND')) named.push('PROMPT_COMMAND');
    return { PROMPT_COMMAND: MARKS_FOR_BASH, WSLENV: named.join(':') };
  }
  return {};
}

// `shellId`: one of the shells above, chosen for "Your terminal" (then it also gets its command
// marks, as far as that shell can send them); empty for every other plain session, which is the
// usual shell as it always was.
async function shellSpec(shellId) {
  if (process.platform !== 'win32')
    return {
      file: process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'),
      args: ['-l'],
    }; // mac/Linux: the user's login shell
  const chosen = shellId && shellId !== 'powershell' ? (await findShells())[shellId] : null;
  if (chosen)
    return {
      file: chosen.file,
      args: [...chosen.args, ...(chosen.id === 'pwsh' ? marksArgs() : [])],
      env: marksEnv(chosen.id),
    };
  return { file: 'powershell.exe', args: ['-NoLogo', ...(shellId ? marksArgs() : [])] };
}

const cache = new Map(); // id -> { path, installed }

// Model lists for the composer's model/effort dropdowns (46), read from each CLI's own source,
// never guessed. `group` = optgroup. Claude Code: the current models of the model table built into
// claude 2.1.282 (id = its first-party id; 3.x models left out as retired).
const CLAUDE_MODELS = [
  ['claude-fable-5-1', 'Fable 5.1', 'Fable'],
  ['claude-fable-5', 'Fable 5', 'Fable'],
  ['claude-mythos-5-1', 'Mythos 5.1', 'Mythos'],
  ['claude-mythos-5', 'Mythos 5', 'Mythos'],
  ['claude-opus-5-5', 'Opus 5.5', 'Opus'],
  ['claude-opus-5', 'Opus 5', 'Opus'],
  ['claude-opus-4-8', 'Opus 4.8', 'Opus'],
  ['claude-opus-4-7', 'Opus 4.7', 'Opus'],
  ['claude-opus-4-6', 'Opus 4.6', 'Opus'],
  ['claude-opus-4-5-20251101', 'Opus 4.5', 'Opus'],
  ['claude-opus-4-1-20250805', 'Opus 4.1', 'Opus'],
  ['claude-opus-4-20250514', 'Opus 4', 'Opus'],
  ['claude-sonnet-5-5', 'Sonnet 5.5', 'Sonnet'],
  ['claude-sonnet-5', 'Sonnet 5', 'Sonnet'],
  ['claude-sonnet-4-6', 'Sonnet 4.6', 'Sonnet'],
  ['claude-sonnet-4-5-20250929', 'Sonnet 4.5', 'Sonnet'],
  ['claude-sonnet-4-20250514', 'Sonnet 4', 'Sonnet'],
  ['claude-haiku-5-5', 'Haiku 5.5', 'Haiku'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5', 'Haiku'],
]; // Haiku 5.5: out 2026-10-07, taken by claude 2.1.293

// Claude Code prints no model list, so the app shows a list kept outside the app: a new Claude
// model appears in every app on release day, no app update. The list is the accounts server's
// GET /models/claude when this build names a server; otherwise (the free build) the file
// `models/claude.json` in the public GitHub repo, which anyone can read and a maintainer updates
// on the day a model comes out. Fetched in the background at most once an hour (a
// menu never waits on the network), kept on disk for offline starts; the built-in CLAUDE_MODELS
// above is the fallback and ships with each release. Only rows that look like real Claude ids are
// taken.
const CLAUDE_LIST_TTL = 3600e3,
  CLAUDE_LIST_TIMEOUT = 5000;
const claudeList = { rows: null, at: 0, pending: null, loaded: false };

// The public repo is the one package.json's homepage names (github.com/OWNER/REPO).
const publicClaudeList = () => {
  const repo = /github\.com\/([\w.-]+\/[\w.-]+)/.exec(
    String(require('../package.json').homepage || '')
  );
  return repo ? 'https://raw.githubusercontent.com/' + repo[1] + '/main/models/claude.json' : '';
};

// Where the list comes from now: the server's address when there is one, else the public file.
const claudeListUrl = () =>
  claudeListServer() ? claudeListServer() + '/models/claude' : publicClaudeList();

// Each source keeps its own saved copy, so a list saved from the server by an earlier version is
// never shown by a build that reads the public file.
const claudeCacheFile = () => {
  try {
    const { app } = require('electron');
    const name = claudeListServer() ? 'claude-models.json' : 'claude-models-public.json';
    return app?.getPath ? require('path').join(app.getPath('userData'), name) : '';
  } catch {
    return '';
  }
};

function validClaudeRows(data) {
  const rows = (Array.isArray(data?.models) ? data.models : [])
    .filter(
      m =>
        m &&
        typeof m.id === 'string' &&
        /^claude-[a-z0-9-]{1,60}$/.test(m.id) &&
        typeof m.label === 'string' &&
        m.label.length <= 40 &&
        typeof m.group === 'string' &&
        m.group.length <= 20
    )
    .slice(0, 80);
  return rows.length
    ? rows.map(m => ({
        id: m.id,
        label: m.label.trim() || m.id,
        group: m.group.trim() || 'Claude',
      }))
    : null;
}

// The server the list comes from: the accounts server's address, '' when this build names none.
// TNAI_ACCOUNTS_URL is a developer override for a copy run from source; a release build ignores
// it, so an environment variable cannot turn the server list back on in an installed app.
const claudeListServer = () => {
  const envUrl = require('./build-info').release ? undefined : process.env.TNAI_ACCOUNTS_URL;
  return (envUrl ?? String(require('../package.json').tnaiAccountsUrl || '')).replace(/\/+$/, '');
};

// The list built into the app.
const builtInClaudeModels = () => CLAUDE_MODELS.map(([id, label, group]) => ({ id, label, group }));

function claudeModels() {
  if (!claudeListUrl()) return builtInClaudeModels();
  if (!claudeList.loaded) {
    // last list seen, from an earlier run
    claudeList.loaded = true;
    try {
      const f = claudeCacheFile();
      if (f) {
        const c = JSON.parse(require('fs').readFileSync(f, 'utf8'));
        claudeList.rows = validClaudeRows(c);
        claudeList.at = +c.at || 0;
      }
    } catch {}
  }
  if (Date.now() - claudeList.at > CLAUDE_LIST_TTL && !claudeList.pending)
    claudeList.pending = (async () => {
      try {
        const url = claudeListUrl();
        if (!url) return;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(CLAUDE_LIST_TIMEOUT),
        });
        const rows = res.ok ? validClaudeRows(await res.json()) : null;
        if (!rows) return;
        claudeList.rows = rows;
        claudeList.at = Date.now();
        const f = claudeCacheFile();
        if (f)
          await require('fs')
            .promises.writeFile(f, JSON.stringify({ at: claudeList.at, models: rows }))
            .catch(() => {});
      } catch {
      } finally {
        claudeList.at = Math.max(claudeList.at, Date.now() - CLAUDE_LIST_TTL + 10 * 60e3);
        claudeList.pending = null;
      } // a failure retries in 10 min
    })();
  return claudeList.rows || builtInClaudeModels();
}

// A CLI's own model list printed one per line ("id - Label" or a bare "provider/model"); kept per
// CLI (keepFresh).
const listed = new Map();

function listModels(command, args, parse) {
  return keepFresh(listed, command, async () => {
    const path = await resolveCommand(command);
    if (!path) return [];
    const { out } = await runSpec(launchSpec(path, args), 30000);
    return stripAnsi(out).split(/\r?\n/).map(parse).filter(Boolean);
  });
}

// OpenCode: `opencode models --verbose` (opencode 1.18.35 `models --help`) prints each
// provider/model id on its own line, then that model's record as indented JSON (name, family, cost
// per 1M tokens, limit.context, status, release_date). Grouped by provider; the label is the
// model's own name, and `note` is the text the composer adds to the row's hover title (46). A model
// id may hold `@` and `~` (cloudflare-workers-ai/@cf/…: 190 ids of its models.dev list,
// 2026-10-06). A CLI that prints ids only (an older one) still gives the list. Effort stays empty:
// OpenCode's TUI has no start flag for a model variant (only `opencode run --variant`).
const OC_ID = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._:@~\[\]\/-]+)$/;

// about 1.5 KB a model: a gateway adds hundreds, the whole models.dev list (8,400) is about 13 MB
const OC_LIST_MAX = 64 << 20;
const ocMoney = n => '$' + +n.toFixed(4),
  ocSize = n => (n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : Math.round(n / 1000) + 'K');

function openCodeMeta(m, j) {
  if (!j || typeof j !== 'object') return;
  if (typeof j.name === 'string' && j.name.trim() && j.name.length <= 80) m.label = j.name.trim();
  if (typeof j.family === 'string' && j.family) m.family = j.family;
  if (j.limit?.context > 0) m.context = +j.limit.context;
  if (typeof j.cost?.input === 'number' && typeof j.cost?.output === 'number')
    m.cost = { input: j.cost.input, output: j.cost.output };
  if (j.status === 'deprecated') m.deprecated = true;

  // The model's effort levels, in OpenCode's own order (its TUI steps through them in this order).
  // Kept as `variants`; they become `efforts`, which lights up the Effort control, only while the
  // server link is available (openCodeModels; how a pick is applied: openCodeAccessEnv).
  const variants = Object.keys(
    j.variants && typeof j.variants === 'object' ? j.variants : {}
  ).filter(v => /^[a-z]{2,12}$/.test(v));
  if (variants.length) m.variants = variants;
  if (/^\d{4}-\d{2}-\d{2}/.test(j.release_date || '')) m.released = j.release_date.slice(0, 10);

  // Zero cost is "free" only on OpenCode's own provider (Zen); elsewhere it may only mean the
  // provider's config names no price.
  const zen = m.group === 'opencode',
    free = !!m.cost && !m.cost.input && !m.cost.output;
  m.note = [
    free
      ? zen
        ? 'free'
        : 'listed at $0'
      : m.cost
        ? ocMoney(m.cost.input) + ' in / ' + ocMoney(m.cost.output) + ' out per 1M tokens'
        : '',
    m.context ? ocSize(m.context) + ' context' : '',
    m.deprecated ? 'deprecated' : '',
    free && zen
      ? 'OpenCode says data sent to some of its free models may be used to improve the model (opencode.ai/docs/zen)'
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function parseOpenCodeList(out) {
  const models = [];
  let cur = null,
    json = null;
  for (const line of stripAnsi(out).split(/\r?\n/)) {
    if (json) {
      json.push(line);
      if (line === '}') {
        try {
          if (cur) openCodeMeta(cur, JSON.parse(json.join('\n')));
        } catch {}
        json = null;
        cur = null;
      }
      continue;
    }
    const m = line.trim().match(OC_ID);
    if (m) models.push((cur = { id: m[0], label: m[2], group: m[1] }));
    else if (line === '{')
      // the record of the id line right above it; of a line that was no id, read past
      json = [line];
    else cur = null;
  }

  // deprecated ones last
  return [...models.filter(m => !m.deprecated), ...models.filter(m => m.deprecated)];
}

// Read in the project folder when one is given (a project's own opencode.json can add providers),
// and kept per folder. A call without a folder (model-pick.js) reads in the last one given, so an
// agent's pick sees the list the composer shows.
let ocDir = '';

async function openCodeModels(accountDir, cwd) {
  if (cwd && typeof cwd === 'string' && require('fs').existsSync(cwd)) ocDir = cwd;
  let linkReady = false;
  try {
    linkReady =
      openCodeEffortOn &&
      require('./opencode-link')
        .ready()
        .catch(() => false);
  } catch {} // asked beside the list read, so it adds no wait
  const dir = ocDir;
  const models = await keepFresh(listed, 'opencode|' + dir, async () => {
    const path = await resolveCommand('opencode');
    if (!path) return [];
    const more = { maxBuffer: OC_LIST_MAX, ...(dir ? { cwd: dir } : {}) };
    const full = await runSpec(launchSpec(path, ['models', '--verbose']), 30000, null, more);
    const list = full.ok ? parseOpenCodeList(full.out) : [];
    return list.length
      ? list
      : // no --verbose, or too long: the ids alone
        parseOpenCodeList((await runSpec(launchSpec(path, ['models']), 30000, null, more)).out);
  });

  // A model's own effort levels are offered only with the switch on and while the link to
  // OpenCode's server is available (openCodeAccessEnv says why). effortWhy: why no model here
  // offers an effort ('off' = the switch, 'nolink' = no link), for model-pick.js and the composer's
  // Effort hint (46); effortNote: the sentence the composer adds to the Effort control's hover text
  // when levels are offered.
  const link = !!(await linkReady);
  return {
    models: link ? models.map(m => (m.variants ? { ...m, efforts: m.variants } : m)) : models,
    efforts: [],
    ...(link
      ? { effortNote: 'This also changes the level OpenCode itself uses for this model' }
      : { effortWhy: openCodeEffortOn ? 'nolink' : 'off' }),
  };
}

// A listed model's effort levels, in OpenCode's own order ([] = none, or the list was not read
// yet).
function openCodeVariants(model) {
  for (const [key, hit] of listed)
    if (key.startsWith('opencode|')) {
      const m = hit.value.find(x => x.id === model);
      if (m) return m.variants || [];
    }
  return [];
}

// OpenCode's saved credentials changed (a sign-in panel ended, a provider was added or removed):
// its model list is read again at the next ask. Only a hash of the status text is kept.
let ocStatus = null;

function openCodeStatus(out) {
  const sig = require('crypto')
    .createHash('sha1')
    .update(stripAnsi(out).replace(/\s+/g, ' ').trim())
    .digest('hex');
  if (ocStatus !== null && sig !== ocStatus)
    for (const key of [...listed.keys()]) if (key.startsWith('opencode|')) listed.delete(key);
  ocStatus = sig;
}

// A listed OpenCode model's context size in tokens (agent-turns.js: the `window` of an OpenCode
// turn's context); 0 = not known, never guessed.
function openCodeWindow(model) {
  for (const [key, hit] of listed)
    if (key.startsWith('opencode|')) {
      const m = hit.value.find(x => x.id === model);
      if (m?.context) return m.context;
    }
  return 0;
}

// Codex keeps the models its account offers in models_cache.json (visibility "list" = shown in its
// own /model picker).
async function codexModels(accountDir) {
  const home =
    accountDir || process.env.CODEX_HOME || require('path').join(require('os').homedir(), '.codex');
  let data;
  try {
    data = JSON.parse(
      await require('fs').promises.readFile(require('path').join(home, 'models_cache.json'), 'utf8')
    );
  } catch {
    return { models: [], efforts: [] };
  }
  const models = (data.models || [])
    .filter(m => m.slug && m.visibility === 'list')
    .map(m => ({
      id: m.slug,
      label: m.display_name || m.slug,
      efforts: (m.supported_reasoning_levels || [])
        .map(e => e.effort || e)
        .filter(e => typeof e === 'string'),
    }));
  return { models, efforts: [...new Set(models.flatMap(m => m.efforts))] };
}

// Cursor lists its models with `cursor-agent --list-models` ("id - Label" lines); grouped by family
// (gpt, claude, gemini, …).
async function cursorModels() {
  const models = await listModels('cursor-agent', ['--list-models'], line => {
    const m = line.match(/^\s*([A-Za-z0-9._:\[\]-]+) - (.+?)\s*$/);
    return (
      m &&
      m[1] !== 'auto' && {
        id: m[1],
        label: m[2].replace(/\s*\(.*\)$/, ''),
        group: m[1].split('-')[0],
      }
    );
  });
  return { models, efforts: [] };
}

// Antigravity lists its models with `agy models` ("id<TAB>Label" lines, only when signed in);
// grouped by family (gemini, claude, gpt).
async function agyModels() {
  const models = await listModels('agy', ['models'], line => {
    const m = line.match(/^([A-Za-z0-9._:-]+)\t+(.+?)\s*$/);
    return m && { id: m[1], label: m[2], group: m[1].split('-')[0] };
  });
  return { models, efforts: [] };
}

// Only a plain model id or effort word reaches the command line (no cmd.exe metacharacters).
// `@` and `~` (OpenCode ids) are no cmd.exe metacharacters: both come through cmdArg and a .cmd
// shim unchanged (tried 2026-10-06).
const PICK = /^[A-Za-z0-9._:@~\[\]\/-]{1,120}$/;
const cleanPick = o => ({
  model: PICK.test(o.model || '') ? o.model : '',
  effort: /^[a-z]{2,12}$/.test(o.effort || '') ? o.effort : '',
});

// Access levels; `default` is the CLI's own settings and adds
// nothing. Only these words are taken, and the flags come from each CLI's fixed table, so nothing
// the renderer sends reaches the command line as text.
const ACCESS = ['default', 'ask', 'edits', 'auto', 'full', 'plan'];
const ACCESS_NOUN = {
  plan: 'plan-only mode',
  ask: 'ask-first mode',
  edits: 'edits-only mode',
  auto: 'automatic review',
  full: 'full-access mode',
};
const cleanAccess = level => (ACCESS.includes(level) ? level : 'default');

// accessArgs from a { level: flags } table: a copy of the flags, [] for `default`, null for a level
// the CLI has no flag for.
function accessFlags(table) {
  return level => (level === 'default' ? [] : table[level] ? [...table[level]] : null);
}

// { levels, why }: the levels a CLI has, and for each other level the reason the composer shows
// beside it, greyed out.
function accessOf(a) {
  const levels = ACCESS.filter(l => l === 'default' || (a.accessArgs && a.accessArgs(l)));
  const why = Object.fromEntries(
    ACCESS.filter(l => !levels.includes(l)).map(l => [
      l,
      a.accessWhy?.all || a.accessWhy?.[l] || a.id + ' has no ' + ACCESS_NOUN[l],
    ])
  );
  return { levels, why };
}

async function detect(agent, accountDir) {
  const path =
    cache.get(agent.id)?.path && accountDir
      ? cache.get(agent.id).path
      : await resolveCommand(agent.command);
  if (!accountDir) cache.set(agent.id, { path });
  const result = {
    id: agent.id,
    command: agent.command,
    installed: !!path,
    path: path || '',
    version: '',
    loggedIn: null,
    account: '',
    method: '',
    note: '',
  };
  if (!path) {
    result.note = '`' + agent.command + '` was not found on PATH.';
    return result;
  }
  const version = await runSpec(launchSpec(path, ['--version']));
  result.version = stripAnsi(version.out).split(/\r?\n/).find(Boolean)?.trim() || '';
  if (agent.readStatus) {
    Object.assign(result, await agent.readStatus(accountDir, path));
    return result;
  } // no status command: read from the CLI's own files
  if (!agent.status) {
    result.note =
      'Installed. Technically Not cannot read this CLI’s login state; it signs in inside its own terminal.';
    return result;
  }
  const status = await runSpec(
    launchSpec(path, agent.status),
    20000,
    accountEnv(agent, accountDir)
  );
  Object.assign(result, agent.parse(status.out));
  if (agent.id === 'OpenCode') openCodeStatus(status.out);
  return result;
}

module.exports = {
  resolveCommand,
  shells,
  ids: () => AGENTS.map(a => a.id),
  // Release info per CLI (RELEASES above), in AGENTS order; a CLI without a row comes back with
  // feed '' so the tools can flag it.
  releases: () =>
    AGENTS.map(a => ({
      id: a.id,
      command: a.command,
      feed: '',
      notes: '',
      npm: '',
      update: '',
      match: '',
      ...RELEASES[a.id],
    })),
  // One CLI after another, 15 ms apart: started in the same tick, every CLI's first `where.exe` was
  // spawned back to back (a spawn is synchronous on Windows, 30 to 60 ms each), which held the main
  // process, and with it the window, for about half a second at app start (measured 2026-10-03: 507
  // ms). The checks still run side by side; only their starts are spread out.
  detectAll: async () => {
    const all = [];
    for (const a of AGENTS) {
      all.push(detect(a));
      await new Promise(r => setTimeout(r, 15));
    }
    return Promise.all(all);
  },
  // What the Usage & accounts page offers for a CLI that is not installed: { node, nodeCommand,
  // nodePage, tools: { id: { command, page, needsNode } } }. command '' = nothing to run on this
  // system (the page link is still shown). Takes the PATH as it is now first, so the detection that
  // follows finds what an installer just added.
  async installInfo() {
    await freshPath();
    const win = process.platform === 'win32',
      tools = {};
    for (const a of AGENTS) {
      const how = INSTALL[a.id];
      if (!how) continue;
      tools[a.id] = {
        command: how.npm ? 'npm install -g ' + how.npm : win ? how.win || '' : '',
        page: how.page || '',
        needsNode: !!how.npm,
      };
    }
    return {
      node: !!(await resolveCommand('npm')),
      nodeCommand: win ? NODE_INSTALL.win : '',
      nodePage: NODE_INSTALL.page,
      tools,
    };
  },
  // Installed version text of one CLI (`<cli> --version`, first line), '' when it is not on PATH
  // (cli-updates.js).
  async version(id) {
    const agent = AGENTS.find(a => a.id === id);
    if (!agent) return '';
    const path = cache.get(agent.id)?.path || (await resolveCommand(agent.command));
    if (!path) return '';
    return (
      stripAnsi((await runSpec(launchSpec(path, ['--version']))).out)
        .split(/\r?\n/)
        .find(Boolean)
        ?.trim() || ''
    );
  },
  // Login status of one CLI under one account folder (null = the CLI's default home).
  detectAccount: (id, accountDir) => {
    const agent = AGENTS.find(a => a.id === id);
    return agent ? detect(agent, accountDir) : Promise.resolve(null);
  },
  // What Technically Not can do per CLI: separate accounts (`home` env var + folders shared between
  // accounts) and resume.
  capabilities: () =>
    AGENTS.map(a => ({
      id: a.id,
      accounts: !!a.home,
      apiKey:
        a.apiKey && a.home
          ? { provider: a.apiKey.provider, prefix: a.apiKey.prefix, keyUrl: a.apiKey.keyUrl }
          : null,
      home: a.home || '',
      shared: a.shared || [],
      resume: !!a.startArgs,
      skills: !!a.customArgs,
      access: accessOf(a),
      signIn:
        a.login && a.signIn
          ? {
              provider: a.signIn.provider,
              browser: a.signIn.browser,
              email: a.signIn.email,
              command: (a.command + ' ' + a.login.join(' ')).trim(),
              switchCommand: a.logout
                ? a.command +
                  ' ' +
                  a.logout.join(' ') +
                  ', then ' +
                  a.command +
                  ' ' +
                  a.login.join(' ')
                : '',
              methods: a.signIn.methods.map(({ id, label, detail }) => ({ id, label, detail })),
            }
          : null,
    })),
  // Technically Not's additions (work rules, custom args such as Claude Code's hooks) for a CLI the
  // user started by hand in a terminal pane (agent-mesh.js); no session/resume args.
  handArgs(id, opts = {}) {
    const agent = AGENTS.find(a => a.id === id);
    if (!agent) return { args: [], env: {} };
    const rules = agent.rules && opts.workRules ? agent.rules(opts) : {};
    return {
      args: [...(rules.args || []), ...(agent.customArgs ? agent.customArgs(opts) : [])],
      env: rules.env || {},
    };
  },
  // Returns {file,args,env} for an interactive session (mode 'run') or the CLI's own login flow
  // (mode 'login'). opts: { accountDir, sessionId, resumeId, model, effort, access, askOnResume,
  // pluginDirs, appendPrompt, appendPromptFile, settingsFile, mcpConfig, workRules, rulesFile,
  // rulesPlugin, addDirs, chrome, login: { email, method, switch } }.
  async spec(id, mode, opts = {}) {
    if (id === 'Terminal') return shellSpec(opts.shell);
    const agent = AGENTS.find(a => a.id === id);
    if (!agent) throw new Error(id + ' has no connector in Technically Not yet.');
    let path = cache.get(id)?.path;
    if (!path) path = await resolveCommand(agent.command);
    if (!path) throw new Error(agent.command + ' is not installed or not on PATH.');
    if (mode === 'login') {
      if (!agent.login) throw new Error(id + ' signs in from inside its own session.');
      const login = checkLogin(agent, opts.login),
        args = [...agent.login, ...(agent.loginArgs ? agent.loginArgs(login) : [])];

      // login.switch: sign the current account out first (Switch account, single-account CLIs with
      // a `logout` command).
      if (opts.login?.switch === true && agent.logout)
        return { ...chainSpec(path, agent.logout, args), env: accountEnv(agent, opts.accountDir) };
      return { ...launchSpec(path, args), env: accountEnv(agent, opts.accountDir) };
    }
    const rules = agent.rules && opts.workRules ? agent.rules(opts) : {};

    // A picked model/effort: the CLI's pick for a fresh session; for a resumed one only the model
    // that agent itself last ran on (the renderer, 46, sends nothing else).
    const pick = agent.pickArgs ? agent.pickArgs(cleanPick(opts)) : [];

    // The access level is set when a session starts (a resumed one keeps the CLI's own); a level
    // this CLI has no flag for is refused, never swapped for a nearby one (the composer greys those
    // out; a sub-agent capped at its lead's level can land on one, 46 subAccess). accessOnResume
    // (OpenCode): its levels are launch config, which a resumed conversation does not carry, so
    // they are sent again. askOnResume (remote-actions.js startOptions: a conversation of a panel
    // that was started from another computer): the one case in which a resumed conversation of a
    // CLI without accessOnResume is given a level, and that level is always "Ask first", whatever
    // `access` says. A CLI that cannot take the level on a resume is not started.
    const held = !!opts.resumeId && opts.askOnResume === true;
    if (held && !agent.askOnResume && !agent.accessOnResume)
      throw new Error(
        id + ' cannot be held to "Ask first" when a conversation is resumed, so it was not started.'
      );
    const level = held
      ? 'ask'
      : opts.resumeId && !agent.accessOnResume
        ? 'default'
        : cleanAccess(opts.access);
    const access = level === 'default' ? [] : agent.accessArgs?.(level);
    if (!access) throw new Error(accessOf(agent).why[level] + ', so it was not started.');
    const args = [
      ...(rules.args || []),
      ...pick,
      ...access,
      ...(agent.startArgs ? agent.startArgs(opts) : []),
      ...(agent.customArgs ? agent.customArgs(opts) : []),
    ];

    // accessEnv (OpenCode only): a level that is config, not a flag, and a picked effort are added
    // to the session config the rules built.
    return {
      ...launchSpec(path, args),
      env: {
        ...accountEnv(agent, opts.accountDir),
        ...rules.env,
        ...(agent.accessEnv ? agent.accessEnv(level, rules.env, cleanPick(opts), opts) : {}),
      },
    };
  },
  // The environment variable a CLI's API key goes in ('' = none).
  apiKeyEnv: id => AGENTS.find(a => a.id === id)?.apiKey?.env || '',
  // { models: [{ id, label, efforts? }], efforts } for the composer dropdowns; empty when the CLI
  // has no pick support. `cwd` (the project folder) is used by OpenCode only, whose list depends on
  // the folder's own config.
  models(id, accountDir, cwd) {
    const agent = AGENTS.find(a => a.id === id);
    return agent?.models
      ? agent.models(accountDir, cwd).catch(() => ({ models: [], efforts: [] }))
      : Promise.resolve({ models: [], efforts: [] });
  },
  // The context size in tokens of a model in a CLI's list already read (OpenCode only today); 0 =
  // not known.
  contextWindow: (id, model) => (id === 'OpenCode' && model ? openCodeWindow(String(model)) : 0),
  // Checks only: OpenCode's effort switch as shipped (OPENCODE_EFFORT_ON), and a way to run a check
  // in the other state (no argument = back to shipped).
  openCodeEffort: {
    shipped: OPENCODE_EFFORT_ON,
    set(on) {
      openCodeEffortOn = on === undefined ? OPENCODE_EFFORT_ON : !!on;
    },
  },
};

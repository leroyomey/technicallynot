# Architecture

How the parts of Technically Not fit together, and which file to open for what. Every path below is a real file or folder in this repository. Most files start with a comment that says what the file is for; read that first.

## 1. What the app is

Technically Not is a desktop app (Electron) that runs AI coding agents in real terminal panels, side by side, in one project folder. It does not contain a model and does not talk to a model: it starts the agent programs you installed yourself and watches what they do. Around the terminals it adds the thread layout (a list of agents as threads, the open thread as a readable conversation, one prompt box) and a small `tnai` command the agents use to work together.

## 2. The processes

```
 +---------------------------+   window.tnaiNative    +---------------------------+
 | The window (one page)     | <--------------------> | The main process          |
 | index.html                |   desktop/preload.js   | desktop/main.js           |
 | src/scripts/NN-*.js       |   calls go in,         | desktop/*.js              |
 | src/styles/NN-*.css       |   events come back     | (Node: disk, processes)   |
 +---------------------------+                        +-------------+-------------+
                                                                    | node-pty
                                         +--------------------------+-------------+
                                         | One real terminal per panel            |
                                         | your own CLI (claude, codex, ...)      |
                                         | or a plain shell                       |
                                         +--------------------------+-------------+
                                                                    | 127.0.0.1 only
                                         hooks and the `tnai` command report back
                                         to the main process
```

**The main process** is `desktop/main.js` plus the other files in `desktop/`. It is plain Node inside Electron. It owns everything that touches the computer: terminals, agent programs, the disk, git, updates. One feature is one file (`desktop/pty-service.js`, `desktop/fs-service.js`, `desktop/updater.js`, and so on). `main.js` creates the window, sets its security options and registers the calls the window may make.

**The window** is one page, `index.html`. That file holds markup and an ordered list of `<link>` and `<script src>` tags, nothing else. The scripts in `src/scripts/` are classic scripts (no modules, no bundler, no build step). They load in the order of the number at the start of the name, so `01-app-core.js` runs before `10-live-terminals.js`. A script shares what others need by putting one object on `window` (for example `window.TnaiAgents`). Styles in `src/styles/` are numbered the same way; later files win. Copied-in libraries are in `src/vendor/`, fonts and pictures in `src/assets/`.

**The bridge** is `desktop/preload.js`. It puts one object, `window.tnaiNative`, into the page. Each function on it either sends a named call to the main process and returns the answer, or subscribes to events the main process pushes. In `desktop/main.js` the matching side is a `handle('name', ...)` line. The window has no other way to reach the computer.

The same page also opens in a plain browser. There `window.tnaiNative` is missing, so `src/scripts/148-browser-only.js` shows only a page that says the app runs on the desktop. The interface underneath still loads with everything that needs the desktop switched off (`src/scripts/00-desktop-bridge.js` and `src/scripts/12-inactive-ui.js` decide that), because the checks in `tools/browser-check/` drive it; at their `/__check` address the page is skipped.

Status is pushed, not polled: the main process watches files and processes and sends an event when something changes. Keep it that way when you add a feature.

## 3. How an agent runs

1. **A real terminal.** `desktop/pty-service.js` starts one process per terminal panel with `node-pty` (ConPTY on Windows). The window draws it with xterm.js in `src/scripts/10-live-terminals.js`. What runs in it is the CLI the person installed and signed in to themselves, or a shell.
2. **Which CLIs exist.** `desktop/agent-registry.js` lists the known agent CLIs: how to find each one, how to check its sign-in, and the arguments that start or resume a session.
3. **The command stand-ins.** `desktop/agent-mesh.js` writes small stand-in commands (`claude`, `codex`, `cursor-agent`, `opencode`, `tnai`) into a folder and puts that folder first on each panel's `PATH`. All of them run `desktop/agent-shim.js`. When a person types `claude` by hand, the stand-in tells the app, so the panel is listed as an agent, and then runs the real CLI. The `tnai` command (`tnai agents`, `tnai send`, `tnai lock`, ...) is the same script talking to a small server in `agent-mesh.js` on `127.0.0.1`. Each panel gets its own token; a request without a live token is refused.
4. **What runs the stand-ins.** They are Node scripts, so something must run them. `desktop/node-helper.js` decides: an installed build uses the plain Node runtime shipped next to the app (`tools/fetch-node-runtime.js` downloads it for the build); a run from source starts Electron's own executable "as Node".
5. **Rules for agents.** The app hands every agent a set of work rules through the CLI's own instruction setting, never by writing a file into your project. The rules are the Markdown files in `desktop/hidden-skills/`, read by `desktop/hidden-skills.js`.
6. **How status comes back.**
   - *Hooks.* For Claude Code, `desktop/agent-hooks.js` opens a local HTTP address per session and the CLI calls it on its own events: session ready, prompt sent, tool about to run, sub-agent started or stopped, permission asked. This is the truthful source; nothing is guessed from terminal text.
   - *Turns and tokens.* `desktop/agent-turns.js` reads when a task started and ended and its token use from the CLI's own session files (Claude Code and Codex). Other CLIs have no such source and get no turn.
   - *Needs you.* `desktop/attention-service.js` keeps the list of agents stuck on the person. A question seen only in a panel's output is inferred, and the code says so.
   - *The task graph.* `desktop/agent-graph.js` records which agent delegated what to which sub-agent, and decides whether a new task reuses an idle sub-agent or starts a new one. `src/scripts/43-agent-graph.js` and `src/scripts/11-agents-live.js` hold it in the window; `src/scripts/123-thread-helpers.js` shows a lead's sub-agents in its thread.
   - *The conversation.* `desktop/thread-log.js` turns a session's own record into a list of plain entries (a prompt, the agent's words, an action, its result) for the Readable view. There is one reader per CLI: `desktop/thread-log-claude.js`, `desktop/thread-log-codex.js`, `desktop/thread-log-opencode.js`, `desktop/thread-log-cursor.js` and `desktop/thread-log-copilot.js`; what they share is `desktop/thread-log-text.js`. Nothing is invented: an entry is something the CLI's record says. A CLI without a reader is shown as its terminal. Test: `tools/thread-log-test.js`.
   - *Finished work.* `desktop/agent-context.js` keeps a short summary of every finished task per project, which `tnai context` shows to the other agents.
7. **Agents sharing one folder.** `desktop/file-locks.js` lets one agent edit a file at a time. `desktop/git-guard.js` refuses agent commands that would throw away other agents' uncommitted work. `desktop/process-guard.js` makes sure no panel's processes outlive the panel or the app.

## 4. The window's layout

The app has one layout, the thread layout. It opens on the Threads page; every other page opens from the three-dots menu at the top right, in the same look.

- **The frame:** `src/scripts/118-thread-frame.js` builds the page and its three places (the list, the open thread, a side column) and offers them to the other files as `window.TnaiThreads`. Styles: `src/styles/27-thread-frame.css`.
- **The thread list:** `src/scripts/119-thread-list.js`, one row per live session. Styles: `src/styles/28-thread-list.css`.
- **The open thread:** `src/scripts/120-thread-view.js` (the top row, the terminal of the session, the switch between Readable and Terminal) and `src/scripts/122-thread-readable.js` (the conversation, drawn from the entries of `desktop/thread-log.js`). Styles: `src/styles/29-thread-view.css` and `src/styles/30-thread-readable.css`.
- **Questions in a thread:** `src/scripts/121-thread-asks.js` (a permission, a held prompt, a question of the agent) and `src/scripts/125-thread-limit.js` (a usage limit).
- **The menu and the looks:** `src/scripts/124-thread-menu.js`; the two looks, Dark and Light, on every page are `src/styles/31-thread-pages.css`.
- **The "All threads" page:** `src/scripts/135-all-threads.js` shows several threads side by side (`src/styles/38-all-threads.css`); `src/scripts/105-terminal-preview.js` owns the Live preview column beside them.
- **Show and hide for the side columns:** `src/scripts/127-thread-collapse.js`.

Some parts of an earlier layout are still loaded, unseen, because other scripts call them (the old navigation's markup, and the terminal panels the agents run in). Style sheets with `purple` in their name belong to that earlier look; the thread layout sets its own colors over them.

## 5. Security boundaries

A change that weakens one of these will not be merged. If you think one is in your way, open an issue first.

- **The window is sandboxed.** Every window is created with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true` (`desktop/main.js`, and the same in `desktop/panel-windows.js`, `desktop/file-viewer.js` and the other files that open a window). Page code never gets `require`, `fs` or `child_process`. A new power is a new named function in `desktop/preload.js` and a `handle` in `main.js` that checks its own arguments. Do not expose `ipcRenderer` itself, and do not add a call that runs a command or path the page hands in.
- **The page loads scripts only from the app.** `index.html` has a content security policy (`script-src 'self'`, frames only from localhost). Because the page is opened from disk, "self" would mean every file on the disk, so `desktop/script-guard.js` adds a second barrier in the main process: a script, frame or plug-in over `file:` loads only from the app's own code folders. Agents write files into the project all day; none of them may ever run inside the window. Test: `tools/script-guard-test.js`.
- **Navigation and pop-ups are closed.** The window cannot be navigated away from its page, and new windows are denied except the app's own pop-outs. Web links open in the system browser. Browser permissions are denied for every page but the app's own (`desktop/main.js`).
- **File access stays in the project folder.** `desktop/fs-service.js` resolves every path the window asks for against the open project folder (or one of the app's own worktrees of it) and refuses anything outside, also when a link or junction inside the project points outside. A folder becomes a project only through the system's folder picker, or as a new folder the app makes from a name in one fixed place; the window never hands in a path. Use `inside()` there for any new file call; never join a path yourself.
- **"Run as Node" is off in a build.** `package.json` (`build.electronFuses`) turns off the switch that lets the app's executable be started as a plain Node, the Node options variable and the inspector arguments, and makes the app load only its own integrity-checked archive. That is why the stand-ins use the shipped runtime (`desktop/node-helper.js`). `tools/packaged-node.js` reads these settings out of a finished build. A run from source does not have them.
- **A release build ignores developer switches.** `desktop/build-info.js` decides what a release build is; in one, every `TNAI_*` test override is ignored and DevTools stay closed.
- **Sign-ins belong to the CLIs.** The app never stores an agent CLI's sign-in token. It reads one in one place: `desktop/plan-limits.js` reads Claude Code's own sign-in from `~/.claude/.credentials.json` to ask `api.anthropic.com` for your usage limits, sends it nowhere else and never keeps it. Extra accounts are separate config folders that the CLI writes into itself (`desktop/account-service.js`). The one exception is a provider API key a person types in for an API-key account: `desktop/api-keys.js` keeps it encrypted by the operating system, hands it only to that account's agent process as an environment variable, and gives the window only its last four characters. Never log a key and never send one to the window.
- **Everything local listens on `127.0.0.1` only**, and every such address needs a token or a secret path (`desktop/agent-mesh.js`, `desktop/agent-hooks.js`).

How to report a security problem is in `SECURITY.md`.

## 6. Several computers

Two of your computers can see each other's agents. Nothing is hosted for you: they meet through a relay that you deploy yourself.

- **The relay** is the folder `relay/`, a small Cloudflare Worker (`relay/src/index.js`) with one meeting point (`relay/src/hub.js`). A device proves it holds the relay's secret with a keyed hash, never by sending the secret. Setup, limits and the proof are described in `relay/README.md`.
- **What the relay can see:** which device ids connect, when each was last seen, and how much is sent when. **What it cannot see:** any message. Messages are sealed between two paired computers with keys made at pairing, and those keys never leave the computers. The relay stores no message.
- **Pairing and sealing** on the computer: `desktop/remote-keys.js` (pairing with six-digit codes, the encrypted key store), `desktop/remote-noise.js` (the cryptography, proven against a published test vector by `tools/remote-noise-test.js`), `desktop/remote-link.js` (the connection to the relay), `desktop/remote-trust.js` (forgetting a computer, stopping everywhere).
- **What one computer may send another** is a fixed list in `desktop/remote-api.js`. The receiver treats every field as untrusted text. `desktop/remote-service.js` joins these parts for the Devices page (`src/scripts/111-devices-page.js`). `desktop/own-relay.js` keeps the relay's address and secret; `desktop/own-relay-wiring.js` connects it to the service.
- **Off by default.** Until a relay is set, no key is made and no connection is opened.
- **The phone app** is `phone/`: a web page (`phone/app/`) with its logic in `phone/src/`, and the computer's side in the `desktop/phone-*.js` files. It is a work in progress. Its parts are tested against each other in plain Node (`tools/phone-pair-test.mjs` and the other `tools/phone-*-test.mjs`), but the app itself loads only `desktop/phone-answer.js` today.

The user's guide is `docs/devices.md`.

## 7. Where state is kept

**The settings folder.** On Windows this is `AppData\Roaming\TechnicallyNot.ai`. A run from source uses `TechnicallyNot.ai (dev)` beside it, so trying a change never touches an installed copy (`desktop/main.js`, near the top). In it, among others:

- `sessions.json` and the folder `scrollback`: each panel's session and its terminal output, so a panel can be restored (`desktop/session-store.js`)
- `project-folder.json`: the project folders that were opened (`desktop/fs-service.js`)
- `agent-graph.json` and the folders `agent-context` and `agent-tasks`: the task graph, finished work and the shared to-do board, per project
- `accounts.json` and the folder `agent-accounts`: extra accounts of the agent CLIs
- `api-keys.bin`, `tnai-own-relay.bin`, `tnai-remote.bin`: encrypted by the operating system
- the folder `agent-shims`: the command stand-ins
- the folder `worktrees`: git worktrees the app makes for agents (`desktop/worktree-service.js`)
- the folder `voice`: the downloaded speech engine and models

**The window's own storage.** Layout and preferences (theme, panel layout, agent names) are in the page's `localStorage` under keys that start with `tnai.`, each with a version, like `tnai.theme.v1`.

**The project folder.** The app writes there only what you ask for: custom agents saved for the project live in `.tnai/agents.json`. Everything else in the project is written by the agents and by you.

**The agent CLIs' own folders** (for example `.claude` in your home folder) belong to the CLIs. The app reads session files there to show turns and tokens.

## 8. Run, test, format

```
npm install
npm start
```

`npm start` runs the app from source with its own settings folder. `npm run dist` builds the Windows installer.

Tests, cheapest first:

- `node tools/check-syntax.js` parses every script in `src/scripts/` and `desktop/` and checks that `index.html` lists each window script.
- `tools/*-test.js` and `tools/*-test.mjs` are plain Node tests with no window. Run one with `node`. The relay's are `relay/test/run.mjs` (`npm test` inside `relay/`).
- `tools/desktop-check/` holds the window tests. `node tools/desktop-check/check.js <name>` starts the real app with an empty, separate profile and runs `tools/desktop-check/tests/<name>.js` inside the window. A file `<name>.main.js` beside a test is loaded in the main process for that run. Run them one at a time. The files named `tools/desktop-check/*-check.js` are plain Node checks of single main-process files.
- `tools/browser-check/` has the checks that load the page in a headless browser.

Format: the rules are in `docs/CODE_STYLE.md`. After editing a code file run `node tools/format-code.js <file>`; it formats the file and proves the program did not change. `npm run format:check` must report nothing to change.

`.github/workflows/test.yml` runs the syntax check, the format check and the plain Node tests on every pull request.

## 9. I want to change X, open Y

- **Add an agent CLI, or change how one is started:** `desktop/agent-registry.js`.
- **Add or change a `tnai` command:** the server side in `desktop/agent-mesh.js`, the command itself in `desktop/agent-shim.js`. Describe it for agents in `desktop/hidden-skills/20-tnai-commands.md`.
- **Change the rules agents are given:** the Markdown files in `desktop/hidden-skills/` (its `README.md` explains the format).
- **Change how a terminal panel behaves:** `desktop/pty-service.js` (the process), `src/scripts/10-live-terminals.js` (the live terminal), `src/scripts/04-terminal-panes.js` and `src/scripts/21-terminal-page.js` (the panels underneath), `src/scripts/120-thread-view.js` (a thread's CLI screen), `src/scripts/136-own-terminal.js` (Your terminal).
- **Change a row of the thread list:** `src/scripts/119-thread-list.js`.
- **Change how a thread reads:** `src/scripts/122-thread-readable.js` for how an entry is drawn, the reader of that CLI in `desktop/` (`desktop/thread-log-<name>.js`) for what an entry says.
- **Make another CLI's thread readable:** a new reader file beside the others, its line in the list of readers in `desktop/thread-log.js`, its name in `src/scripts/122-thread-readable.js`, and its checks in `tools/thread-log-test.js`.
- **Add a row to the three-dots menu:** `src/scripts/124-thread-menu.js`.
- **Change what the app knows about a live agent (its state, its task):** `src/scripts/11-agents-live.js`.
- **Change what counts as "needs you":** `desktop/attention-service.js`, shown by `src/scripts/71-needs-you.js`.
- **Let the window ask the main process for something new:** a function in `desktop/preload.js`, a `handle` in `desktop/main.js`, and the work itself in its own file in `desktop/`.
- **Read or write project files differently:** `desktop/fs-service.js`; the viewer window is `desktop/file-viewer.js`.
- **Add a setting:** `src/scripts/22-settings-page.js`, styles in `src/styles/06-settings.css`.
- **Switch on a control that is grayed out:** remove its selector in `src/scripts/12-inactive-ui.js`, once the feature behind it works.
- **Change Live preview:** `src/scripts/31-live-preview.js` and `src/scripts/65-live-preview-page.js`.
- **Change the update check:** `desktop/updater.js`.
- **Change voice prompts:** `desktop/voice-service.js` and `src/scripts/70-voice-prompt.js`.
- **Change the several-computers feature:** start at `desktop/remote-service.js`; the relay is `relay/src/`.
- **Change a colour or a spacing:** the tokens (`--pg-*`) are named in `src/styles/07-purple-glass.css` and get their values for Dark and for Light in `src/styles/31-thread-pages.css`; the accents are `src/styles/04-accents.css`. The look and layout are the owner's; see `CONTRIBUTING.md` before you start.
- **Add a window script:** name it with the next free number, add its `<script src>` to `index.html` in number order, and run `node tools/check-syntax.js`.

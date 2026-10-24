// Technically Not desktop · preload.js — Exposes window.tnaiNative, the only bridge between the UI
// and the desktop process.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Many scripts of the page each listen once to the same push (twelve to `agent:turn`), which is
// what the app is built on. Node warns of a leak at eleven listeners on one channel; the limit is
// raised so that warning means a real leak again.
ipcRenderer.setMaxListeners(40);

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const listen = channel => callback => {
  // One listener's error must not stop the others (ipcRenderer is an EventEmitter: a throw ends
  // that emit), e.g. 19/25 throwing would silence 53's feed.
  const handler = (_event, payload) => {
    try {
      callback(payload);
    } catch (err) {
      console.error('[tnai] ' + channel + ' listener failed:', err);
    }
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('tnaiNative', {
  info: () => invoke('tnai:info'),
  openNotices: () => invoke('tnai:openNotices'),
  // Windows build number (e.g. 26200) for xterm's windowsPty option (10 createTerm): ConPTY adds
  // rows at the bottom on a resize.
  windowsBuild:
    process.platform === 'win32'
      ? Number(String(process.getSystemVersion?.() || '').split('.')[2]) || 0
      : 0,
  prompt: (message, value) =>
    ipcRenderer.sendSync('tnai:prompt', String(message ?? ''), String(value ?? '')),
  agents: {
    detect: () => invoke('agents:detect'),
    install: () => invoke('agents:install'),
    models: (id, accountId) => invoke('agents:models', id, accountId),
    access: () => invoke('agents:access'),
    effortState: paneId => invoke('agents:effortState', paneId),
    interrupt: paneId => invoke('agents:interrupt', String(paneId || '')),
  },
  accounts: {
    list: options => invoke('accounts:list', options),
    add: (agentId, label) => invoke('accounts:add', agentId, label),
    remove: (agentId, accountId) => invoke('accounts:remove', agentId, accountId),
    setActive: (agentId, accountId) => invoke('accounts:setActive', agentId, accountId),
    rename: (agentId, accountId, label) => invoke('accounts:rename', agentId, accountId, label),
    addKey: (agentId, label, key) => invoke('accounts:addKey', agentId, label, key),
    setKey: (agentId, accountId, key) => invoke('accounts:setKey', agentId, accountId, key),
    dirFor: (agentId, accountId) => invoke('accounts:dirFor', agentId, accountId),
  },
  agentRules: {
    get: () => invoke('agentRules:get'),
    set: patch => invoke('agentRules:set', patch || {}),
  },
  // The "/" and "$" list above the prompt box: one CLI's commands and skills (cli-commands.js).
  cliCommands: {
    list: cli => invoke('cliCommands:list', String(cli || '')),
  },
  skills: {
    list: () => invoke('skills:list'),
    import: input => invoke('skills:import', input),
    pickFolder: () => invoke('skills:pickFolder'),
    read: id => invoke('skills:read', String(id || '')),
    open: (id, reveal) => invoke('skills:open', String(id || ''), reveal === true),
    remove: id => invoke('skills:remove', id),
    everywhere: (id, on) => invoke('skills:everywhere', id, on),
    validate: agentId => invoke('skills:validate', agentId),
    createAgent: data => invoke('skills:agents:create', data),
    renameAgent: (id, name) => invoke('skills:agents:rename', id, name),
    updateAgent: (id, fields) => invoke('skills:agents:update', id, fields),
    removeAgent: id => invoke('skills:agents:remove', id),
    copyAgent: (id, scope, name) => invoke('skills:agents:copy', id, scope, name),
    attach: (id, skillIds) => invoke('skills:attach', id, skillIds),
    detach: (id, skillIds) => invoke('skills:detach', id, skillIds),
    // an agent saved a skill (`tnai skill save`): { id, name, replaced }
    onSaved: listen('skills:saved'),
  },
  // Window frame (66): the app's own minimize / maximize / close buttons ('state' → {maximized} in
  // the main window, null elsewhere).
  frame: {
    control: action => invoke('window:control', String(action ?? '')),
    onMaximized: listen('window:maximized'),
  },
  panels: {
    setOnTop: (name, on) => invoke('panel:onTop', String(name ?? ''), !!on),
    // a pop-out's own window buttons (66)
    control: (name, action) => invoke('panel:control', String(name ?? ''), String(action ?? '')),
    fit: (name, width, height, exact) =>
      invoke('panel:fit', String(name ?? ''), Number(width), Number(height), !!exact),
    size: (name, width, height) =>
      invoke('panel:size', String(name ?? ''), Number(width), Number(height)),
  },
  // Live preview (31): device emulation (user agent + touch) for one preview iframe by its name
  // (preview-emulation.js).
  preview: {
    emulate: (frameName, preset) =>
      invoke('preview:emulate', String(frameName ?? ''), String(preset ?? '')),
    forget: frameName => invoke('preview:forget', String(frameName ?? '')),
    // Whether that frame's page reloads itself on file changes (hot reload): true, false, or null =
    // unknown.
    hot: frameName => invoke('preview:hot', String(frameName ?? '')),
    // Back / forward inside that frame, or 'where' = its current address (string, or null when
    // unknown).
    nav: (frameName, action) =>
      invoke('preview:nav', String(frameName ?? ''), String(action ?? '')),
    // An agent's `tnai preview URL [device]` (agent-mesh.js): { id, url, device, project, by };
    // answered with shown(id, { ok, error?, where? }). Pick an element in that frame (on = true) or
    // stop (false) → { ok }; the choice arrives through onPicked { name, cancelled, selector, tag,
    // id, classes, text, html, rect }.
    pick: (frameName, on) => invoke('preview:pick', String(frameName ?? ''), on === true),
    onPicked: listen('preview:picked'),
    // The previewed page's errors { name, kind: exception | console | network | log, text, url,
    // line }, and a new document in a preview frame { name } (clear the list).
    onError: listen('preview:error'),
    onLoaded: listen('preview:loaded'),
    onShow: listen('preview:show'),
    shown: (id, result) =>
      invoke(
        'preview:shown',
        String(id ?? ''),
        result && typeof result === 'object'
          ? {
              ok: result.ok === true,
              error: String(result.error || ''),
              where: String(result.where || ''),
              ...(result.shot && typeof result.shot === 'object'
                ? {
                    shot: {
                      url: String(result.shot.url || ''),
                      device: String(result.shot.device || ''),
                      w: Number(result.shot.w) || 0,
                      h: Number(result.shot.h) || 0,
                      preset: String(result.shot.preset || ''),
                      label: String(result.shot.label || ''),
                    },
                  }
                : {}),
            }
          : null
      ),
  },
  // Custom agents' task graph (agent-graph.js): state + keep a sub-agent + limits; the window
  // opens/closes sub-agent panes on request.
  graph: {
    state: () => invoke('graph:state'),
    keep: (nodeId, on) => invoke('graph:keep', String(nodeId ?? ''), !!on),
    settings: patch => invoke('graph:settings', patch || {}),
    removed: paneId => invoke('graph:removed', String(paneId ?? '')),
    spawnFailed: (nodeId, reason) =>
      invoke('graph:spawnFailed', String(nodeId ?? ''), String(reason ?? '')),
    onState: listen('graph:state'),
    onSpawn: listen('graph:spawn'),
    onClose: listen('graph:close'),
  },
  // Agent lifecycle + task provenance (agent-lifecycle.js): which agent's result a prompt quotes,
  // Technically Not's routing note, reviving a closed agent's conversation. Shared project context
  // (agent-context.js): finished agent tasks as summaries (read and mark).
  context: {
    state: () => invoke('context:state'),
    mark: (key, state) => invoke('context:mark', String(key ?? ''), state ? String(state) : ''),
    onChange: listen('context:changed'),
  },
  lifecycle: {
    state: () => invoke('lifecycle:state'),
    origin: text => invoke('lifecycle:origin', String(text ?? '')),
    note: (paneId, info) => invoke('lifecycle:note', String(paneId ?? ''), info || {}),
    revive: instanceId => invoke('lifecycle:revive', String(instanceId ?? '')),
    revived: (requestId, result) =>
      invoke('lifecycle:revived', String(requestId ?? ''), result || {}),
    retire: (paneId, toPaneId) =>
      invoke('lifecycle:retire', String(paneId ?? ''), String(toPaneId ?? '')),
    onState: listen('lifecycle:state'),
    onRevive: listen('lifecycle:revive'),
    onClose: listen('lifecycle:close'),
    onRename: listen('lifecycle:rename'),
  },
  // Past conversations of the open project (desktop/thread-list.js): the list, and one row of it
  // looked at. Read only when asked.
  threads: {
    list: () => invoke('threads:list'),
    peek: key => invoke('threads:peek', String(key ?? '')),
  },
  update: {
    state: () => invoke('update:state'),
    check: () => invoke('update:check'),
    download: () => invoke('update:download'),
    install: () => invoke('update:install'),
    setPrefs: patch => invoke('update:prefs', patch || {}),
    openNotes: () => invoke('update:openNotes'),
    onState: listen('update:state'),
  },
  // Newer versions of the installed agent CLIs (cli-updates.js): { checkedAt, updates: [{ id,
  // installed, latest, command }] }.
  cliUpdates: {
    state: () => invoke('cli-updates:state'),
    check: () => invoke('cli-updates:check'), // checks again now (after an update ran)
    onState: listen('cli-updates:state'),
  },
  fs: {
    root: () => invoke('fs:root'),
    pick: () => invoke('fs:pick'),
    create: name => invoke('fs:create', String(name ?? '')),
    reveal: target => invoke('fs:reveal', String(target ?? '')),
    forget: () => invoke('fs:forget'),
    // Open projects: projects() → { active, projects: [{ path, name, active, missing }] };
    // switchTo/remove only accept listed paths.
    projects: () => invoke('fs:projects'),
    switchTo: target => invoke('fs:switch', String(target || '')),
    remove: target => invoke('fs:remove', String(target || '')),
    list: (rel, lane) => invoke('fs:list', rel, lane ? String(lane) : ''),
    stat: (rel, lane) => invoke('fs:stat', rel, lane ? String(lane) : ''),
    read: (rel, start, end, lane) => invoke('fs:read', rel, start, end, lane ? String(lane) : ''),
    write: (rel, bytes, lane) => invoke('fs:write', rel, bytes, lane ? String(lane) : ''),
    search: (query, limit, opts) => invoke('fs:search', query, limit, opts),
    popout: (rel, asText, lane) => invoke('fs:popout', rel, asText, lane ? String(lane) : ''),
    openOnPc: (rel, lane) => invoke('fs:openOnPc', rel, lane ? String(lane) : ''),
    // lane: a Technically Not worktree's folder (from lanes()) instead of the project folder;
    // fs-service refuses any other folder.
    lanes: () => invoke('fs:lanes'),
    onChanges: listen('fs:changes'),
  },
  pty: {
    start: options => invoke('pty:start', options),
    // keep a PowerShell ready for the next PowerShell panel (main.js pty:warm)
    warm: options => invoke('pty:warm', options),
    stop: paneId => invoke('pty:stop', paneId),
    list: () => invoke('pty:list'),
    replay: paneId => invoke('pty:replay', paneId),

    // "Your terminal" (136): the shells found on this computer, and the one its panel starts next
    shells: () => invoke('pty:shells'),
    shellFor: (paneId, shellId) => invoke('pty:shellFor', paneId, shellId),
    // save a view's screen, sizes and pty output to userData\captures (main.js,
    // terminal-capture.js)
    capture: info => invoke('terminal:capture', info),
    write: (paneId, data) => ipcRenderer.send('pty:write', paneId, data),
    submit: (paneId, text, opts) => invoke('pty:submit', paneId, text, opts),
    resize: (paneId, cols, rows) => ipcRenderer.send('pty:resize', paneId, cols, rows),
    // Main sends every pane's output of one ~16 ms batch as one message ([{ paneId, data }],
    // pty-service.js emit); subscribers still get one call per pane. A subscriber that throws is
    // reported without keeping the other panes' output from it.
    onData: callback =>
      listen('pty:data')(batch => {
        for (const item of Array.isArray(batch) ? batch : [batch])
          try {
            callback(item);
          } catch (error) {
            queueMicrotask(() => {
              throw error;
            });
          }
      }),
    onExit: listen('pty:exit'),
    forget: paneId => invoke('pty:forget', paneId),
    onSession: listen('pty:session'),
  },
  // Live events from Claude Code's own hooks (agent-hooks.js): prompts, tool calls, sub-agents, the
  // lead's plan. Composer attachments: save(name, bytes) → {ok, value: absolute path} in
  // Technically Not's own attachments folder. Git for the connected project folder
  // (git-service.js); onChanged fires when .git HEAD/index/refs change.
  git: {
    status: () => invoke('git:status'),

    // What the agent in that folder changed: branch, lines, commits, its pull request and checks
    // (branch-changes.js); {ok, value} with value.repo false outside a git repository.
    changes: folder => invoke('git:changes', String(folder || '')),
    worktrees: () => invoke('git:worktrees'),
    worktreeMerge: branch => invoke('git:worktreeMerge', String(branch)),
    worktreeRemove: (branch, options) =>
      invoke('git:worktreeRemove', String(branch), {
        discard: options?.discard === true,
        deleteBranch: typeof options?.deleteBranch === 'boolean' ? options.deleteBranch : undefined,
      }),
    worktreePanes: () => invoke('git:worktreePanes'),
    worktreeFree: agent => invoke('git:worktreeFree', String(agent || '')),
    worktreeRelease: paneId => invoke('git:worktreeRelease', String(paneId)),
    onChanged: listen('git:changed'),
  },

  // Watch and merge a thread's pull request (pr-watch.js): GitHub is asked every 3 minutes while
  // watched; onEvent gets { paneId, number, url, line, message, done }, onChanged the watched list.
  prWatch: {
    list: () => invoke('prwatch:list'),
    watch: (paneId, number) => invoke('prwatch:watch', String(paneId || ''), Number(number) || 0),
    unwatch: paneId => invoke('prwatch:unwatch', String(paneId || '')),
    merge: (paneId, number) => invoke('prwatch:merge', String(paneId || ''), Number(number) || 0),
    onEvent: listen('prwatch:event'),
    onChanged: listen('prwatch:changed'),
  },

  // "Open in VS Code / Cursor / File Explorer" for a thread's own folder (open-in-editor.js).
  editors: {
    list: () => invoke('editors:list'),
    open: (id, paneId) => invoke('editors:open', String(id || ''), String(paneId || '')),
  },
  attachments: {
    save: (name, bytes) => invoke('attachments:save', name, bytes),
    dir: () => invoke('attachments:dir'),
    pasted: text => invoke('attachments:pasted', String(text || '')),
    clip: text => invoke('attachments:clip', String(text || '')),
    play: text => invoke('attachments:play', String(text || '')),
  },
  // The Technically Not account (user-auth.js). Only public state crosses: { available, google,
  // signedIn, user: {name, email, providers}, plan, checking, problem, flow }.
  auth: {
    state: () => invoke('auth:state'),
    signIn: (provider, browser) => invoke('auth:signIn', String(provider), String(browser ?? '')),
    browsers: () => invoke('auth:browsers'),
    copyLink: () => invoke('auth:copyLink'),
    signInEmail: input =>
      invoke('auth:signInEmail', {
        email: String(input?.email ?? ''),
        password: String(input?.password ?? ''),
        totp: String(input?.totp ?? ''),
      }),
    cancel: () => invoke('auth:cancel'),
    replaceDevice: deviceId => invoke('auth:replaceDevice', String(deviceId ?? '')),
    verifyCode: code => invoke('auth:verifyCode', String(code ?? '')),
    signOut: () => invoke('auth:signOut'),
    check: () => invoke('auth:check'),
    open: which => invoke('auth:open', String(which)),
    onChange: listen('auth:changed'),
    onNotice: listen('auth:notice'),
  },
  // The thread layout's Readable view (thread-log.js): the entries of one panel's conversation
  // added since byte `from` (-1 = a first read) → { readable, found, entries, next, cut, reset }.
  threadLog: {
    read: (paneId, from, sub) =>
      invoke('threadLog:read', String(paneId ?? ''), Number(from), sub ? String(sub) : ''),

    // a conversation that was read has grown: { paneId, sub }
    onChange: listen('threadLog:changed'),
  },

  // A Claude Code workflow's helpers, for its card (workflow-runs.js, 171): read(paneId, runId) →
  // { ok, helpers: [{ id, label, phase, state, startedAt, endedAt }] }; watch / unwatch a run;
  // onChange gets { paneId, runId } when its journal changed.
  workflows: {
    read: (paneId, runId) => invoke('workflow:read', String(paneId ?? ''), String(runId ?? '')),
    watch: (paneId, runId) => invoke('workflow:watch', String(paneId ?? ''), String(runId ?? '')),
    unwatch: (paneId, runId) =>
      invoke('workflow:unwatch', String(paneId ?? ''), String(runId ?? '')),
    onChange: listen('workflow:changed'),
  },

  // A page or picture the agent wrote or showed, as a card in the conversation (thread-designs.js).
  // page → { ok, name, url, refs, image } (a still picture of the page); picture → { ok, name,
  // image } (small, or whole with large); preview opens the page in Live preview.
  designs: {
    page: (paneId, file, options) =>
      invoke('designs:page', String(paneId ?? ''), String(file ?? ''), {
        shot: options?.shot !== false,
      }),
    picture: (paneId, file, options) =>
      invoke('designs:picture', String(paneId ?? ''), String(file ?? ''), {
        since: Number(options?.since) || 0,
        large: options?.large === true,
        wide: options?.wide === true,
        check: options?.check === true,
      }),
    preview: (paneId, file) => invoke('designs:preview', String(paneId ?? ''), String(file ?? '')),
  },

  // What an agent made in a task (what-it-made.js, 170): check(paneId, file, since) → { ok, name,
  // size }; text(paneId, file) → { ok, name, text, cut } for a document or data file; alive(url) →
  // true when a local address answers.
  made: {
    check: (paneId, file, since) =>
      invoke('made:check', String(paneId ?? ''), String(file ?? ''), Number(since) || 0),
    text: (paneId, file) => invoke('made:text', String(paneId ?? ''), String(file ?? '')),
    alive: url => invoke('made:alive', String(url ?? '')),
  },

  // File locks of the open project (file-locks.js), read-only: list() → [{ file, paneId, name, at,
  // last }]; onChange fires when a file is taken or let go.
  locks: {
    list: () => invoke('locks:list'),
    onChange: listen('locks:changed'),
  },
  agentEvents: {
    on: listen('agent:event'),
    history: () => invoke('agentEvents:history'),
    bgTail: taskId => invoke('agentEvents:bgTail', String(taskId ?? '')),
    endpoint: paneId => invoke('agentEvents:endpoint', paneId),
  },
  // Team mode (agent-teams.js): user-set teams of agents that share file locks. state() → { teams:
  // [{ id, panes }] }; set(paneId, mates) (mates [] = leave).
  teams: {
    state: () => invoke('teams:state'),
    set: (paneId, mates) => invoke('teams:set', paneId, mates),
    on: listen('teams:changed'),
  },
  // Handoff history (handoff-history.js): state() → { handoffs: [...] } newest first; put(entry)
  // adds or updates by id; results(entryId) → { id, text } | null.
  handoffs: {
    state: () => invoke('handoffs:state'),
    put: entry => invoke('handoffs:put', entry),
    update: (id, patch) => invoke('handoffs:update', String(id ?? ''), patch || {}),
    results: id => invoke('handoffs:results', String(id ?? '')),
    onChange: listen('handoffs:changed'),
  },
  // Stuck-loop check (agent-loops.js): { id, paneId, agentId, on, since, repeats, period, tools,
  // browser, failed } when a Claude Code agent repeats the same call with the same result.
  agentLoops: {
    on: listen('agent:loop'),
    list: () => invoke('agentLoops:list'),
  },
  // Claude Code tool-permission prompts (agent-hooks.js askPermission): decision 'once' | 'session'
  // | 'deny' | 'terminal'.
  permissions: {
    on: listen('agent:permission'),
    pending: () => invoke('permission:pending'),
    answer: (id, decision) => invoke('permission:answer', String(id), String(decision)),
  },
  // Folder trust asked inside the agent's own panel (main.js askInPane, 74-trust-ask.js).
  trust: {
    onAsk: listen('trust:ask'),
    onDone: listen('trust:done'),
    pending: () => invoke('trust:pending'),
    answer: (id, yes) => invoke('trust:answer', String(id), yes === true),
  },
  // "Needs you" (attention-service.js): per-pane items (permission, menu [inferred], unsent, trust)
  // and composer prompts held while a pane is on a question.
  attention: {
    list: () => invoke('attention:list'),
    on: listen('attention:change'),
    onDelivered: listen('attention:delivered'),
    onJump: listen('attention:jump'),
    cancelHeld: heldId => invoke('attention:cancelHeld', String(heldId)),
    sendHeldNow: heldId => invoke('attention:sendHeldNow', String(heldId)),
    inputEmpty: paneId => invoke('attention:inputEmpty', String(paneId)),

    // the count on the taskbar icon (174): a PNG data address with the number, or '' for none
    badge: (picture, count) =>
      invoke('attention:badge', String(picture || ''), Math.max(0, Number(count) || 0)),
    notify: ({ paneId, title, body } = {}) =>
      invoke('attention:notify', {
        paneId: paneId == null ? null : String(paneId),
        title: String(title ?? ''),
        body: String(body ?? ''),
      }),
  },
  // Several computers (remote-service.js): the Devices page's state and actions. Each call answers
  // { ok, value } or { ok: false, error: { code } }; the state is plain data (this computer, paired
  // computers with what their agents wait for, pairing in progress, activity). No key is in it, and
  // no code except the six digits this computer shows while pairing.
  remote: {
    state: () => invoke('remote:state'),
    refresh: () => invoke('remote:refresh'),
    on: listen('remote:change'),
    setAwake: on => invoke('remote:setAwake', on === true),
    connectAgain: () => invoke('remote:connectAgain'),

    // "Use my own relay" (own-relay.js): get → { available, set, url }, never the secret
    ownRelay: () => invoke('remote:ownRelay'),
    // `confirm` is true only after the user agreed that pairings are removed (the calls answer
    // { ok: false, error: 'would_remove', count } first)
    setOwnRelay: (url, secret, confirm) =>
      invoke('remote:setOwnRelay', String(url), String(secret), confirm === true),
    clearOwnRelay: confirm => invoke('remote:clearOwnRelay', confirm === true),
    // an unpaired computer on the own relay, removed from its list → { ok, state } or { ok: false,
    // error }
    forgetRelayDevice: id => invoke('remote:forgetRelayDevice', String(id)),
    woke: () => invoke('remote:woke'),
    setOn: on => invoke('remote:setOn', on === true),
    setName: name => invoke('remote:setName', String(name ?? '')),
    pair: id => invoke('remote:pair', String(id)),
    pairAny: () => invoke('remote:pairAny'),
    cancelPairing: () => invoke('remote:cancelPairing'),
    acceptPairing: () => invoke('remote:acceptPairing'),
    declinePairing: () => invoke('remote:declinePairing'),
    enterCode: code => invoke('remote:enterCode', String(code ?? '')),
    // "Add a phone" (167-add-phone.js)
    phonePair: () => invoke('remote:phonePair'),
    phoneEnter: code => invoke('remote:phoneEnter', String(code ?? '')),
    phoneCancel: () => invoke('remote:phoneCancel'),
    clearEnded: () => invoke('remote:clearEnded'),
    setDetail: (id, on) => invoke('remote:setDetail', String(id), on === true),
    // another computer's agent's conversation: "Keep on", an ask, and what is held of it
    keepLogs: id => invoke('remote:keepLogs', String(id)),
    askLog: (computerId, agentId, which) =>
      invoke('remote:askLog', String(computerId), String(agentId ?? ''), String(which ?? '')),
    log: (computerId, agentId) => invoke('remote:log', String(computerId), String(agentId ?? '')),
    // Another computer's project files and its Live preview as a picture (items 42 and 43): an
    // ask (op 'list' | 'read' | 'save'), what is held of the answers, and two events: onFiles
    // ({ peer, preview? }: read again) and onLanded ({ kind, by, path }: another computer saved a
    // file here).
    askFiles: (computerId, op, path, text) =>
      invoke(
        'remote:askFiles',
        String(computerId),
        String(op ?? ''),
        String(path ?? ''),
        typeof text === 'string' ? text : null
      ),
    files: computerId => invoke('remote:files', String(computerId)),
    askPreview: computerId => invoke('remote:askPreview', String(computerId)),
    preview: computerId => invoke('remote:preview', String(computerId)),
    onFiles: listen('remote:files'),
    onLanded: listen('remote:landed'),
    // this week's thread features for another computer's thread: an ask ('changes', 'skills',
    // 'clis') and what is held of its answer (remote-features.js)
    askFeature: (computerId, kind, agentId) =>
      invoke('remote:askFeature', String(computerId), String(kind), String(agentId ?? '')),
    feature: (computerId, kind, agentId) =>
      invoke('remote:feature', String(computerId), String(kind), String(agentId ?? '')),
    forget: id => invoke('remote:forget', String(id)),
    setAnswer: (id, on) => invoke('remote:setAnswer', String(id), on === true),
    answer: (computerId, itemId, say, of) =>
      invoke('remote:answer', String(computerId), String(itemId), String(say), String(of ?? '')),
    choose: (id, choice) => invoke('remote:choose', String(id), String(choice)),
    stopEverywhere: () => invoke('remote:stopEverywhere'),
    finishAnyway: () => invoke('remote:finishAnyway'),
    dismiss: r => invoke('remote:dismiss', String(r ?? '')),
    // Full control: the one switch on this computer, and what
    // this computer asks of another one's agents. prompt, act and start answer the state with
    // `sent` (asked · not_sent · no_word · too_long · no_project) and `n`; how each ended then
    // shows in that computer's `ops`. room: bytes left in one message for that text (below 0: it
    // does not fit).
    setControl: (id, on, more) =>
      invoke(
        'remote:setControl',
        String(id),
        on === true,
        // 'choose say sync': the question also showed the git hand-over's sentence
        //
        // 'choose say': the question also showed the sentence about agents messaging agents
        //
        // 'choose': the question that was confirmed named picking an option
        //
        // 'choose say sync type': it also showed the sentence about typing (remote-type.js)
        //
        more === 'choose' ||
          more === 'choose say' ||
          more === 'choose say sync' ||
          more === 'choose say sync type'
          ? more
          : ''
      ),
    // mark: the agent row's `mark` as the page drew it. The main process sends nothing, and answers
    // `sent: 'changed'`, when the agent under that row is no longer that one.
    prompt: (computerId, agentId, text, mark) =>
      invoke(
        'remote:prompt',
        String(computerId),
        String(agentId),
        String(text ?? ''),
        String(mark ?? '')
      ),
    act: (computerId, agentId, what, mark) =>
      invoke('remote:act', String(computerId), String(agentId), String(what), String(mark ?? '')),
    // "Choose option N" of a question an agent on that computer asks: the
    // item's id, the number, the item's binding.
    pick: (computerId, itemId, n, kof) =>
      invoke('remote:pick', String(computerId), String(itemId), Number(n), String(kof ?? '')),
    start: (computerId, cli, text) =>
      invoke('remote:start', String(computerId), String(cli), String(text ?? '')),
    // The git hand-over. bring: this computer fetches that
    // computer's commit into its own branch for it. handOver: ask that computer to fetch this
    // computer's commit into its branch. Neither takes anything but the computer's id.
    bring: computerId => invoke('remote:bring', String(computerId)),
    handOver: computerId => invoke('remote:handOver', String(computerId)),
    room: (agentId, text) => invoke('remote:room', String(agentId ?? ''), String(text ?? '')),
    controlLog: () => invoke('remote:controlLog'),
    // Thread controls (plan item 44, 164-remote-thread-more.js). thread: rename, close, model or
    // effort of an agent there; resume: a past conversation there, by its list's handle; askPast /
    // past: that computer's past conversations, asked and as held here; onNote: what another
    // computer made happen here, said where it lands.
    thread: (computerId, agentId, what, value, mark) =>
      invoke(
        'remote:thread',
        String(computerId),
        String(agentId),
        String(what),
        String(value ?? ''),
        String(mark ?? '')
      ),
    resume: (computerId, handle) => invoke('remote:resume', String(computerId), String(handle)),
    askPast: computerId => invoke('remote:askPast', String(computerId)),
    past: computerId => invoke('remote:past', String(computerId)),
    onNote: listen('remote:note'),
    // A prompt with one to three files for an agent on another computer.
    // files: [{ kind: 'jpg' | 'png' | 'txt', bytes: ArrayBuffer
    // }], pictures already made small by the page. Resolves when the files and the prompt are over.
    promptFiles: (computerId, agentId, text, mark, files) =>
      invoke(
        'remote:promptFiles',
        String(computerId),
        String(agentId),
        String(text ?? ''),
        String(mark ?? ''),
        Array.isArray(files)
          ? files.map(f => ({ kind: String(f?.kind ?? ''), bytes: f?.bytes }))
          : []
      ),
    stopFiles: () => invoke('remote:stopFiles'),
    // a file that came with a prompt from another computer: show it in its folder
    showFile: name => invoke('remote:showFile', String(name ?? '')),
    reportText: (computerId, agentId) =>
      // the answer's first part of a result the state lists (it is not in the state itself)
      invoke('remote:reportText', String(computerId), String(agentId ?? '')),
    // The live view. On the computer that watches: view asks for
    // an agent's panel (`mark` as for a prompt) and answers { sent }; what the dialog shows then
    // arrives on onView, the one place a picture is handed to the window (null: no view); keepView,
    // unview('closed' | 'hidden'), viewNow. On the computer that is watched: onScreen({ paneId, on
    // }) asks this window for that panel's screen and screenRows hands it over as plain rows (null:
    // no terminal for it); stopView ends that computer's view from here.
    view: (computerId, agentId, mark) =>
      invoke('remote:view', String(computerId), String(agentId), String(mark ?? '')),
    keepView: () => invoke('remote:keepView'),
    unview: why => invoke('remote:unview', String(why ?? '')),
    viewNow: () => invoke('remote:viewNow'),
    onView: listen('remote:view'),
    onScreen: listen('remote:screen'),
    screenRows: (paneId, raw) =>
      invoke('remote:screenRows', String(paneId), raw && typeof raw === 'object' ? raw : null),
    stopView: computerId => invoke('remote:stopView', String(computerId)),
    // Typing into the panel this computer watches on another one (remote-type.js): keys as
    // names or { x: text }, a paste, leaving the typing box. Typing is part of full control
    // (setControl above), never a switch of its own.
    type: (computerId, agentId, mark, items) =>
      invoke(
        'remote:type',
        String(computerId),
        String(agentId ?? ''),
        String(mark ?? ''),
        Array.isArray(items) ? items : []
      ),
    typePaste: (computerId, agentId, mark, text) =>
      invoke(
        'remote:typePaste',
        String(computerId),
        String(agentId ?? ''),
        String(mark ?? ''),
        String(text ?? '')
      ),
    typeEnd: () => invoke('remote:typeEnd'),
  },
  // Alerts to Discord (discord-alerts.js): { enabled, events, webhook: masked, set, lastError }.
  // The URL is only ever sent, never read back.
  // Scheduled prompts (desktop/prompt-schedules.js; Settings › Agents, 155): main checks every
  // field again, the window only asks.
  schedules: {
    view: () => invoke('schedules:view'),
    save: schedule =>
      invoke('schedules:save', schedule && typeof schedule === 'object' ? schedule : {}),
    enable: (id, on) => invoke('schedules:enable', String(id ?? ''), on === true),
    remove: id => invoke('schedules:remove', String(id ?? '')),
    runNow: id => invoke('schedules:runNow', String(id ?? '')),
    dismissMissed: id => invoke('schedules:dismissMissed', String(id ?? '')),
    // the Board page (157): an idea started as a thread now, or put on a day once
    startPrompt: job => invoke('schedules:startPrompt', job && typeof job === 'object' ? job : {}),
    createOnce: job => invoke('schedules:createOnce', job && typeof job === 'object' ? job : {}),
    onState: listen('schedules:state'),
  },
  // The Board page's ideas, per project folder (desktop/board-ideas.js).
  board: {
    ideas: folder => invoke('board:ideas', String(folder ?? '')),
    addIdea: (folder, text) => invoke('board:addIdea', String(folder ?? ''), String(text ?? '')),
    removeIdea: (folder, id) => invoke('board:removeIdea', String(folder ?? ''), String(id ?? '')),
  },
  discordAlerts: {
    get: () => invoke('discordAlerts:get'),
    set: (patch = {}) =>
      invoke('discordAlerts:set', {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled === true } : {}),
        ...(patch.webhookUrl !== undefined ? { webhookUrl: String(patch.webhookUrl ?? '') } : {}),
        ...(patch.events && typeof patch.events === 'object'
          ? {
              events: {
                ...Object.fromEntries(
                  ['needsYou', 'finished', 'stuck']
                    .filter(k => k in patch.events)
                    .map(k => [k, patch.events[k] === true])
                ),
              },
            }
          : {}),
      }),
    test: () => invoke('discordAlerts:test'),
  },
  // Each session's current task: start/end and real token usage from the CLI's own files
  // (agent-turns.js).
  agentTurns: {
    state: () => invoke('agentTurns:state'),
    on: listen('agent:turn'),
  },
  // Settings › Usage: aggregated real token usage from the agent CLIs' own session logs
  // (usage-stats.js).
  usage: {
    stats: () => invoke('usage:stats'),
    // plan-limits.js forAccounts: Claude Code per account + Codex's newest file reading
    limits: force => invoke('usage:limits', !!force),
  },
  // Top bar PC stats (system-stats.js): watch(true) while the window is visible; stats pushed every
  // 3 s on `on`.
  system: { watch: on => invoke('system:watch', !!on), on: listen('system:stats') },
  // Snapshot shortcut (snapshot-service.js): which shortcut, whether it is registered, or why not.
  // setShortcut(accelerator | null = default).
  snapshot: {
    state: () => invoke('snapshot:state'),
    setShortcut: accelerator => invoke('snapshot:setShortcut', accelerator),
    onState: listen('snapshot:state'),
  },
  // The Snapshots box (snapshot-shelf.js): the last five pictures and clips. kind is 'picture' or
  // 'clip'; onChange hears the new list after every change.
  snapshots: {
    list: () => invoke('snapshots:list'),
    copy: (kind, id) => invoke('snapshots:copy', kind, id),
    remove: (kind, id) => invoke('snapshots:remove', kind, id),
    clear: () => invoke('snapshots:clear'),
    onChange: listen('snapshots:changed'),
  },
  // Agent mesh (agent-mesh.js): agent sessions incl. CLIs started by hand in a terminal, and the
  // pane names `tnai` uses.
  mesh: {
    state: () => invoke('mesh:state'),
    names: list => invoke('mesh:names', list),
    onChange: listen('mesh:changed'),
  },
  // Voice prompts (voice-service.js): local speech-to-text for the composer's mic button.
  // transcribe(wav, lang, hints) takes an ArrayBuffer/Uint8Array; lang is the spoken language
  // ('en', 'auto' or a Whisper code) and picks the model; hints (optional) is an array of project
  // words (file and agent names) that bias English decoding toward them (main.js sanitizes and caps
  // it). model (optional, last on every call) is the Voice model setting: 'fast' (default),
  // 'accurate' or 'best'. gpu (optional, after model) is the Use graphics card setting: true runs
  // the Whisper models on an NVIDIA card when one can be used. gpu() says whether that switch can
  // be offered: { available, reason, name, installed, sizeMB }.
  voice: {
    status: (lang, model, gpu) =>
      invoke('voice:status', String(lang || 'en'), String(model || 'fast'), gpu === true),
    install: (lang, model, gpu) =>
      invoke('voice:install', String(lang || 'en'), String(model || 'fast'), gpu === true),
    warm: (lang, model, gpu) =>
      invoke('voice:warm', String(lang || 'en'), String(model || 'fast'), gpu === true),
    transcribe: (wav, lang, hints, model, gpu) =>
      invoke(
        'voice:transcribe',
        wav,
        String(lang || 'en'),
        Array.isArray(hints) ? hints.filter(h => typeof h === 'string') : [],
        String(model || 'fast'),
        gpu === true
      ),
    gpu: () => invoke('voice:gpu'),
    // hold(true, codes) while listening: window on top; onReleased fires when those keys/buttons
    // are all up, even if a pop-up took focus.
    hold: (on, codes) => invoke('voice:hold', !!on, Array.isArray(codes) ? codes.map(String) : []),
    // key down → words typed in: messages for a panel wait meanwhile (attention-service.js)
    speaking: on => ipcRenderer.send('voice:speaking', !!on),
    onReleased: listen('voice:released'),
    onProgress: listen('voice:progress'),
    // The low-mic notice's button (70): opens the system's sound input settings; false where there
    // is none to open.
    micSettings: () => invoke('voice:mic-settings'),
    // A dev copy started with TNAI_VOICE_KEEP=1 (tools/voice-regress.js): keepOn() is true, and
    // keep(rawWav, heard) saves that prompt's clip as a test clip. An installed build answers false
    // and saves nothing.
    keepOn: () => invoke('voice:keep-on'),
    keep: (wav, heard) => invoke('voice:keep', wav, String(heard || '')),
  },
});

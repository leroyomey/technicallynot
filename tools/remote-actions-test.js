// Test of desktop/remote-actions.js: node tools/remote-actions-test.js (plain Node; also run it in
// Electron's Node). The app's real actions behind a paired computer's control operations:
// a prompt, an interrupt, a stop, a start. Every part of the
// app is a stand-in that counts its calls; the rules that decide whether an operation is taken at
// all are remote-control.js's (tools/remote-control-test.js) and are not repeated here. A number in
// a check's name is the numbered test of the design it belongs to. The last two parts
// load the real desktop/agent-lifecycle.js and desktop/agent-mesh.js (Electron's `app` stubbed, the
// state file in a temp folder) for the mark and count of remotely started panels and for the one
// interrupt count shared with `tnai intervene`.
const os = require('os'),
  path = require('path'),
  fs = require('fs'),
  Module = require('module');
const {
  createRemoteActions,
  INTERRUPT_REPLY_MS,
  STARTABLE,
  LEVEL_ON_RESUME,
  ASK_ON_RESUME,
} = require('../desktop/remote-actions.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}
const GAP = 120000,
  KEY = 'a'.repeat(40),
  OTHER = 'b'.repeat(40),
  ESC = String.fromCharCode(0x1b);
const session = (agent, more = {}) => ({
  agent,
  mode: 'run',
  running: true,
  pid: 4242,
  startedAt: 1700000000001,
  ...more,
});

// One computer: its panels, roster, task record, questions, lifecycle and deliveries, all
// stand-ins.
function world() {
  const w = {
    t: 1700000000000,
    sessions: {
      p1: session('Claude Code'),
      px: session('Codex', { pid: 4343 }),
      po: session('OpenCode', { pid: 4444 }),
      shell: session('Terminal', { pid: 5001 }),
      typed: session('Terminal', { pid: 5002 }),
      login: session('Claude Code', { mode: 'login', pid: 5003 }),
      dead: session('Claude Code', { running: false, pid: 5004 }),
    },
    hand: { typed: 'Claude Code' },
    names: { p1: 'Moss' },
    tasks: { p1: 'Fix the login page' },
    instances: { p1: 'inst-1', px: 'inst-x', po: 'inst-o', login: 'inst-l', dead: 'inst-d' },
    busy: new Set(['p1', 'px', 'po']),
    stopped: {},
    question: new Set(),
    draft: new Set(),
    speaking: false,
    interrupted: {},
    abortSays: { ok: true },
    submitSays: { ok: true, state: 'sent' },
    stopSays: true,
    keys: {},
    folders: {},
    parents: {},
    asks: new Map(),
    remote: new Set(),
    spawnSays: null,
    calls: {
      write: [],
      stop: [],
      abort: [],
      submit: [],
      spawn: [],
      pasted: [],
      unsent: [],
      waits: 0,
      take: [],
      key: [],
    },
  };
  w.actions = createRemoteActions({
    ptys: {
      list: () => Object.entries(w.sessions).map(([paneId, s]) => ({ paneId, ...s })),
      write: (id, data) => {
        w.calls.write.push([id, data]);
      },
      stop: id => {
        w.calls.stop.push(id);
        return w.stopSays;
      },
    },
    mesh: {
      nameOf: id => w.names[id] || '',
      cliOf: id => w.hand[id] || null,
      taskOf: id => w.tasks[id] || '',
      interruptLeft: id => Math.max(0, GAP - (w.t - (w.interrupted[id] || 0))),
      interruptedNow: id => {
        w.interrupted[id] = w.t;
      },
    },
    lifecycle: {
      instanceOf: id => w.instances[id] || '',
      spawnRemote: (...a) => {
        w.calls.spawn.push(a);
        return typeof w.spawnSays === 'function' ? w.spawnSays(...a) : w.spawnSays;
      },
      remoteTake: (mark, paneId, agent) => {
        w.calls.take.push([mark, paneId, agent]);
        const ask = w.asks.get(mark);
        if (!ask || ask.paneId || ask.agent !== agent) return false;
        ask.paneId = paneId;
        w.remote.add(paneId);
        return ask.kept || {};
      },
      remoteStarted: id => w.remote.has(id),
      remoteOpen: () => w.remote.size,
    },
    turns: {
      busy: id => w.busy.has(id),
      stopped: id => {
        const v = w.stopped[id];
        return typeof v === 'function' ? v() : v || '';
      },
    },
    attention: {
      blocker: id => (w.question.has(id) ? { kind: 'permission' } : null),
      hasDraft: id => w.draft.has(id) || w.speaking,
      remotePasted: id => {
        w.calls.pasted.push(id);
      },
      unsent: (id, text) => {
        w.calls.unsent.push([id, text]);
      },
    },
    submit: (...a) => {
      w.calls.submit.push(a);
      return typeof w.submitSays === 'function' ? w.submitSays(...a) : w.submitSays;
    },
    abort: async id => {
      w.calls.abort.push(id);
      if (w.abortSays === 'throw') throw new Error('no link');
      return w.abortSays;
    },
    panelKey: async id => {
      w.calls.key.push(id);
      return w.keys[id] ?? '';
    },
    folderKey: async folder => {
      w.calls.key.push('folder ' + folder);
      return w.folders[folder] ?? '';
    },
    parentsOf: node => w.parents[node] || [],
    wait: async ms => {
      w.calls.waits++;
      w.t += ms;
    },
  });
  w.touched = () =>
    w.calls.write.length +
    w.calls.stop.length +
    w.calls.abort.length +
    w.calls.submit.length +
    w.calls.spawn.length;
  return w;
}
const yes = () => true,
  no = () => false;

(async () => {
  // ---- what a panel runs now (change 3) ----
  {
    const w = world(),
      a = w.actions.agentNow('p1');
    check(
      '7: an agent the app started: its name, CLI, mode, conversation and process, read now',
      JSON.stringify(a) ===
        JSON.stringify({
          name: 'Moss',
          cli: 'Claude Code',
          mode: 'run',
          running: true,
          hand: false,
          instance: 'inst-1',
          pid: 4242,
          startedAt: 1700000000001,
        }),
      a
    );
    check(
      '7: a PowerShell panel is a "Terminal"; with a CLI typed by hand into it, it is still a "Terminal" and marked hand',
      w.actions.agentNow('shell').cli === 'Terminal' &&
        w.actions.agentNow('shell').hand === false &&
        w.actions.agentNow('typed').cli === 'Terminal' &&
        w.actions.agentNow('typed').hand === true
    );
    check(
      '7: a sign-in run and an ended process say so; a panel with no process is no agent',
      w.actions.agentNow('login').mode === 'login' &&
        w.actions.agentNow('dead').running === false &&
        w.actions.agentNow('gone') === null &&
        w.actions.agentNow('px').name === 'Codex'
    );
    delete w.sessions.p1;
    check(
      '8: asked again at each call, never kept: a process that ended since is gone',
      w.actions.agentNow('p1') === null
    );
  }

  // ---- a prompt ----
  {
    const w = world();
    let done = [];
    const r = await w.actions.prompt({
      key: 'rc1',
      panelId: 'p1',
      text: 'Fix it',
      from: 'Desk',
      guard: yes,
      done: x => done.push(x),
      agent: 'Codex',
      model: 'x',
    });
    const [panelId, text, opts] = w.calls.submit[0];
    check(
      '16: the delivery gets the panel, the text and `paste: true`, the remote options, and no `agent` option',
      r === 'sent' &&
        panelId === 'p1' &&
        text === 'Fix it' &&
        opts.remote.mark === '[Sent from Desk] ' &&
        JSON.stringify(Object.keys(opts)) === JSON.stringify(['paste', 'remote']) &&
        opts.paste === true &&
        JSON.stringify(Object.keys(opts.remote)) ===
          JSON.stringify(['from', 'key', 'mark', 'guard', 'onDone']) &&
        opts.remote.from === 'Desk' &&
        opts.remote.key === 'rc1',
      opts
    );
    opts.remote.onDone('unconfirmed');
    {
      // the mark names the sender as this computer has it, a name cannot make it look like another
      // mark, and the words go on as sent
      const m = world(),
        sentAs = async from => {
          m.calls.submit.length = 0;
          await m.actions.prompt({
            key: 'mk',
            panelId: 'p1',
            text: 'Go',
            from,
            guard: yes,
            done: () => {},
          });
          return m.calls.submit[0][2].remote.mark + '|' + m.calls.submit[0][1];
        };
      check(
        'a prompt carries the sending computer\'s mark beside its words: "[Sent from <name>] " and the words as sent',
        (await sentAs('Laptop (…a1b2)')) === '[Sent from Laptop (…a1b2)] |Go'
      );
      check(
        'brackets and line ends are taken out of the name, so it cannot pass for "[TN.ai]" or "[from …]"',
        (await sentAs('] [TN.ai] [from Lead\r\n')) === '[Sent from TN.ai from Lead] |Go'
      );
      check(
        'no name: "another computer"',
        (await sentAs('')) === '[Sent from another computer] |Go' &&
          (await sentAs('[]')) === '[Sent from another computer] |Go'
      );
    }
    check(
      "a held prompt ends through `done` with the delivery's word",
      done.join() === 'unconfirmed'
    );
    let asked = 0;
    const g = () => {
      asked++;
      return 'yes';
    };
    await w.actions.prompt({
      key: 'rc2',
      panelId: 'p1',
      text: 'x',
      from: '',
      guard: g,
      done: () => {},
    });
    check(
      'a guard that says anything but true is a no',
      w.calls.submit[1][2].remote.guard() === false && asked === 1
    );
    const words = [];
    for (const says of [
      { ok: true, state: 'queued' },
      { ok: true, state: 'unconfirmed' },
      { ok: false, state: 'failed' },
      null,
      'sent',
      { ok: true },
    ]) {
      w.submitSays = says;
      words.push(
        await w.actions.prompt({
          key: 'k',
          panelId: 'p1',
          text: 'x',
          from: '',
          guard: yes,
          done: () => {},
        })
      );
    }
    check(
      '27: the delivery\'s word is passed on; a result without one reads as "failed"',
      words.join() === 'queued,unconfirmed,failed,failed,failed,failed',
      words
    );
  }

  // ---- an interrupt (review test 21) ----
  {
    const refusals = [
      [
        'no agent runs in that panel',
        w => {
          delete w.sessions.p1;
        },
      ],
      [
        'a question waits (Esc would answer it)',
        w => {
          w.question.add('p1');
        },
      ],
      [
        'the input holds unsent text',
        w => {
          w.draft.add('p1');
        },
      ],
      [
        'the user is dictating',
        w => {
          w.speaking = true;
        },
      ],
      [
        'the agent is not working',
        w => {
          w.busy.delete('p1');
        },
      ],
      [
        'it was interrupted less than two minutes ago',
        w => {
          w.interrupted.p1 = w.t - GAP + 1;
        },
      ],
    ];
    for (const [label, setup] of refusals) {
      const w = world();
      setup(w);
      check(
        '21: interrupt refused when ' + label + ': no key, no abort, no mark',
        (await w.actions.interrupt('p1', yes)) === 'refused' &&
          w.touched() === 0 &&
          w.calls.pasted.length === 0 &&
          w.calls.unsent.length === 0,
        w.calls
      );
    }
    {
      const w = world();
      let asked = 0;
      check(
        '21: interrupt refused when the guard says no (asked once, before anything)',
        (await w.actions.interrupt('p1', () => {
          asked++;
          return false;
        })) === 'refused' &&
          asked === 1 &&
          w.touched() === 0
      );
      check(
        '21: …and when the guard says something that is not `true`',
        (await w.actions.interrupt('p1', () => 1)) === 'refused' && w.touched() === 0
      );
    }
    {
      const w = world();
      w.stopped.p1 = 'reply';
      const r = await w.actions.interrupt('p1', yes);
      check(
        '21: Claude Code that paused its task: one Esc and no other byte, "done", nothing marked',
        r === 'done' &&
          JSON.stringify(w.calls.write) === JSON.stringify([['p1', ESC]]) &&
          w.calls.pasted.length === 0 &&
          w.calls.unsent.length === 0 &&
          w.calls.abort.length === 0 &&
          w.calls.waits === 0,
        w.calls
      );
      check(
        '21: a second interrupt of that agent inside two minutes is refused, and writes nothing',
        (await w.actions.interrupt('p1', yes)) === 'refused' && w.calls.write.length === 1
      );
      w.t += GAP;
      check(
        '21: two minutes later it is taken again',
        (await w.actions.interrupt('p1', yes)) === 'done' && w.calls.write.length === 2
      );
    }
    {
      const w = world();
      w.stopped.p1 = 'restored';
      const r = await w.actions.interrupt('p1', yes);
      check(
        '21, change 12: Claude Code put the task\'s prompt back: one Esc, no Enter, the panel marked as holding unsent text, "unsent"',
        r === 'unsent' &&
          JSON.stringify(w.calls.write) === JSON.stringify([['p1', ESC]]) &&
          w.calls.pasted.join() === 'p1' &&
          JSON.stringify(w.calls.unsent) === JSON.stringify([['p1', 'Fix the login page']]),
        w.calls
      );
    }
    {
      const w = world();
      let n = 0;
      w.stopped.p1 = () => (++n >= 4 ? 'reply' : '');
      check(
        '21: the answer is waited for: known after a moment, "done"',
        (await w.actions.interrupt('p1', yes)) === 'done' &&
          w.calls.waits === 3 &&
          w.calls.pasted.length === 0,
        w.calls.waits
      );
    }
    {
      const w = world();
      const r = await w.actions.interrupt('p1', yes);
      check(
        '21, change 12: not known within ' +
          INTERRUPT_REPLY_MS +
          ' ms reads as "put back": "unsent", marked, still one Esc',
        r === 'unsent' &&
          w.calls.waits === INTERRUPT_REPLY_MS / 250 &&
          w.calls.write.length === 1 &&
          w.calls.pasted.join() === 'p1' &&
          w.calls.unsent.length === 1,
        w.calls
      );
    }
    {
      const w = world();
      let n = 0;
      w.stopped.p1 = () => {
        if (++n === 2) delete w.sessions.p1;
        return '';
      }; // the process ends inside the wait (a stop, a close, its own end)
      const r = await w.actions.interrupt('p1', yes);
      check(
        'review 13, 4: the panel\'s process ended during the wait: "done", and nothing is marked for a panel that runs nothing',
        r === 'done' &&
          w.calls.pasted.length === 0 &&
          w.calls.unsent.length === 0 &&
          w.calls.write.length === 1,
        [r, w.calls.pasted, w.calls.unsent]
      );
    }
    {
      const w = world();
      let n = 0;
      w.stopped.p1 = () => {
        if (++n === 2)
          w.sessions.p1 = session('Claude Code', { pid: 9999, startedAt: 1700000005555 });
        return '';
      }; // another process took the panel
      const r = await w.actions.interrupt('p1', yes);
      check(
        'review 13, 4: another process runs in that panel after the wait: "done", the new one is not marked',
        r === 'done' && w.calls.pasted.length === 0 && w.calls.unsent.length === 0,
        [r, w.calls.pasted]
      );
    }
    {
      const w = world();
      check(
        '21: another CLI (Codex): one Esc, "done" at once',
        (await w.actions.interrupt('px', yes)) === 'done' &&
          JSON.stringify(w.calls.write) === JSON.stringify([['px', ESC]]) &&
          w.calls.waits === 0 &&
          w.calls.pasted.length === 0
      );
    }
    {
      const w = world();
      check(
        '21: OpenCode: its own abort call, "done", and no key at all',
        (await w.actions.interrupt('po', yes)) === 'done' &&
          w.calls.abort.join() === 'po' &&
          w.calls.write.length === 0 &&
          w.interrupted.po === w.t,
        w.calls
      );
      const v = world();
      v.abortSays = { ok: false };
      check(
        '21: OpenCode\'s abort not taken: "failed", and still no key',
        (await v.actions.interrupt('po', yes)) === 'failed' &&
          v.calls.abort.length === 1 &&
          v.calls.write.length === 0
      );
      const x = world();
      x.abortSays = 'throw';
      check(
        '21: OpenCode\'s abort throws: "failed", no key',
        (await x.actions.interrupt('po', yes)) === 'failed' && x.calls.write.length === 0
      );
    }
    {
      const w = world();
      const order = [];
      w.actions = null;
      const a = createRemoteActions({
        ptys: {
          list: () => [{ paneId: 'p1', ...session('Codex') }],
          write: () => order.push('write'),
          stop: () => true,
        },
        mesh: {
          nameOf: () => '',
          cliOf: () => null,
          taskOf: () => '',
          interruptLeft: () => 0,
          interruptedNow: () => order.push('counted'),
        },
        lifecycle: { instanceOf: () => 'i' },
        turns: { busy: () => true, stopped: () => '' },
        attention: { blocker: () => null, hasDraft: () => false },
        submit: () => null,
        abort: async () => null,
        panelKey: async () => '',
      });
      await a.interrupt('p1', () => {
        order.push('guard');
        return true;
      });
      check(
        '21: the guard, then the count, then the key, in one turn',
        order.join() === 'guard,counted,write',
        order
      );
    }
  }

  // ---- a stop (review test 22) ----
  {
    const w = world();
    const refused = [];
    for (const id of ['shell', 'typed', 'login', 'dead', 'gone'])
      refused.push(w.actions.stop(id, yes));
    check(
      '7, 22: a PowerShell panel, one with a typed CLI, a sign-in run, an ended process, no panel: refused, the stop call is never made',
      refused.every(x => x === 'refused') && w.calls.stop.length === 0,
      refused
    );
    let asked = 0;
    const b = w.actions.stop('p1', () => {
      asked++;
      return false;
    });
    check(
      '22: the guard says no: refused, nothing stopped',
      b === 'refused' && asked === 1 && w.calls.stop.length === 0
    );
    check(
      '22: an agent the app started: stopped once, "done"',
      w.actions.stop('p1', yes) === 'done' && w.calls.stop.join() === 'p1'
    );
    w.stopSays = false;
    check(
      '22: nothing was running there after all: "failed"',
      w.actions.stop('px', yes) === 'failed' && w.calls.stop.length === 2
    );
    check('a stop writes no key', w.calls.write.length === 0 && w.calls.abort.length === 0);
  }

  // ---- a start: what `pty:start` is given (review test 18) ----
  {
    const w = world();
    const local = {
      paneId: 'n1',
      agent: 'Claude Code',
      mode: 'run',
      access: 'full',
      ownedByUser: true,
      model: 'm',
      effort: 'high',
    };
    check(
      "a start without a mark is this computer's own: the very same options come back, nothing is asked",
      w.actions.startOptions(local).options === local &&
        w.actions.startOptions({ ...local, remote: '' }).error === undefined &&
        w.calls.take.length === 0
    );
    w.asks.set('req-1', {
      agent: 'Claude Code',
      paneId: '',
      kept: { from: 'Desk', guard: () => true },
    });
    const got = w.actions.startOptions({
      ...local,
      ownedByUser: false,
      remote: 'req-1',
      accountId: 'acc',
      name: 'Fern',
    });
    check(
      '18: a start under a remote request\'s mark is at "Ask first" although the window asked for Full access, in run mode, owned by the user (so the folder\'s trust is asked here)',
      got.options &&
        got.options.access === 'ask' &&
        got.options.mode === 'run' &&
        got.options.ownedByUser === true &&
        !('remote' in got.options) &&
        got.options.paneId === 'n1' &&
        got.options.agent === 'Claude Code',
      got
    );
    check(
      "18: what this computer's own window chose besides stays (its default model, effort, account, the panel's name)",
      got.options.model === 'm' &&
        got.options.effort === 'high' &&
        got.options.accountId === 'acc' &&
        got.options.name === 'Fern'
    );
    check(
      '17: the panel is remembered as started from another computer',
      w.remote.has('n1') && w.actions.remoteStarted() === 1
    );
    check(
      'a mark starts one panel only: used again, nothing starts',
      !!w.actions.startOptions({ ...local, paneId: 'n2', remote: 'req-1' }).error &&
        !w.remote.has('n2')
    );
    w.asks.set('req-2', { agent: 'OpenCode', paneId: '' });
    const bad = [
      { ...local, remote: 'nope' },
      { ...local, remote: 'req-2' } /* another CLI than the request named */,
      { ...local, agent: 'OpenCode', remote: 'req-2', mode: 'login' },
      { ...local, agent: 'OpenCode', remote: 'req-2', resumeId: 'old' },
      { ...local, agent: 'OpenCode', remote: 'req-2', customAgentId: 'c1' },
      { ...local, agent: 'OpenCode', remote: 'req-2', subagentOf: 'node' },
      { ...local, agent: 'OpenCode', remote: 'req-2', login: { email: 'x' } },
      { ...local, agent: 'OpenCode', remote: ['req-2'] },
      { ...local, agent: 'OpenCode', remote: 'req-2', paneId: '' },
      { ...local, agent: ['OpenCode'], remote: 'req-2' },
    ];
    check(
      'an unknown mark, another CLI than was asked, a sign-in run, a resumed conversation, a custom agent, a sub-agent: nothing starts',
      bad.every(
        o =>
          typeof w.actions.startOptions(o).error === 'string' && !w.actions.startOptions(o).options
      ) &&
        w.remote.size === 1 &&
        w.asks.get('req-2').paneId === '',
      bad.map(o => !!w.actions.startOptions(o).error)
    );
    const ok2 = w.actions.startOptions({
      paneId: 'n3',
      agent: 'OpenCode',
      remote: 'req-2',
      access: 'default',
    });
    check(
      '18: "CLI default" from the window becomes "Ask first" too, and a missing mode is run mode',
      ok2.options.access === 'ask' && ok2.options.mode === 'run' && w.remote.has('n3')
    );
    check(
      "18: the mark's start also gives back who asked and their guard, for the check just before the process is made",
      got.remote &&
        got.remote.from === 'Desk' &&
        typeof got.remote.guard === 'function' &&
        !('remote' in w.actions.startOptions(local)),
      got.remote
    );

    // Review 13, finding 3: which CLIs may be started from another computer at all.
    check(
      'review 13, 3: of the CLIs ready here only Claude Code and OpenCode are offered; Codex and Cursor Agent are not',
      JSON.stringify(
        w.actions.startable(['Codex', 'Cursor Agent', 'OpenCode', 'Gemini CLI', 'Claude Code'])
      ) === JSON.stringify(['Claude Code', 'OpenCode']) &&
        JSON.stringify(STARTABLE) === JSON.stringify(['Claude Code', 'OpenCode']) &&
        w.actions.startable(['Codex', 'Cursor Agent']).length === 0 &&
        w.actions.startable(null).length === 0
    );
    for (const cli of ['Codex', 'Cursor Agent', 'Gemini CLI']) {
      w.asks.set('req-' + cli, { agent: cli, paneId: '', kept: {} });
    }
    check(
      'review 13, 3: a start under a mark for Codex or Cursor Agent starts nothing, even with a request for it',
      ['Codex', 'Cursor Agent', 'Gemini CLI'].every(
        cli =>
          typeof w.actions.startOptions({
            paneId: 'x-' + cli,
            agent: cli,
            remote: 'req-' + cli,
            access: 'ask',
          }).error === 'string' && !w.remote.has('x-' + cli)
      )
    );

    // Review 13, finding 2: every later start of a panel that was started from another computer,
    // and its sub-agents.
    const again = {
      paneId: 'n1',
      agent: 'Claude Code',
      mode: 'run',
      access: 'full',
      ownedByUser: true,
    };
    const second = w.actions.startOptions(again);
    check(
      'review 13, 2: a second start of a remotely started panel, fresh, with the project at Full access: "Ask first"; nothing else changes',
      second.options.access === 'ask' &&
        !second.error &&
        !second.remote &&
        JSON.stringify({ ...second.options, access: 'full' }) === JSON.stringify(again) &&
        w.actions.startOptions({ ...again, access: 'default' }).options.access === 'ask' &&
        w.actions.startOptions({ ...again, access: undefined }).options.access === 'ask'
    );
    const asked = { ...again, access: 'ask' };
    check(
      'review 13, 2: one that is already at "Ask first" comes back as the same object',
      w.actions.startOptions(asked).options === asked
    );
    const resumedOc = w.actions.startOptions({
      paneId: 'n3',
      agent: 'OpenCode',
      mode: 'run',
      resumeId: 'ses_1',
      access: 'full',
    });
    check(
      'review 13, 2: a resumed start of such a panel, OpenCode (its level is sent again on a resume): "Ask first", the conversation kept',
      resumedOc.options &&
        resumedOc.options.access === 'ask' &&
        resumedOc.options.resumeId === 'ses_1',
      resumedOc
    );
    const resumedCc = w.actions.startOptions({ ...again, resumeId: 'conv-1', access: 'default' });

    // Changed 2026-10-10 ("Added 2026-10-10"): a Claude Code
    // conversation of such a panel is resumed and held: the level is "Ask first" whatever the
    // window sent, and the start asks the registry for the flag on the resume.
    check(
      'resume: a resumed Claude Code start of such a panel is not refused: "Ask first", askOnResume, the conversation kept; the two lists are as designed',
      !resumedCc.error &&
        resumedCc.options &&
        resumedCc.options.access === 'ask' &&
        resumedCc.options.askOnResume === true &&
        resumedCc.options.resumeId === 'conv-1' &&
        JSON.stringify(LEVEL_ON_RESUME) === JSON.stringify(['OpenCode']) &&
        JSON.stringify(ASK_ON_RESUME) === JSON.stringify(['Claude Code']),
      resumedCc
    );
    check(
      'resume: the same with the project at Full access',
      w.actions.startOptions({ ...again, resumeId: 'conv-1', access: 'full' }).options.access ===
        'ask' &&
        w.actions.startOptions({ ...again, resumeId: 'conv-1', access: 'full' }).options
          .askOnResume === true
    );
    check(
      "resume: OpenCode's resume carries no askOnResume (its level travels as before)",
      resumedOc.options.askOnResume === undefined
    );
    const resumedOther = w.actions.startOptions({
      ...again,
      agent: 'Codex',
      resumeId: 'conv-9',
      access: 'default',
    });
    check(
      'resume: a CLI in neither list is still refused, with the reason and its name',
      !resumedOther.options &&
        /Ask first/.test(resumedOther.error) &&
        /Codex/.test(resumedOther.error),
      resumedOther
    );
    {
      // The mark follows the conversation: resumed in a panel that is not one of those panels, it
      // is held and that panel becomes one.
      const plain = {
        paneId: 'fresh-1',
        agent: 'Claude Code',
        mode: 'run',
        resumeId: 'conv-x',
        access: 'full',
      };
      check(
        'resume: a lifecycle without remoteResumed (an older stand-in): an ordinary resumed start comes back as the same object',
        w.actions.startOptions(plain).options === plain
      );
      const asked = [],
        w2 = world();
      w2.actions = createRemoteActions({
        ptys: { list: () => [] },
        mesh: {},
        turns: {},
        attention: {},
        submit: async () => null,
        abort: async () => null,
        panelKey: async () => '',
        parentsOf: n => (n === 'under-remote' ? ['sub-pane', 'r1'] : []),
        lifecycle: {
          remoteTake: () => false,
          remoteStarted: id => id === 'r1',
          remoteResumed: (paneId, agent, id) => {
            asked.push([paneId, agent, id]);
            return agent === 'Claude Code' && id === 'conv-remote';
          },
          remoteOpen: () => 1,
        },
      });
      const moved = w2.actions.startOptions({
        paneId: 'new-9',
        agent: 'Claude Code',
        mode: 'run',
        resumeId: 'conv-remote',
        access: 'full',
      });
      check(
        'resume: a conversation that ran in such a panel, resumed in a new panel: asked of the lifecycle by panel, CLI and conversation, then "Ask first" and askOnResume',
        moved.options &&
          moved.options.access === 'ask' &&
          moved.options.askOnResume === true &&
          JSON.stringify(asked.at(-1)) === JSON.stringify(['new-9', 'Claude Code', 'conv-remote']),
        [moved, asked]
      );
      const local = { paneId: 'new-10', agent: 'Claude Code', mode: 'run', resumeId: 'conv-local' };
      check(
        'resume: any other resumed conversation in a new panel is untouched (the same object), and a fresh start asks nothing',
        w2.actions.startOptions(local).options === local &&
          (() => {
            const n = asked.length,
              f = { paneId: 'new-11', agent: 'Claude Code', mode: 'run' };
            return w2.actions.startOptions(f).options === f && asked.length === n;
          })()
      );
      const subR = w2.actions.startOptions({
        paneId: 'sub-1',
        agent: 'Claude Code',
        mode: 'run',
        subagentOf: 'under-remote',
        resumeId: 'sub-conv',
        access: 'full',
      }).options;
      const subF = w2.actions.startOptions({
        paneId: 'sub-2',
        agent: 'Claude Code',
        mode: 'run',
        subagentOf: 'under-remote',
        access: 'full',
      }).options;
      check(
        'resume: a revived Claude Code sub-agent under such a panel gets the flag on its resume too; a fresh one only the level',
        subR.access === 'ask' &&
          subR.askOnResume === true &&
          subF.access === 'ask' &&
          subF.askOnResume === undefined,
        [subR, subF]
      );

      // The window already asked for "Ask first" (the project's
      // level) or Plan only. The resume is held all the same.
      const subAsk = w2.actions.startOptions({
        paneId: 'sub-3',
        agent: 'Claude Code',
        mode: 'run',
        subagentOf: 'under-remote',
        resumeId: 'sub-conv',
        access: 'ask',
      }).options;
      const subPlan = w2.actions.startOptions({
        paneId: 'sub-4',
        agent: 'Claude Code',
        mode: 'run',
        subagentOf: 'under-remote',
        resumeId: 'sub-conv',
        access: 'plan',
      }).options;
      check(
        'review 19, 3.1: a revived Claude Code sub-agent under such a panel is held on its resume also when the window asked for "Ask first" or Plan only (the asked level stays)',
        subAsk.access === 'ask' &&
          subAsk.askOnResume === true &&
          subPlan.access === 'plan' &&
          subPlan.askOnResume === true,
        [subAsk, subPlan]
      );
      const freshAsk = {
          paneId: 'sub-5',
          agent: 'Claude Code',
          mode: 'run',
          subagentOf: 'under-remote',
          access: 'ask',
        },
        ocAsk = {
          paneId: 'sub-6',
          agent: 'OpenCode',
          mode: 'run',
          subagentOf: 'under-remote',
          resumeId: 'oc-conv',
          access: 'ask',
        };
      check(
        'review 19, 3.1: a fresh sub-agent at "Ask first" and a revived OpenCode one (its level travels on a resume) come back as the same object, without the word',
        w2.actions.startOptions(freshAsk).options === freshAsk &&
          w2.actions.startOptions(ocAsk).options === ocAsk
      );
      const ownKid = {
        paneId: 'sub-7',
        agent: 'Claude Code',
        mode: 'run',
        subagentOf: 'under-own',
        resumeId: 'own-conv',
        access: 'ask',
      };
      check(
        "review 19, 3.1: a revived sub-agent under this computer's own agent is untouched (the same object, no word)",
        w2.actions.startOptions(ownKid).options === ownKid
      );
      check(
        "resume: a start that carries another computer's mark and a conversation is still refused",
        typeof w2.actions.startOptions({
          paneId: 'm1',
          agent: 'Claude Code',
          mode: 'run',
          remote: 'mark',
          resumeId: 'conv-remote',
        }).error === 'string'
      );
    }
    const shell = { paneId: 'n1', agent: 'Terminal', mode: 'run' },
      signIn = { paneId: 'n1', agent: 'Claude Code', mode: 'login', login: {} };
    check(
      'review 13, 2: a PowerShell or a sign-in run in that panel has no access level: untouched',
      w.actions.startOptions(shell).options === shell &&
        w.actions.startOptions(signIn).options === signIn
    );
    w.parents = {
      'node-under-remote': ['sub-pane', 'n1'],
      'node-under-local': ['other-pane', 'p1'],
    };
    const sub = level =>
      w.actions.startOptions({
        paneId: 'kid',
        agent: 'Claude Code',
        mode: 'run',
        subagentOf: 'node-under-remote',
        access: level,
      });
    check(
      'review 13, 2: a sub-agent under a remotely started agent is never above "Ask first", decided here: Full access, Allow edits, Auto review and CLI default become "Ask first"; Plan only stays',
      ['full', 'edits', 'auto', 'default', undefined].every(l => sub(l).options.access === 'ask') &&
        sub('plan').options.access === 'plan' &&
        sub('ask').options.access === 'ask'
    );
    const localKid = {
      paneId: 'kid2',
      agent: 'Claude Code',
      mode: 'run',
      subagentOf: 'node-under-local',
      access: 'full',
    };
    check(
      "review 13, 2: a sub-agent under this computer's own agent is untouched (the same object)",
      w.actions.startOptions(localKid).options === localKid &&
        w.actions.startOptions({ ...localKid, subagentOf: 'unknown-node' }).options.access ===
          'full'
    );
    check(
      'odd input starts nothing and does not throw',
      [null, undefined, 'x', 7].every(v => w.actions.startOptions(v).options === v)
    );
  }

  // ---- a start: the action (change 6; review tests 16, 17, 19, 20) ----
  {
    // The window's part: it opens a panel and calls pty:start with the mark, which startOptions
    // takes.
    const opens =
      (w, paneId, cli = 'Claude Code', more = {}) =>
      async (name, kept) => {
        w.asks.set('mark-' + paneId, { agent: name, paneId: '', kept });
        const o = w.actions.startOptions({
          paneId,
          agent: cli,
          remote: 'mark-' + paneId,
          access: 'full',
        });
        if (o.options) {
          w.sessions[paneId] = session(cli, { pid: 7000 });
          w.instances[paneId] = 'inst-' + paneId;
          w.keys[paneId] = w.keys[paneId] ?? KEY;
        }
        return { paneId, panel: w.asks.get('mark-' + paneId).paneId, ...more };
      };
    const guardFor = key => k => k === key;
    {
      const w = world();
      w.spawnSays = opens(w, 'n1');
      const r = await w.actions.start({
        cli: 'Claude Code',
        text: '',
        from: 'Desk',
        guard: guardFor(KEY),
        model: 'x',
        effort: 'max',
        name: 'Evil',
        cwd: 'C:\\',
      });
      check(
        '16: a start without a first prompt: the window is asked with the CLI\'s name and nothing else, "started", nothing written',
        r === 'started' &&
          w.calls.spawn.length === 1 &&
          w.calls.spawn[0].length === 2 &&
          w.calls.spawn[0][0] === 'Claude Code' &&
          Object.keys(w.calls.spawn[0][1]).join() === 'from,guard' &&
          w.calls.spawn[0][1].from === 'Desk' &&
          w.calls.submit.length === 0 &&
          w.calls.stop.length === 0 &&
          w.calls.key.join() === 'n1',
        w.calls
      );
    }
    {
      const w = world();
      w.spawnSays = opens(w, 'n1');
      const r = await w.actions.start({
        cli: 'Claude Code',
        text: 'Write the tests',
        from: 'Desk',
        guard: guardFor(KEY),
      });
      const [panelId, text, opts] = w.calls.submit[0] || [];
      check(
        '16: with a first prompt: it goes through the guarded delivery, pasted, with no `agent` option, to the panel that opened',
        r === 'started' &&
          panelId === 'n1' &&
          text === 'Write the tests' &&
          opts.remote.mark === '[Sent from Desk] ' &&
          JSON.stringify(Object.keys(opts)) === JSON.stringify(['paste', 'remote']) &&
          opts.paste === true &&
          opts.remote.from === 'Desk' &&
          typeof opts.remote.key === 'string' &&
          w.calls.stop.length === 0,
        w.calls.submit
      );
      const g = opts.remote.guard;
      const still = g() === true;
      w.sessions.n1 = session('Terminal');
      const shell = g();
      w.sessions.n1 = session('Claude Code');
      const back = g();
      check(
        "20: the first prompt's guard is asked at every write: that the panel still runs an agent the app started, and the right",
        still && shell === false && back === true,
        [still, shell, back]
      );
    }
    for (const [state, want] of [
      ['queued', 'started'],
      ['unconfirmed', 'started'],
      ['failed', 'failed'],
    ]) {
      const w = world();
      w.spawnSays = opens(w, 'n1');
      w.submitSays = { ok: state !== 'failed', state };
      const r = await w.actions.start({
        cli: 'Claude Code',
        text: 'Go',
        from: '',
        guard: guardFor(KEY),
      });
      check(
        '19: the first prompt ' +
          (state === 'queued'
            ? "held here until the new agent's own questions are answered"
            : state === 'unconfirmed'
              ? 'written with no sign from the CLI'
              : 'not taken') +
          ': "' +
          want +
          '"' +
          (want === 'failed' ? ', and the panel is stopped' : ''),
        r === want && w.calls.stop.length === (want === 'failed' ? 1 : 0),
        [r, w.calls.stop]
      );
    }
    {
      const w = world();
      w.spawnSays = opens(w, 'n1');
      w.keys.n1 = OTHER;
      const r = await w.actions.start({
        cli: 'Claude Code',
        text: 'Go',
        from: '',
        guard: guardFor(KEY),
      });
      check(
        '16: another project was opened here while the panel started (its own key is another): no first prompt, the panel is stopped, "failed"',
        r === 'failed' && w.calls.submit.length === 0 && w.calls.stop.join() === 'n1',
        w.calls
      );
    }
    {
      const w = world();
      w.spawnSays = opens(w, 'n1');
      w.keys.n1 = '';
      check(
        '15: the opened panel has no project key: stopped, "failed"',
        (await w.actions.start({
          cli: 'Claude Code',
          text: '',
          from: '',
          guard: guardFor(KEY),
        })) === 'failed' && w.calls.stop.join() === 'n1'
      );
    }
    {
      const w = world();
      let on = true;
      w.spawnSays = async name => {
        const r = await opens(w, 'n1')(name);
        on = false;
        return r;
      }; // the switch goes off during the wait
      const r = await w.actions.start({
        cli: 'Claude Code',
        text: 'Go',
        from: '',
        guard: k => on && k === KEY,
      });
      check(
        '20: the switch went off while the start waited for its panel: no first prompt, the panel is stopped, "failed"',
        r === 'failed' && w.calls.submit.length === 0 && w.calls.stop.join() === 'n1',
        w.calls
      );
    }
    {
      const w = world();
      w.folders = { 'C:\\proj': KEY, 'C:\\other': OTHER };
      let on = true;
      const remote = { from: 'Desk', guard: k => on && k === KEY };
      const yes1 = await w.actions.mayStart(remote, 'C:\\proj'),
        wrongFolder = await w.actions.mayStart(remote, 'C:\\other'),
        noFolder = await w.actions.mayStart(remote, undefined);
      on = false;
      const off = await w.actions.mayStart(remote, 'C:\\proj');
      on = true;
      check(
        "review 13, 7: just before the process is made the request's guard is asked again with the folder it starts in: yes; another project, no folder, the switch off meanwhile: no",
        yes1 === true && wrongFolder === false && noFolder === false && off === false,
        [yes1, wrongFolder, noFolder, off]
      );
      check(
        'review 13, 7: without a guard, or with one that throws or says something that is not true: no',
        (await w.actions.mayStart(null, 'C:\\proj')) === false &&
          (await w.actions.mayStart({ from: 'x' }, 'C:\\proj')) === false &&
          (await w.actions.mayStart(
            {
              guard: () => {
                throw new Error('x');
              },
            },
            'C:\\proj'
          )) === false &&
          (await w.actions.mayStart({ guard: () => 1 }, 'C:\\proj')) === false
      );
    }
    {
      const w = world();
      check(
        'review 13, 3: a start naming Codex or Cursor Agent is refused before the window is asked',
        (await w.actions.start({ cli: 'Codex', text: '', from: '', guard: guardFor(KEY) })) ===
          'refused' &&
          (await w.actions.start({
            cli: 'Cursor Agent',
            text: 'Go',
            from: '',
            guard: guardFor(KEY),
          })) === 'refused' &&
          w.calls.spawn.length === 0
      );
    }
    {
      const w = world();
      check(
        'a start without a guard is refused',
        (await w.actions.start({ cli: 'Claude Code', text: '', from: '' })) === 'refused' &&
          w.calls.spawn.length === 0
      );
    }
    {
      const w = world();
      w.spawnSays = async () => ({
        error: 'This workspace has 12 terminals. Create another workspace to continue.',
        panel: '',
      });
      check(
        '17: the workspace is full (the window opens no panel and no new workspace): "failed", nothing to stop',
        (await w.actions.start({
          cli: 'Claude Code',
          text: 'Go',
          from: '',
          guard: guardFor(KEY),
        })) === 'failed' &&
          w.calls.stop.length === 0 &&
          w.calls.submit.length === 0 &&
          w.calls.key.length === 0
      );
    }
    {
      const w = world();
      w.spawnSays = async name => {
        const r = await opens(w, 'n1')(name);
        return { error: 'started but is not ready', openedPaneId: 'n1', panel: r.panel };
      };
      check(
        'the panel opened but its CLI was not ready in time: it is stopped, "failed"',
        (await w.actions.start({
          cli: 'Claude Code',
          text: 'Go',
          from: '',
          guard: guardFor(KEY),
        })) === 'failed' &&
          w.calls.stop.join() === 'n1' &&
          w.calls.submit.length === 0
      );
    }
    {
      const w = world();
      w.spawnSays = async (name, kept) => {
        w.asks.set('m', { agent: name, paneId: '', kept });
        w.actions.startOptions({ paneId: 'waiting', agent: name, remote: 'm' });
        return { error: 'did not become ready in time.', panel: 'waiting' };
      };
      check(
        '19: no answer in time while its start still waits (a folder-trust question nobody answered): that start is cancelled, "failed"',
        (await w.actions.start({
          cli: 'Claude Code',
          text: 'Go',
          from: '',
          guard: guardFor(KEY),
        })) === 'failed' && w.calls.stop.join() === 'waiting'
      );
    }
    {
      const w = world();
      w.sessions.other = session('Claude Code');
      w.keys.other = KEY;
      w.spawnSays = async name => {
        const r = await opens(w, 'n1')(name);
        return { paneId: 'other', panel: r.panel };
      };
      check(
        '18: the window names another panel than the one that started under the mark: neither is used, both are stopped, "failed"',
        (await w.actions.start({
          cli: 'Claude Code',
          text: 'Go',
          from: '',
          guard: guardFor(KEY),
        })) === 'failed' &&
          w.calls.stop.slice().sort().join() === 'n1,other' &&
          w.calls.submit.length === 0,
        w.calls.stop
      );
    }
    {
      const w = world();
      w.sessions.old = session('Claude Code');
      w.keys.old = KEY;
      w.remote.add('old');
      w.spawnSays = async name => {
        const r = await opens(w, 'n1')(name);
        return { paneId: 'old', panel: r.panel };
      }; // an earlier panel that was itself started from another computer
      check(
        '18: the window names an earlier remotely started panel instead of the one this request started: not used, both stopped, "failed"',
        (await w.actions.start({
          cli: 'Claude Code',
          text: 'Go',
          from: '',
          guard: guardFor(KEY),
        })) === 'failed' &&
          w.calls.stop.slice().sort().join() === 'n1,old' &&
          w.calls.submit.length === 0,
        w.calls.stop
      );
    }
    {
      const w = world();
      w.spawnSays = async name => {
        const r = await opens(w, 'n1')(name);
        w.remote.delete('n1');
        return r;
      }; // this computer's user closed the panel while it was starting
      check(
        '17: the panel was closed here while it started (it is no longer counted): not used, "failed", no first prompt',
        (await w.actions.start({
          cli: 'Claude Code',
          text: 'Go',
          from: '',
          guard: guardFor(KEY),
        })) === 'failed' && w.calls.submit.length === 0,
        w.calls
      );
    }
    {
      const w = world();
      w.sessions.plain = session('Claude Code');
      w.keys.plain = KEY;

      // a window that did not carry the mark: the panel started at its own access level
      w.spawnSays = async () => ({ paneId: 'plain', panel: '' });
      check(
        '18: a panel that did not start under the mark (so not forced to "Ask first") is never used: stopped, "failed", no first prompt',
        (await w.actions.start({
          cli: 'Claude Code',
          text: 'Go',
          from: '',
          guard: guardFor(KEY),
        })) === 'failed' &&
          w.calls.stop.join() === 'plain' &&
          w.calls.submit.length === 0
      );
    }
    {
      const w = world();
      w.spawnSays = () => {
        throw new Error('no window');
      };
      const a = await w.actions.start({
        cli: 'Claude Code',
        text: '',
        from: '',
        guard: guardFor(KEY),
      });
      w.spawnSays = async () => null;
      check(
        'the window cannot be asked, or answers nothing: "failed"',
        a === 'failed' &&
          (await w.actions.start({
            cli: 'Claude Code',
            text: '',
            from: '',
            guard: guardFor(KEY),
          })) === 'failed' &&
          w.calls.stop.length === 0
      );
    }
    {
      const w = world();
      w.spawnSays = opens(w, 'n1');
      w.submitSays = () => {
        throw new Error('C:\\secret');
      };
      check(
        '27: a delivery that throws: "failed", the panel stopped, nothing of the error returned',
        (await w.actions.start({
          cli: 'Claude Code',
          text: 'Go',
          from: '',
          guard: guardFor(KEY),
        })) === 'failed' && w.calls.stop.join() === 'n1'
      );
    }
  }

  // ---- the real lifecycle record: the request, its mark, the count that survives a restart
  // (change 6, review test 17) ----
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-remote-actions-')),
      realLoad = Module._load;
    const fresh = () => {
      for (const k of Object.keys(require.cache))
        if (/[\\/]desktop[\\/](agent-lifecycle|session-store)\.js$/.test(k))
          delete require.cache[k];
      Module._load = function (req, ...rest) {
        return req === 'electron'
          ? { app: { getPath: () => tmp, on: () => {}, whenReady: () => new Promise(() => {}) } }
          : realLoad.call(this, req, ...rest);
      };
      try {
        return require('../desktop/agent-lifecycle.js');
      } finally {
        Module._load = realLoad;
      }
    };
    let life = fresh();
    const sent = [];
    life.init(
      (channel, req) => {
        if (channel === 'lifecycle:revive') sent.push(req);
      },
      { root: () => 'C:\\work\\proj', canResume: () => true }
    );
    const open = (paneId, name) =>
      life.started({
        paneId,
        agent: 'Claude Code',
        name,
        sessionId: 's-' + paneId,
        root: 'C:\\work\\proj',
        cwd: 'C:\\work\\proj',
        ownedByUser: true,
      });
    const keptIn = { from: 'Desk (…a-1)', guard: () => true };
    let done = life.spawnRemote('Claude Code', keptIn);
    const req = sent.at(-1);
    check(
      '16: the request to the window names the CLI and that it is for another computer; no model, effort, name, account or conversation',
      req.remote === true &&
        req.agent === 'Claude Code' &&
        req.model === '' &&
        req.effort === '' &&
        req.name === '' &&
        req.chosen === false &&
        req.contextId === '' &&
        req.accountId === '' &&
        req.customAgentId === '' &&
        req.instanceId === '' &&
        req.paneId === '' &&
        req.ownedByUser === true &&
        typeof req.requestId === 'string' &&
        req.requestId.length > 20,
      req
    );
    check(
      "the mark is the request's own id: another id, another CLI or an empty panel id takes nothing",
      life.remoteTake('nope', 'r1', 'Claude Code') === false &&
        life.remoteTake(req.requestId, 'r1', 'Codex') === false &&
        life.remoteTake(req.requestId, '', 'Claude Code') === false &&
        life.remoteOpen() === 0
    );
    const keptBack = life.remoteTake(req.requestId, 'r1', 'Claude Code');
    check(
      'the mark starts one panel, once, and gives back what the asker left with the request',
      keptBack === keptIn &&
        life.remoteTake(req.requestId, 'r2', 'Claude Code') === false &&
        life.remoteStarted('r1') === true &&
        life.remoteStarted('r2') === false &&
        life.remoteOpen() === 1
    );
    open('r1', 'Fern');
    life.revived(req.requestId, { paneId: 'r1' });
    const res = await done;
    check(
      'the answer names the panel the window opened and the one that started under the mark',
      res.paneId === 'r1' && res.panel === 'r1',
      res
    );
    check(
      'a panel started for another computer is the user\'s own, not "started by an agent" (`tnai new`), and does not count toward that limit',
      life.startedByAgent('r1') === false && life.startedOpen() === 0
    );
    check(
      'once answered the mark is gone: a late start with it takes nothing',
      life.remoteTake(req.requestId, 'r9', 'Claude Code') === false
    );
    {
      const wait = life.spawnRemote('Claude Code'),
        mark = sent.at(-1).requestId;
      life.revived(mark, { error: 'This workspace has 12 terminals.' });
      const ans = await wait;
      check(
        'a request the window answered without a panel: its mark is gone, a late start with it takes nothing',
        ans.error &&
          ans.panel === '' &&
          life.remoteTake(mark, 'late', 'Claude Code') === false &&
          life.remoteOpen() === 1 &&
          !life.remoteStarted('late'),
        ans
      );
    }
    const before = sent.length;
    life.spawn('Claude Code');
    check(
      'a local `tnai new` request is as before: no mark on it',
      sent.length === before + 1 && !('remote' in sent.at(-1)) && sent.at(-1).ownedByUser === true
    );
    life.revived(sent.at(-1).requestId, { error: 'not started' });
    done = life.spawnRemote('OpenCode');
    life.remoteTake(sent.at(-1).requestId, 'r2', 'OpenCode');
    open('r2', 'Kite');
    life.revived(sent.at(-1).requestId, { error: 'not ready', openedPaneId: 'r2' });
    const late = await done;
    check(
      'opened but not ready: the answer still names the panel that started, so it can be stopped',
      late.error === 'not ready' && late.panel === 'r2' && life.remoteOpen() === 2,
      late
    );
    life.exited('r2');
    check('17: a stopped panel still counts', life.remoteOpen() === 2);
    life.flushSaves();
    await new Promise(r => setTimeout(r, 700));
    life.flushSaves(); // the debounced save
    life = fresh();
    life.init(() => {}, { root: () => 'C:\\work\\proj', canResume: () => true });
    check(
      '17: the count survives a restart of the app (the panels are still there, stopped)',
      life.remoteOpen() === 2 && life.remoteStarted('r1') && life.remoteStarted('r2'),
      life.remoteOpen()
    );
    life.closed('r1');
    check(
      '17: closing a panel on this computer takes it out of the count',
      life.remoteOpen() === 1 && !life.remoteStarted('r1')
    );
    life.closed('never-remote');
    check('closing any other panel changes nothing', life.remoteOpen() === 1);
    life.flushSaves();
    await new Promise(r => setTimeout(r, 700));
    life.flushSaves();
    life = fresh();
    life.init(() => {}, { root: () => 'C:\\work\\proj', canResume: () => true });
    check(
      '17: …and that survives a restart too',
      life.remoteOpen() === 1 && life.remoteStarted('r2') && !life.remoteStarted('r1')
    );
    {
      // Review 13, finding 2, with the real record after a restart of the app: 'r2' is still
      // counted, so its next start and its sub-agent are held to "Ask first".
      const acts = createRemoteActions({
        ptys: { list: () => [], write: () => {}, stop: () => true },
        mesh: {},
        lifecycle: life,
        turns: {},
        attention: {},
        submit: async () => null,
        abort: async () => null,
        panelKey: async () => '',
        parentsOf: node => (node === 'n-r2' ? ['r2'] : ['p-own']),
      });
      const fresh2 = acts.startOptions({
          paneId: 'r2',
          agent: 'OpenCode',
          mode: 'run',
          access: 'full',
        }),
        kid = acts.startOptions({
          paneId: 'k1',
          agent: 'OpenCode',
          mode: 'run',
          subagentOf: 'n-r2',
          access: 'full',
        }),
        own = acts.startOptions({
          paneId: 'k2',
          agent: 'OpenCode',
          mode: 'run',
          subagentOf: 'n-own',
          access: 'full',
        }),
        closedOne = acts.startOptions({
          paneId: 'r1',
          agent: 'Claude Code',
          mode: 'run',
          access: 'full',
        });
      check(
        'review 13, 2: after a restart of the app a remotely started panel starts at "Ask first" again, and so does its sub-agent; a closed one and another lead\'s sub-agent keep their level',
        fresh2.options.access === 'ask' &&
          kid.options.access === 'ask' &&
          own.options.access === 'full' &&
          closedOne.options.access === 'full',
        [fresh2.options.access, kid.options.access, own.options.access, closedOne.options.access]
      );
    }
    {
      // The starts of a day (20 per computer in remote-control.js): kept with the record, so a
      // restart of the app does not start the day again.
      const t = Date.now();
      for (let i = 0; i < 3; i++) life.remoteStartNoted('a-1', t - i * 1000);
      life.remoteStartNoted('c-3', t);
      life.remoteStartNoted('a-1', t - 25 * 3600 * 1000); // yesterday's is not counted
      const before = [
        life.remoteStartsToday('a-1'),
        life.remoteStartsToday('c-3'),
        life.remoteStartsToday('zz'),
      ];
      life.flushSaves();
      await new Promise(r => setTimeout(r, 700));
      life.flushSaves();
      life = fresh();
      life.init(() => {}, { root: () => 'C:\\work\\proj', canResume: () => true });
      check(
        "the count of a day's starts is per computer, leaves out what is older than 24 hours, and survives a restart of the app",
        before.join() === '3,1,0' &&
          life.remoteStartsToday('a-1') === 3 &&
          life.remoteStartsToday('c-3') === 1 &&
          life.remoteStartsToday('a-1', t + 25 * 3600 * 1000) === 0,
        [before, life.remoteStartsToday('a-1')]
      );
    }
    {
      // The mark follows the conversation (2026-10-10): past the panel's close, a restart of the
      // app, and the instance being forgotten.
      const asks = [];
      life = fresh();
      life.init(
        (channel, r) => {
          if (channel === 'lifecycle:revive') asks.push(r);
        },
        { root: () => 'C:\\work\\proj', canResume: () => true }
      );
      const openBefore = life.remoteOpen();
      life.spawnRemote('Claude Code', { from: 'Desk', guard: () => true });
      life.remoteTake(asks.at(-1).requestId, 'k1', 'Claude Code');
      life.started({
        paneId: 'k1',
        agent: 'Claude Code',
        name: 'Kite',
        sessionId: 'conv-k1',
        root: 'C:\\work\\proj',
        cwd: 'C:\\work\\proj',
        ownedByUser: true,
      });
      life.started({
        paneId: 'u1',
        agent: 'Claude Code',
        name: 'Own',
        sessionId: 'conv-u1',
        root: 'C:\\work\\proj',
        cwd: 'C:\\work\\proj',
        ownedByUser: true,
      });
      check(
        "mark: a conversation that runs in a remotely started panel is marked, by CLI and id; this computer's own is not",
        life.remoteConversation('Claude Code', 'conv-k1') === true &&
          life.remoteConversation('Claude Code', 'conv-u1') === false &&
          life.remoteConversation('Codex', 'conv-k1') === false &&
          life.remoteConversation('Claude Code', '') === false
      );
      life.session('k1', 'conv-k2');
      check(
        'mark: an id the panel takes later is marked too, and the first one stays marked',
        life.remoteConversation('Claude Code', 'conv-k2') === true &&
          life.remoteConversation('Claude Code', 'conv-k1') === true
      );
      const listed = life.conversations('C:\\work\\proj');
      check(
        'mark: the list of conversations says which were started from another computer',
        listed.find(c => c.id === 'conv-k2')?.remote === true &&
          listed.find(c => c.id === 'conv-u1')?.remote === false &&
          listed.every(c => typeof c.id === 'string' && typeof c.agent === 'string'),
        listed.map(c => [c.id, c.remote])
      );
      life.closed('k1');
      check(
        "mark: closing the panel ends the panel's mark, not the conversation's",
        life.remoteStarted('k1') === false &&
          life.remoteOpen() === openBefore &&
          life.remoteConversation('Claude Code', 'conv-k2') === true
      );
      check(
        'mark: resumed in a new panel, that panel becomes a remotely started one; another conversation or CLI marks nothing',
        life.remoteResumed('n1', 'Claude Code', 'conv-k2') === true &&
          life.remoteStarted('n1') === true &&
          life.remoteOpen() === openBefore + 1 &&
          life.remoteResumed('n2', 'Claude Code', 'conv-u1') === false &&
          life.remoteStarted('n2') === false &&
          life.remoteResumed('n3', 'Codex', 'conv-k2') === false &&
          life.remoteStarted('n3') === false &&
          life.remoteResumed('', 'Claude Code', 'conv-k2') === false
      );
      life.closed('n1');
      life.flushSaves();
      await new Promise(r => setTimeout(r, 700));
      life.flushSaves();
      life = fresh();
      life.init(() => {}, { root: () => 'C:\\work\\proj', canResume: () => true });
      check(
        'mark: it survives a restart of the app',
        life.remoteConversation('Claude Code', 'conv-k1') === true &&
          life.remoteConversation('Claude Code', 'conv-k2') === true &&
          life.remoteConversation('Claude Code', 'conv-u1') === false
      );
      life.clearClosed('C:\\work\\proj', 0);
      check(
        'mark: and the instance being forgotten (cleared, or 7 days old): the id is still marked, so a resume from the list of past conversations is held',
        life.conversations('C:\\work\\proj').length === 0 &&
          life.remoteConversation('Claude Code', 'conv-k2') === true &&
          life.remoteResumed('n4', 'Claude Code', 'conv-k2') === true,
        life.conversations('C:\\work\\proj').length
      );
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* temp */
    }

    // ---- Review 13, finding 3: the flags a remote start of each offered CLI really gets (the real
    // agent-registry.js; no CLI is started) ----
    {
      const registry = require('../desktop/agent-registry.js'),
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-remote-flags-'));
      const rulesFile = path.join(dir, 'work-rules.md'),
        mcpConfig = path.join(dir, 'p.mcp.json');
      fs.writeFileSync(rulesFile, 'rules\n');
      fs.writeFileSync(
        mcpConfig,
        JSON.stringify({
          mcpServers: { tnai: { type: 'http', url: 'http://127.0.0.1:5/mcp/' + 'a'.repeat(32) } },
        })
      );
      const base = {
        accountDir: dir,
        sessionId: '11111111-2222-3333-4444-555555555555',
        workRules: 'Rules.',
        rulesFile,
        rulesPlugin: dir,
        mcpConfig,
      };
      const words = spec =>
        spec.verbatim
          ? String(spec.args[spec.args.length - 1])
              .split(' ')
              .map(x => x.replace(/\^/g, '').replace(/^"+|"+$/g, ''))
          : spec.args.map(String);
      const forced = cli =>
        createRemoteActions({
          ptys: { list: () => [] },
          mesh: {},
          lifecycle: {
            remoteTake: () => ({ from: 'Desk', guard: () => true }),
            remoteStarted: () => false,
          },
          turns: {},
          attention: {},
          submit: async () => null,
          abort: async () => null,
          panelKey: async () => '',
        }).startOptions({ paneId: 'new', agent: cli, mode: 'run', access: 'full', remote: 'mark' })
          .options;
      for (const cli of STARTABLE) {
        const o = forced(cli);
        let spec = null,
          why = '';
        try {
          spec = await registry.spec(cli, 'run', { ...base, access: o.access });
        } catch (e) {
          why = String(e.message || e);
        }
        if (!spec) {
          check(
            'review 13, 3: (' +
              cli +
              ' is not installed on this computer, so its launch line cannot be built here: ' +
              why +
              ')',
            /not installed|not on PATH/.test(why),
            why
          );
          continue;
        }
        const w = words(spec),
          conf = (() => {
            try {
              return JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT || 'null');
            } catch {
              return null;
            }
          })();
        if (cli === 'Claude Code')
          check(
            'review 13, 3: a remote start of Claude Code gets --permission-mode manual, and none of the wider modes',
            w[w.indexOf('--permission-mode') + 1] === 'manual' &&
              w.filter(x => x === '--permission-mode').length === 1 &&
              !w.some(x => /bypassPermissions|acceptEdits|dangerously/.test(x)),
            w.filter(x => /permission|danger/.test(x))
          );
        if (cli === 'OpenCode')
          check(
            'review 13, 3: a remote start of OpenCode gets no --auto and a session config in which edits ask and every command asks but the read-only tnai ones',
            !w.includes('--auto') &&
              conf &&
              conf.permission &&
              conf.permission.edit === 'ask' &&
              conf.permission.bash['*'] === 'ask' &&
              Object.entries(conf.permission.bash).every(
                ([k, v]) => v === 'ask' || (v === 'allow' && /^tnai /.test(k))
              ),
            conf && conf.permission
          );
        if (cli === 'OpenCode') {
          const again = await registry.spec(cli, 'run', {
              ...base,
              sessionId: '',
              resumeId: 'ses_1',
              access: 'ask',
            }),
            c2 = JSON.parse(again.env.OPENCODE_CONFIG_CONTENT || 'null');
          check(
            'review 13, 2: a resumed OpenCode conversation gets those rules again (so its resume is allowed)',
            !!c2 &&
              c2.permission &&
              c2.permission.edit === 'ask' &&
              c2.permission.bash['*'] === 'ask'
          );
        }
        if (cli === 'Claude Code') {
          const again = words(
            await registry.spec(cli, 'run', {
              ...base,
              sessionId: '',
              resumeId: 'conv-1',
              access: 'ask',
            })
          );
          check(
            'review 13, 2: an ordinary resumed Claude Code conversation gets no level from the registry, whatever access says',
            !again.includes('--permission-mode') && again.includes('--resume'),
            again.filter(x => /permission|resume/.test(x))
          );

          // The held resume (2026-10-10): askOnResume puts "Ask first" on the resume, before
          // --resume, whatever access says.
          const held = words(
            await registry.spec(cli, 'run', {
              ...base,
              sessionId: '',
              resumeId: 'conv-1',
              access: 'full',
              askOnResume: true,
            })
          );
          check(
            'resume: with askOnResume the registry sends --permission-mode manual on a Claude Code resume, once, before --resume, and no wider mode',
            held[held.indexOf('--permission-mode') + 1] === 'manual' &&
              held.filter(x => x === '--permission-mode').length === 1 &&
              held.indexOf('--permission-mode') < held.indexOf('--resume') &&
              !held.some(x => /bypassPermissions|acceptEdits|dangerously/.test(x)),
            held.filter(x => /permission|resume|danger/.test(x))
          );
          const freshStart = words(
            await registry.spec(cli, 'run', { ...base, access: 'full', askOnResume: true })
          );
          check(
            'resume: askOnResume changes nothing for a start that resumes nothing',
            freshStart[freshStart.indexOf('--permission-mode') + 1] === 'bypassPermissions',
            freshStart.filter(x => /permission/.test(x))
          );
        }
      }
      let codex = null;
      try {
        codex = words(await registry.spec('Codex', 'run', { ...base, access: 'ask' }));
      } catch {
        /* not installed */
      }
      if (codex)
        check(
          'review 13, 3: why Codex is not offered: its "Ask first" is -a on-request with no sandbox flag',
          codex.includes('on-request') && !codex.includes('-s') && !codex.includes('--sandbox'),
          codex.filter(x => /^-a$|on-request|^-s$|sandbox/.test(x))
        );
      let codexHeld = '',
        codexThere = !!codex;
      try {
        await registry.spec('Codex', 'run', {
          ...base,
          sessionId: '',
          resumeId: 'ses-x',
          askOnResume: true,
        });
      } catch (e) {
        codexHeld = String(e.message || e);
      }
      if (codexThere)
        check(
          'resume: the registry starts no held resume for a CLI that cannot take the level on a resume',
          /cannot be held to "Ask first"/.test(codexHeld),
          codexHeld
        );
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* temp */
      }
    }

    // ---- the real roster: one interrupt count for a remote interrupt and `tnai intervene` ----
    Module._load = function (reqName, ...rest) {
      return reqName === 'electron'
        ? { app: { getPath: () => tmp, on: () => {}, whenReady: () => new Promise(() => {}) } }
        : realLoad.call(this, reqName, ...rest);
    };
    let mesh;
    try {
      mesh = require('../desktop/agent-mesh.js');
    } finally {
      Module._load = realLoad;
    }
    const left0 = mesh.interruptLeft('pane-x');
    mesh.interruptedNow('pane-x');
    const left1 = mesh.interruptLeft('pane-x'),
      other = mesh.interruptLeft('pane-y');

    // the same list `tnai intervene` keeps (mesh-commands-check.js clears it this way)
    mesh._test.forgetIntervened();
    check(
      "21: the two-minute count is agent-mesh.js's own list, the one `tnai intervene` reads and writes: counted per agent, and cleared with it",
      left0 === 0 &&
        left1 > 119000 &&
        left1 <= 120000 &&
        other === 0 &&
        mesh.interruptLeft('pane-x') === 0,
      [left0, left1, other]
    );
  }

  console.log(
    `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
  );
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.log('ERROR ' + (e.stack || e));
  process.exit(1);
});

/*
 * Technically Not tools · desktop-check/tests/main-stalls-profile.main.js — Main-process side of
 * main-stalls-profile.js: the fake agent CLIs of agent-mesh.main.js (no credits), an ordinary flow
 * of hook events, turns and file writes, and a CPU profile of the main process. The profile is
 * read for busy stretches: runs of samples with no idle between them that last 80 ms or more,
 * which is what stalls.log reports as a stall (a 250 ms timer fired over 100 ms late). Each
 * stretch is printed with its time, what kind of work filled it and the functions in it. The raw
 * profile is kept in %TEMP%\tnai-stall-profile\ to open in DevTools.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const inspector = require('inspector');
const { app } = require('electron');
const hooks = require('../../../desktop/agent-hooks');
const files = require('../../../desktop/fs-service');

// the busy stretches are found by the same code that names stalls in a dev run
const { busyStretches } = require('../../../desktop/stall-profile');

const post = (session, method, params) =>
  new Promise((resolve, reject) =>
    session.post(method, params || {}, (err, res) => (err ? reject(err) : resolve(res)))
  );

module.exports = (win, profile) => {
  const fakes = require('./agent-mesh.main.js')(win, profile);
  const session = new inspector.Session();
  let startedAt = 0;
  const timers = [];
  return {
    ...fakes,

    // An ordinary flow for `ms`: a tool event per agent every 300 ms, a turn every second, a
    // project file rewritten every 500 ms.
    flow(paneIds, ms) {
      const root = files.root();
      const started = Date.now() - 5000;
      const tools = ['Read', 'Edit', 'Bash', 'Grep'];
      let count = 0;
      timers.push(
        setInterval(() => {
          count++;
          paneIds.forEach((paneId, index) =>
            hooks.note(paneId, {
              kind: 'tool',
              tool: tools[(count + index) % 4],
              detail: root + '/src/file-' + ((count + index) % 7) + '.js',
            })
          );
        }, 300)
      );
      timers.push(
        setInterval(
          () =>
            paneIds.forEach(paneId =>
              win.webContents.send('agent:turn', {
                paneId,
                agent: 'Claude Code',
                source: 'claude-transcript',
                startedAt: started,
                endedAt: 0,
                endedBy: '',
                tokens: { input: 1000 + count, cacheWrite: 500, output: 2000 + count * 10 },
                queued: [],
              })
            ),
          1000
        )
      );
      timers.push(
        setInterval(() => {
          try {
            fs.writeFileSync(path.join(root, 'src', 'gen-' + (count % 5) + '.js'), '// ' + count);
          } catch {}
        }, 500)
      );
      setTimeout(() => timers.splice(0).forEach(clearInterval), ms);
      return true;
    },

    async profileStart() {
      session.connect();
      await post(session, 'Profiler.enable');
      await post(session, 'Profiler.setSamplingInterval', { interval: 1000 });
      await post(session, 'Profiler.start');
      startedAt = Date.now();
      return startedAt;
    },

    async profileStop() {
      const { profile: cpu } = await post(session, 'Profiler.stop');
      session.disconnect();
      timers.splice(0).forEach(clearInterval);
      const dir = path.join(os.tmpdir(), 'tnai-stall-profile');
      fs.mkdirSync(dir, { recursive: true });
      const saved = path.join(dir, 'main-' + startedAt + '.cpuprofile');
      fs.writeFileSync(saved, JSON.stringify(cpu));
      let stallLines = [];
      try {
        stallLines = fs
          .readFileSync(path.join(app.getPath('userData'), 'stalls.log'), 'utf8')
          .split('\n')
          .filter(Boolean);
      } catch {}
      return { saved, stalls: stallLines, ...busyStretches(cpu, startedAt) };
    },
  };
};

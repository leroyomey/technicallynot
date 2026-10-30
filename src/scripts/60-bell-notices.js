/*
 * Technically Not · 60-bell-notices.js — Desktop app: turns real checks into top-bar bell notices
 * (TnaiNextActions.notify, 51), each pushed, never polled here:
 * - Technically Not update: desktop/updater.js state (`update:state`) says a new version is
 * available / downloaded, and "Notify me" is on (Settings › Updates); gone once current.
 * - Agent CLI updates: desktop/cli-updates.js (`cli-updates:state`; npm registry vs `<cli>
 * --version`, 90 s after start and every 6 h) per installed CLI, with its own update command.
 * - A skill an agent saved (`skills:saved` from desktop/skill-service.js): one notice per skill
 * until the user opened it on the Skills page (18).
 */
(() => {
  const native = window.tnaiNative,
    bell = window.TnaiNextActions;
  if (!native || !bell?.notify) return;

  // Technically Not itself: the bell is the only place an update shows (36 keeps Settings ›
  // Updates); it stays until it is handled. Every update notice says only 'current → new' and
  // carries the Update button itself: no dialog to click into.
  if (native.update) {
    const onUpdate = s => {
      if (!s) return;
      const name =
        'Technically Not ' + s.next + (s.nextBuild ? ' (build ' + s.nextBuild + ')' : '');
      if (!['available', 'downloading', 'ready'].includes(s.status)) {
        if (['current', 'unconfigured', 'dev', 'off', 'manual'].includes(s.status))
          bell.unnotify('tnai-update');
        return;
      }
      if (s.prefs?.notify === false) return bell.unnotify('tnai-update');
      const ready = s.status === 'ready',
        downloading = s.status === 'downloading';
      bell.notify({
        key: 'tnai-update',
        source: 'Technically Not',
        tag: 'Update',
        k: 'update',
        title:
          name +
          (ready
            ? ' is ready'
            : downloading
              ? ' is downloading' + (s.percent ? ' · ' + s.percent + '%' : '')
              : ' is available'),
        text: 'v' + s.version + ' → v' + s.next,
        action: downloading
          ? null
          : {
              label: ready ? 'Restart to update' : 'Update',
              run: () =>
                window.TnaiUpdates?.updateNow
                  ? window.TnaiUpdates.updateNow()
                  : window.TnaiSettings?.open?.('updates'),
            },
      });
    };
    native.update.onState(onUpdate);
    native.update
      .state()
      .then(onUpdate)
      .catch(() => {});
  }

  // Installed agent CLIs with a newer release. Update runs the CLI's own update command in a new
  // PowerShell panel on the Terminal page (visible, so its output and any prompt stay in front of
  // the user). Windows locks a running CLI's files, so that CLI's idle panels are stopped first and
  // resumed (same conversation) afterwards; while one is working the update waits. A printed end
  // marker tells Technically Not it finished (independent of the user's prompt style), then
  // cli-updates.js checks again so the notice clears. The panel was opened only to run the update,
  // so it closes itself when the update succeeds; on a failure or no end marker it stays open with
  // the output.
  if (native.cliUpdates) {
    let shown = new Set(),
      last = [],
      shownBroken = new Set(),
      lastBroken = [];
    const updating = new Set();
    const ANSI =
        /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g,
      DONE = /Technically Not update finished - exit code (-?\d+)/;
    const agents = () => window.TnaiAgents;
    const runUpdate = async u => {
      if (updating.has(u.id) || !agents()) return;
      const mine = agents()
        .sessions()
        .filter(s => s.agent === u.id && (s.running || s.status === 'starting'));
      const busy = mine.filter(s => ['working', 'starting'].includes(s.status));
      if (busy.length)
        return window.toast?.(
          u.id +
            ' is working in ' +
            busy.length +
            (busy.length === 1 ? ' panel' : ' panels') +
            '. Update when it finishes' +
            (window.tnaiPlatform.win ? ': Windows can’t replace a CLI that is running.' : '.')
        );
      updating.add(u.id);
      onCli({ updates: last, broken: lastBroken });

      // subscribed before the panel opens, so PowerShell's first prompt is never missed
      const tails = new Map();
      let paneId = '',
        sent = false,
        finished = null;
      const off = native.pty.onData(({ paneId: id, data }) => {
        // every agent's output passes here: only the update panel's is read once it is known
        if (paneId && id !== paneId) return;
        const tail = ((tails.get(id) || '') + String(data).replace(ANSI, '')).slice(-1024);
        tails.set(id, tail);
        if (sent && id === paneId && DONE.test(tail)) finished?.(Number(tail.match(DONE)[1]));
      });
      const end = async code => {
        off();
        updating.delete(u.id);

        // Over the time limit the install may still be replacing the CLI's files: its panels
        // stay stopped instead of starting on half a CLI (audit app-5 #11).
        if (code === 'timeout') {
          window.toast?.(
            u.id +
              ' is still updating after 15 minutes. Its panels stay stopped: start them again when the update in the Terminal panel has finished.'
          );
          onCli({ updates: last, broken: lastBroken });
          return;
        }
        for (const s of mine)
          await agents()
            .restart(s.paneId, { resume: true })
            .catch(() => {});
        if (mine.length)
          window.toast?.(
            'Restarted ' +
              mine.length +
              ' ' +
              u.id +
              (mine.length === 1 ? ' panel' : ' panels') +
              ' on the updated version, same conversation.'
          );
        if (code === 0)
          document
            .querySelector(
              '.terminal-pane[data-pane-id="' +
                CSS.escape(paneId) +
                '"] .terminal-pane-tools button[title="Close terminal"]'
            )
            ?.click();
        else if (code !== undefined)
          window.toast?.(
            u.id + ' update ended with exit code ' + code + '. Its output is in the Terminal panel.'
          );
        const after = await native.cliUpdates.check?.().catch(() => null);
        onCli(after || { updates: last, broken: lastBroken });

        // The update ran, but the CLI no longer starts (a download cut short): said plainly, with
        // the repair on its bell notice (onCli), never left to look installed.
        const broken = after?.broken?.find(b => b.id === u.id);
        if (broken)
          window.toast?.(
            u.id +
              ' does not start after the update: ' +
              broken.problem +
              '. Press Reinstall on its bell notice' +
              (broken.command ? ' (runs ' + broken.command + ').' : '.')
          );
      };

      // A stop or open that fails ends the update the same way (panels restarted, notice back),
      // never leaving "is updating…" for good (audit app-5 #11).
      let opened = null;
      try {
        for (const s of mine) await agents().stop(s.paneId);
        opened = await agents().open('Terminal');
      } catch (error) {
        window.toast?.('Could not update ' + u.id + ': ' + (error?.message || error));
        return end();
      }
      if (!opened?.ok) {
        window.toast?.('Could not open a thread' + (opened?.error ? ': ' + opened.error : '.'));
        return end();
      }
      paneId = opened.paneId;

      // PowerShell on Windows, a POSIX shell (zsh / bash) on macOS and Linux
      const win = window.tnaiPlatform.win;

      // Wait for the shell's first prompt so the command isn't typed into a console that is still
      // starting.
      const until = Date.now() + 8000;
      while (Date.now() < until && !(win ? />\s*$/ : /[$#%>❯]\s*$/).test(tails.get(paneId) || ''))
        await new Promise(r => setTimeout(r, 50));
      tails.set(paneId, '');
      const code = new Promise(resolve => {
        finished = resolve;
        setTimeout(() => resolve('timeout'), 15 * 60 * 1000);
      });
      sent = true;
      agents().send(
        paneId,
        u.command +
          (win
            ? "; Write-Host ('Technically Not update finished - exit code ' + $LASTEXITCODE)"
            : '; printf \'Technically Not update finished - exit code %s\\n\' "$?"')
      );
      end(await code);
    };

    function onCli(s) {
      last = s?.updates || [];
      const now = new Set();
      for (const u of last) {
        now.add(u.id);
        const busy = updating.has(u.id);
        bell.notify({
          key: 'cli:' + u.id,
          source: u.id,
          tag: 'Update',
          k: 'update',
          title: u.id + ' ' + u.latest + (busy ? ' is updating…' : ' is available'),
          text: u.installed + ' → ' + u.latest,
          action: busy ? null : { label: 'Update', run: () => runUpdate(u) },
        });
      }
      for (const id of shown) if (!now.has(id)) bell.unnotify('cli:' + id);
      shown = now;

      // CLIs on PATH that do not start (cli-updates.js `broken`): their repair runs the same way as
      // an update, in a visible panel.
      lastBroken = s?.broken || [];
      const nowBroken = new Set();
      for (const b of lastBroken) {
        nowBroken.add(b.id);
        const busy = updating.has(b.id);
        bell.notify({
          key: 'cli-broken:' + b.id,
          source: b.id,
          tag: 'Update',
          k: 'update',
          title: b.id + (busy ? ' is being reinstalled…' : ' install is incomplete'),
          text: b.id + ' is on this PC, but ' + b.problem + '.',
          action:
            busy || !b.command
              ? null
              : { label: 'Reinstall', run: () => runUpdate({ ...b, latest: '' }) },
        });
      }
      for (const id of shownBroken) if (!nowBroken.has(id)) bell.unnotify('cli-broken:' + id);
      shownBroken = nowBroken;
    }
    native.cliUpdates.onState(onCli);
    native.cliUpdates
      .state()
      .then(s => s?.checkedAt && onCli(s))
      .catch(() => {});
  }

  // A skill an agent saved (`tnai skill save`; desktop/skill-service.js pushes `skills:saved`) is
  // on for every session at once, so the user is told:
  // one notice per skill until its details were opened on the Skills page, which also
  // carries the "New · agent-written" mark (18 keeps which ones are unopened, across restarts).
  // Open goes to that skill.
  const ui = window.TnaiSkillsUI,
    lib = window.TnaiSkills;
  if (native.skills?.onSaved && ui?.agentSaved && lib?.onChange) {
    let told = new Set();
    const openIt = id => {
      document.querySelector('.side-item[data-ai-tool="skills"]')?.click();
      ui.select(id);
    };
    const sync = () => {
      const now = new Set();
      for (const k of lib.list() || []) {
        if (!ui.isAgentNew(k)) continue;
        now.add(k.id);
        bell.notify({
          key: 'skill-saved:' + k.id,
          source: 'Skills',
          tag: 'Skill',
          k: 'next',
          title: 'An agent saved the skill “' + k.name + '”',
          text:
            (k.everywhere ? 'It loads in every new session. ' : '') +
            'Open it to read it, switch it off or remove it.',
          action: { label: 'Open', run: () => openIt(k.id) },
        });
      }
      for (const id of told) if (!now.has(id)) bell.unnotify('skill-saved:' + id);
      told = now;
    };
    lib.onChange(sync);
    window.addEventListener('tnai:agent-skill-opened', sync);
    native.skills.onSaved(s => {
      if (!s?.id) return;

      // saved again: a notice the user closed for the earlier version comes back
      bell.unnotify('skill-saved:' + s.id);
      ui.agentSaved(s.id);
      Promise.resolve(lib.refresh()).catch(() => {}); // the library list now holds it → sync
    });
    sync();
  }

  // A custom agent an agent proposed from the user's words (`tnai agent save`;
  // desktop/agent-proposals.js pushes `agentProposals:changed`): one notice per proposal, with
  // what changes (the role before and after in full) and Accept / Decline. Accept saves it through
  // 17's custom agent API, the same path as Settings › Agents › Custom agents; nothing changes
  // before that. ✕ only hides it until the next start; it still waits there.
  const proposals = native.agentProposals,
    custom = window.TnaiCustomAgents;
  if (proposals?.list && custom?.create) {
    let shownProposals = new Set();
    const toast = message =>
      typeof window.toast === 'function' ? window.toast(message) : console.info(message);
    const skillWord = ids =>
      ids.length ? ids.map(id => String(id).split('/').pop()).join(', ') : 'none';

    const describe = p => {
      const a = p.after,
        b = p.before,
        lines = [];
      if (!b) {
        lines.push(
          'On ' + a.base + (p.scope === 'project' ? ', kept in this project.' : ', personal.')
        );
        lines.push('Role: ' + (a.role || '(none)'));
        lines.push('Skills: ' + skillWord(a.skillIds));
      } else {
        if (b.name !== a.name) lines.push('Name: ' + b.name + ' → ' + a.name);
        if (b.role !== a.role) {
          lines.push('Role now: ' + (b.role || '(none)'));
          lines.push('Role after: ' + (a.role || '(none)'));
        }
        const added = a.skillIds.filter(id => !b.skillIds.includes(id)),
          removed = b.skillIds.filter(id => !a.skillIds.includes(id));
        if (added.length) lines.push('Skills added: ' + skillWord(added));
        if (removed.length) lines.push('Skills removed: ' + skillWord(removed));
      }
      return lines.concat(p.notes || []).join('\n');
    };

    // The agent as it is now must still be what the proposal was made from: a change the user
    // made since then is never overwritten.
    async function accept(p) {
      await custom.refresh();
      const a = p.after;
      if (p.kind === 'new') {
        await custom.create({
          name: a.name,
          base: a.base,
          role: a.role,
          skillIds: a.skillIds,
          scope: p.scope,
        });
      } else {
        const now = custom.get(p.targetId);
        if (!now) throw new Error(p.before.name + ' no longer exists.');
        const b = p.before;
        const same = (x, y) => JSON.stringify([...x].sort()) === JSON.stringify([...y].sort());
        if (now.name !== b.name || (now.role || '') !== b.role || !same(now.skillIds, b.skillIds))
          throw new Error(
            now.name + ' was changed since this was proposed. Ask the agent to propose it again.'
          );
        if (a.name !== b.name) await custom.rename(p.targetId, a.name);
        if (a.role !== b.role) await custom.update(p.targetId, { role: a.role });
        const added = a.skillIds.filter(id => !b.skillIds.includes(id)),
          removed = b.skillIds.filter(id => !a.skillIds.includes(id));
        if (added.length) await custom.attach(p.targetId, added);
        if (removed.length) await custom.detach(p.targetId, removed);
      }
      await proposals.settle(p.id, 'accepted');
      toast(
        (p.kind === 'new' ? 'Saved the custom agent ' : 'Saved the change to ') +
          a.name +
          (p.kind === 'new' ? '' : '; a running copy picks it up on its next start')
      );
    }

    const decline = async p => {
      await proposals.settle(p.id, 'declined');
      toast('Declined the proposal for ' + (p.before?.name || p.after.name));
    };
    const run = (fn, p) => () =>
      fn(p).catch(error => toast('Not saved: ' + (error?.message || 'unknown error')));

    const syncProposals = async () => {
      let list;
      try {
        const result = await proposals.list();
        if (!result?.ok) return;
        list = result.value || [];
      } catch {
        return;
      }
      const now = new Set();
      for (const p of list) {
        now.add(p.id);
        bell.notify({
          key: 'agent-proposal:' + p.id,
          source: 'Custom agents',
          tag: 'Proposal',
          k: 'next',
          full: true,
          title:
            p.kind === 'new'
              ? p.by + ' proposes a new custom agent “' + p.after.name + '”'
              : p.by + ' proposes a change to “' + p.before.name + '”',
          text: describe(p),
          actions: [
            { id: 'accept', label: 'Accept', primary: true, run: run(accept, p) },
            { id: 'decline', label: 'Decline', run: run(decline, p) },
          ],
        });
      }
      for (const id of shownProposals) if (!now.has(id)) bell.unnotify('agent-proposal:' + id);
      shownProposals = now;
    };
    proposals.onChanged?.(syncProposals);

    // another project opened: its own proposals show, the other project's leave
    window.addEventListener('tnai:custom-agents-changed', syncProposals);
    syncProposals();
  }
})();

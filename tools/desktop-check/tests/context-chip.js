// Technically Not tools · desktop-check/tests/context-chip.js — The context chip under the prompt
// box (src/scripts/168-context-chip.js), in the real app with a throwaway profile. No agent CLI
// starts: a plain Terminal thread is opened, and the size the CLI would report is a stand-in given
// to 76's `TnaiContextWarning.level` for that thread only (the stand-in calls it Claude Code). A
// press goes to a stand-in for 54's `compactNow`, so nothing is typed into a terminal.
// Proven here: hidden without a size; past the amber share it is one chip right before "↵ send",
// inside the row, on one line, not over another part of the row, in Dark and Light, at 1440, at the
// smallest window and in a low window; a press asks for the compact of that thread once; while the
// agent works it takes no press; another page hides it. Pictures: context-chip-(wide|small|low)-
// (dark|light). Run: .\tools\desktop-check\check.ps1 -Test context-chip
const log = [],
  t = (name, pass, extra) => {
    log.push((pass ? 'ok   ' : 'FAIL ') + name + (extra ? ' · ' + extra : ''));
    return pass;
  };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = result => {
      delete window.__tnaiMainDone[id];
      result?.ok ? resolve(result.value) : reject(new Error(result?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const box = node => node.getBoundingClientRect();
const chip = () => document.querySelector('.composer .hints > .tnai-ctx-chip');
const shown = () => !!chip() && !chip().hidden && chip().getClientRects().length > 0;
const settle = async () => {
  window.TnaiContextChip.paint();
  await wait(250);
};

// The stand-ins: a size for one thread, and the compact it would ask for.
const warning = window.TnaiContextWarning;
const upkeep = window.TnaiContextUpkeep;
const realLevel = warning?.level;
const realCompact = upkeep?.compactNow;
const asked = [];
let size = null,
  status = 'idle',
  standInPane = '';

try {
  t('the chip script is loaded', !!window.TnaiContextChip);
  const started = await window.TnaiTest.startThread({ tool: 'Terminal', show: true });
  standInPane = started.paneId;
  warning.level = paneId => {
    if (paneId !== standInPane || !size) return realLevel(paneId);
    const session = window.TnaiAgents.sessions().find(item => item.paneId === paneId);
    return { s: { ...session, agent: 'Claude Code', status, name: 'Kestrel' }, ...size };
  };
  if (upkeep)
    upkeep.compactNow = (paneId, typed) => {
      asked.push([paneId, typed]);
      return true;
    };
  await settle();
  t('a thread with no known size shows no chip', !shown());

  size = { tokens: 142000, win: 200000, pct: 71, lv: 'warn' };
  for (const [view, width, height] of [
    ['wide', 1440, 900],
    ['small', 1024, 700],
    ['low', 1280, 600],
  ]) {
    await main('size', width, height);
    for (const look of ['dark', 'light']) {
      window.TnaiTheme?.set(look);
      await wait(300);
      await settle();
      const node = chip(),
        row = node?.parentElement;
      const at = view + ' ' + look;
      t(at + ': the chip is shown', shown());
      if (!node || !row) continue;
      t(
        at + ': it reads "142k of 200k · Compact"',
        /142k of 200k · Compact/.test(node.textContent)
      );
      const next = node.nextElementSibling;
      t(at + ': it stands right before "↵ send"', !!next && /send/.test(next.textContent));
      const own = box(node),
        line = box(row);
      t(
        at + ': inside the row and on one line',
        own.left >= line.left - 0.5 &&
          own.right <= line.right + 0.5 &&
          own.height <= 24 &&
          node.scrollWidth <= node.clientWidth + 1,
        [own.left, own.right, own.height, line.left, line.right].map(Math.round).join(',')
      );
      const others = [...row.children].filter(
        part => part !== node && part.getClientRects().length && !part.hidden
      );
      const over = others.find(part => {
        const other = box(part);
        return other.width > 0 && other.left < own.right - 0.5 && other.right > own.left + 0.5;
      });
      t(at + ': nothing else of the row lies over it', !over, over?.className || '');
      t(
        at + ': amber, from the status token',
        getComputedStyle(node).borderColor !== 'rgba(0, 0, 0, 0)'
      );
      await window.TnaiTest?.shot?.('context-chip-' + view + '-' + look);
    }
  }
  window.TnaiTheme?.set('dark');
  await main('size', 1440, 900);
  await settle();

  // The narrowest place the row can stand (a thread beside a wide side column is about 420 px):
  // the row is squeezed from the left as composer-layout does. The chip stays whole, inside the
  // row, and nothing of the row lies over it at any step.
  {
    const node = chip(),
      row = node?.parentElement;
    const bad = [];
    if (node && row) {
      const full = box(row).width;
      for (let pad = 0; pad <= full - 420; pad += 40) {
        row.style.paddingLeft = pad + 'px';
        await wait(160);
        if (!shown()) {
          bad.push(pad + 'px: chip gone');
          continue;
        }
        const own = box(node),
          line = box(row);
        if (node.scrollWidth > node.clientWidth + 1) bad.push(pad + 'px: chip cut');
        if (own.right > line.right + 0.5) bad.push(pad + 'px: chip past the row');
        for (const part of row.querySelectorAll(':scope > *, :scope .tnai-pick')) {
          if (part === node || !part.getClientRects().length) continue;
          const other = box(part);
          if (other.width > 0 && other.left < own.right - 0.5 && other.right > own.left + 0.5)
            bad.push(pad + 'px: over "' + part.textContent.trim().slice(0, 16) + '"');
        }
        if (bad.length) {
          await window.TnaiTest?.shot?.('context-chip-narrow');
          break;
        }
      }
      row.style.paddingLeft = '';
      await wait(160);
    }
    t(
      'squeezed down to a 420 px row the chip stays whole and nothing lies over it',
      !bad.length,
      bad.join('; ')
    );
  }

  chip()?.click();
  await wait(100);
  t(
    'a press asks for the compact of that thread, once, with "/compact"',
    asked.length === 1 && asked[0][0] === standInPane && asked[0][1] === '/compact',
    JSON.stringify(asked)
  );

  status = 'working';
  await settle();
  t(
    'while the agent works the chip is shown and takes no press',
    chip()?.getAttribute('aria-disabled') === 'true'
  );
  chip()?.click();
  await wait(100);
  t('a press while it works asks for nothing', asked.length === 1);
  status = 'idle';

  size = { tokens: 60000, win: 200000, pct: 30, lv: '' };
  await settle();
  t('below the amber share it is hidden again', !shown());

  size = { tokens: 142000, win: 200000, pct: 71, lv: 'warn' };
  window.TnaiRoute?.('settings');
  await wait(500);
  await settle();
  t('another page: no chip', !shown());
  window.TnaiThreads?.open?.();
  await wait(400);
} catch (error) {
  t('threw: ' + error.message, false);
} finally {
  if (warning && realLevel) warning.level = realLevel;
  if (upkeep && realCompact) upkeep.compactNow = realCompact;
}
return { ok: log.every(line => line.startsWith('ok')), log };

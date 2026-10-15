// Technically Not tools · desktop-check/tests/composer-layout.js — Composer layout with several
// screenshots attached and a long prompt, on the Threads page and on every page of the three-dots
// menu that shows the prompt box: the chips sit on their own row above the text, the text box
// keeps its width, New agent's "Own worktree" stays in the picker row and is never drawn over a
// key hint when that row is full. Screenshots desktop-composer-*.png. Moved 2026-10-14 from the
// old Overview and Agents pages (pressed through the old navigation) to the Threads page and the
// pages opened by their own route. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(700);
};
try {
  const A = window.TnaiAttachments,
    prompt = document.getElementById('prompt'),
    box = document.querySelector('.composer .composebox');
  const png = (w, h, color) =>
    new Promise(r => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.fillRect(6, 6, w / 2, h / 4);
      c.toBlob(r, 'image/png');
    });
  const files = [];
  for (const [i, c] of ['#2a2440', '#403060', '#305040', '#503030'].entries())
    files.push(
      new File([await png(320, 200, c)], 'Screenshot 2026-09-30-15140' + i + '.png', {
        type: 'image/png',
      })
    );
  A.add(files);
  await wait(300);
  const chips = () => [...document.querySelectorAll('#attachmentList .attachment-chip')];
  const measure = page => {
    const list = document.getElementById('attachmentList').getBoundingClientRect(),
      p = prompt.getBoundingClientRect(),
      b = box.getBoundingClientRect();
    const tops = [...new Set(chips().map(c => Math.round(c.getBoundingClientRect().top)))];
    check(chips().length === 4, page + ': 4 chips');
    check(tops.length === 1, page + ': chips on one row (' + tops.length + ' rows)');
    check(
      list.bottom <= p.top + 1,
      page +
        ': chips above the text (list bottom ' +
        Math.round(list.bottom) +
        ', text top ' +
        Math.round(p.top) +
        ')'
    );
    check(
      p.width >= b.width * 0.45,
      page +
        ': text box keeps its width (' +
        Math.round(p.width) +
        ' of ' +
        Math.round(b.width) +
        ')'
    );
    check(list.right <= b.right + 1, page + ': chips stay inside the box');
  };
  const setText = t => {
    prompt.value = t;
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // Each page is opened the way the three-dots menu opens it: the Threads page by its own call,
  // Usage as a tab of Settings, the others by their route.
  const openPage = {
    threads: () => window.TnaiThreads.open(),
    usage: () => window.TnaiSettings.open('usage'),
    'live-preview': () => window.TnaiRoute('live-preview'),
    skills: () => window.TnaiRoute('skills'),
    settings: () => window.TnaiRoute('settings'),
  };
  for (const view of Object.keys(openPage)) {
    openPage[view]();
    await wait(600);
    const br = box.getBoundingClientRect();
    if (!br.width || !br.height) {
      log.push('skip ' + view + ': no composer on this page');
      continue;
    }
    setText('');
    await wait(150);
    measure(view + ' empty');
    await shot('composer-' + view + '-chips');
    setText('Notice the chat box issues that I am seeing, a lot of padding issues. '.repeat(6));
    await wait(200);
    measure(view + ' long text');
    await shot('composer-' + view + '-long');

    // A row with no room (the fit rule; fit-sizes found the route hint cut to "Chosen → Sol · Ter…"
    // and "Access" drawn over "Ctrl+K commands" in a 768 px window, 2026-10-06): the route hint
    // leaves whole, then the two low key hints, and all come back. (The old Overview was left out
    // here, its hint ended in "…" by design; that page is gone.)
    const fitRow = document.querySelector('.composer .hints'),
      rh = fitRow?.querySelector(':scope>.tnai-route-hint'),
      pk = fitRow?.querySelector(':scope>.tnai-pickers');
    if (fitRow && rh && pk) {
      const vis = el => el.getClientRects().length > 0,
        state = () =>
          (vis(rh) ? 'hint' : 'no hint') +
          (fitRow.classList.contains('tnai-fit-keys') ? ', keys out' : ', keys in');
      const bad = [],
        seen = [],
        state0 = state();
      for (let pad = 0; pad <= 360; pad += 20) {
        fitRow.style.paddingLeft = pad + 'px';
        await wait(160);
        if (seen[seen.length - 1] !== state()) seen.push(state());
        if (vis(rh) && rh.textContent.length <= 46 && rh.scrollWidth > rh.clientWidth + 1)
          bad.push(pad + 'px: route hint cut (' + rh.clientWidth + '/' + rh.scrollWidth + ')');
        const last = [...pk.children].filter(vis).pop()?.getBoundingClientRect();
        for (const h of fitRow.querySelectorAll(':scope>.hint')) {
          const r = h.getBoundingClientRect();
          if (last && r.width && r.left < last.right - 1 && r.right > last.left + 1)
            bad.push(
              pad +
                'px: pickers over "' +
                h.textContent.trim().slice(0, 18) +
                '" by ' +
                Math.round(last.right - r.left) +
                'px'
            );
        }
        if (bad.length) {
          await shot('composer-' + view + '-fit-row');
          break;
        }

        // further in, the 640 px step of the real row takes over
        if (fitRow.classList.contains('tnai-fit-keys')) break;
      }
      fitRow.style.paddingLeft = '';
      await wait(200);
      check(
        !bad.length,
        view +
          ': a squeezed hint row cuts and covers nothing (' +
          seen.join(' → ') +
          ')' +
          (bad.length ? ' ' + bad.join('; ') : '')
      );
      check(
        state() === state0,
        view +
          ': the hint row is as before once it has room again (' +
          state0 +
          ' → ' +
          state() +
          ')'
      );
    }
    document.querySelector('.composebox .tnai-new-agent')?.click();
    await wait(250);
    window.dispatchEvent(new Event('tnai:new-agent-changed'));
    await wait(100); // 35 puts its box into the pickers on this event
    const wt = document.querySelector('.composer .wt-compose');

    // The sample project is not a git repo, so 35 keeps the box hidden; show it for the layout
    // check only.
    const forced = wt && wt.hidden;
    if (forced) wt.hidden = false;
    await wait(100);
    if (wt) {
      const w = wt.getBoundingClientRect(),
        b = box.getBoundingClientRect();
      check(
        w.width > 0 && w.top >= b.bottom - 1,
        view +
          ': Own worktree sits in the picker row below the box (top ' +
          Math.round(w.top) +
          ', box bottom ' +
          Math.round(b.bottom) +
          ')'
      );
    } else log.push('skip ' + view + ': no Own worktree box');
    await shot('composer-' + view + '-newagent');

    // A full row (several agent tiles before the pickers take this room): Own worktree is never
    // drawn over a key hint. The pickers may shrink and the box may not, so it used to spill over
    // "Ctrl+K commands".
    const hints = document.querySelector('.composer .hints');
    if (wt && hints) {
      const over = [];
      for (let pad = 0; pad <= 360; pad += 40) {
        hints.style.paddingLeft = pad + 'px';
        await wait(60);
        const w = wt.getBoundingClientRect();
        for (const h of hints.querySelectorAll(':scope>.hint')) {
          const r = h.getBoundingClientRect();
          if (
            r.width &&
            w.width &&
            r.left < w.right - 1 &&
            r.right > w.left + 1 &&
            r.top < w.bottom &&
            r.bottom > w.top
          )
            over.push(pad + 'px: "' + h.textContent.trim().slice(0, 18) + '"');
        }
        if (over.length) {
          await shot('composer-' + view + '-newagent-full');
          break;
        }
      }
      hints.style.paddingLeft = '';
      check(
        !over.length,
        view +
          ': Own worktree never overlaps a hint in a full row' +
          (over.length ? ' (' + over.join(', ') + ')' : '')
      );
    }
    if (forced) wt.hidden = true;
    document.querySelector('.composebox .tnai-new-agent')?.click();
    await wait(150);
  }
  setText('');
  A.clear?.();
  chips().forEach(c => c.querySelector('.attachment-remove')?.click());
} catch (e) {
  ok = false;
  log.push('FAIL ' + (e.stack || e));
}
return { ok, log };

/*
 * Technically Not tools · desktop-check/tests/discord-alerts.js — Settings › Agents › Alerts to
 * Discord (89) against a fake local webhook (discord-alerts.main.js): off by default posts nothing;
 * a non-Discord address is refused; on + a "Needs you" item → exactly one short POST with no
 * mentions; the throttle holds a repeat; an unchecked event isn't posted; a 429 is retried once;
 * Send test works; the URL never reaches main's logs, the saved settings in plain text or anything
 * the page gets back.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(450);
};
let fake = null;
try {
  fake = await main('install');
  const SETTLE = 3000 + 700;
  const posts = async () => (await main('requests')).filter(r => r.method === 'POST');
  const needsYou = (id, detail) =>
    main('event', 'attention:change', {
      items: [{ id, paneId: 'p1', kind: 'permission', detail, since: Date.now() }],
      held: [],
    });

  window.TnaiSettings.open('agents');
  await wait(250);
  const row = document.querySelector('.tnai-discord-row'),
    sub = document.querySelector('.tnai-discord-sub');
  const toggle = row?.querySelector('input[type=checkbox]'),
    field = sub?.querySelector('[data-discord=url]'),
    status = sub?.querySelector('[data-discord=status]');
  check(
    !!row && document.getElementById('agentsWorkCard')?.contains(row),
    'the row sits in Settings › Agents › While agents work'
  );
  check(
    !!(await until(() => toggle && !toggle.checked && sub.classList.contains('off'))),
    'off by default, details folded'
  );

  await needsYou('permission:a', 'Bash: npm test');
  await wait(SETTLE);
  check((await posts()).length === 0, 'off: a Needs you item posts nothing');

  const v = await main('validator');
  check(
    v.discord && v.canary && !v.other && !v.plainHttp && !v.localWhenOff,
    'validator: Discord https only (discord.com, canary.discordapp.com), others refused'
  );

  toggle.click();
  await wait(100);
  check(
    toggle.checked && !sub.classList.contains('off') && document.activeElement === field,
    'turning it on without an address opens the details and focuses the field'
  );
  field.value = 'https://example.com/api/webhooks/1/abc';
  sub.querySelector('[data-discord=save]').click();
  check(
    !!(await until(() => /isn’t a Discord webhook/.test(status.textContent))),
    'a non-Discord address is refused with a reason'
  );
  check(!(await main('state')).set && !(await main('state')).enabled, 'nothing saved, still off');

  field.value = fake.url;
  sub.querySelector('[data-discord=save]').click();
  const st = await until(async () => {
    const s = await main('state');
    return s.enabled && s.set ? s : null;
  });
  check(!!st, 'saving a webhook with the switch on saves both');
  const got = await window.tnaiNative.discordAlerts.get();
  check(
    got.set &&
      /\/api\/webhooks\/1234…\/••••$/.test(got.webhook) &&
      !JSON.stringify(got).includes(fake.token) &&
      !JSON.stringify(got).includes('123456789012345678'),
    'the page only ever gets a masked address'
  );
  check(
    field.value === '' &&
      !document.body.innerHTML.includes(fake.token) &&
      field.placeholder.includes('••••'),
    'the field empties and shows the masked address'
  );
  check(
    sub.querySelector('[data-discord-event=needsYou]').checked &&
      !sub.querySelector('[data-discord-event=finished]').checked &&
      sub.querySelector('[data-discord-event=stuck]').checked,
    'defaults: Needs you and Seems stuck on, Finished off'
  );

  await needsYou('permission:b', 'permission to run npm test');
  await wait(SETTLE);
  let p = await posts();
  check(p.length === 1, 'on: one Needs you item → exactly one POST (got ' + p.length + ')');
  const msg = p[0]?.json || {};
  check(
    /^🟠 Umber needs you · .+ — permission to run npm test$/.test(msg.content || '') &&
      msg.content.length <= 300,
    'short text: agent, project, one line — ' + JSON.stringify(msg.content)
  );
  check(
    Array.isArray(msg.allowed_mentions?.parse) &&
      msg.allowed_mentions.parse.length === 0 &&
      msg.username === 'Technically Not',
    'no mentions, username Technically Not'
  );

  await needsYou('permission:c', 'another question');
  await wait(SETTLE);
  check(
    (await posts()).length === 1,
    'throttle: a second Needs you from the same agent within 60 s is held'
  );

  await main('event', 'agent:turn', {
    paneId: 'p1',
    agent: 'Claude Code',
    startedAt: Date.now() - 5000,
    endedAt: Date.now(),
    endedBy: 'stop',
    task: 'Fix the bug',
  });
  await wait(600);
  check((await posts()).length === 1, 'Finished is unchecked: not posted');

  await main('fail429', 1);
  await main('event', 'agent:loop', {
    id: 'loop-1',
    paneId: 'p1',
    agentId: '',
    on: true,
    tools: ['Read', 'Read'],
  });
  check(
    !!(await until(async () => (await posts()).length === 3, 4000)),
    'Seems stuck: a 429 is retried once, then posted'
  );
  p = await posts();
  check(
    /^⚠️ Umber seems stuck · .+ — repeating Read$/.test(p[2]?.json?.content || ''),
    'stuck text — ' + JSON.stringify(p[2]?.json?.content)
  );

  sub.querySelector('[data-discord=test]').click();
  check(
    !!(await until(
      async () => (await posts()).length === 4 && /Test sent/.test(status.textContent)
    )),
    'Send test posts one message and says so'
  );
  check(
    /test/i.test((await posts())[3]?.json?.content || ''),
    'the test message says it is a test'
  );

  const files = await main('files'),
    logs = await main('logs');
  check(
    !files.config.includes(fake.token) &&
      !files.config.includes('127.0.0.1') &&
      files.secret &&
      !files.secret.includes(fake.token),
    'on disk: settings file has no address, the address file is encrypted'
  );
  check(
    !logs.includes(fake.token) && !logs.includes('/api/webhooks/'),
    'the address never appears in main-process logs'
  );
  await shot('discord-alerts-settings');
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
try {
  await main('close');
} catch {}
return { ok, log };

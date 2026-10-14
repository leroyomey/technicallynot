/*
 * Technically Not tools · desktop-check/tests/model-route.js — a model or CLI named in the prompt
 * ("use Opus 5.5 to…") routes the task to exactly that model (73 TnaiModelRoute). (a) detect()
 * against a fixed fake catalog: positives, negatives, family → newest, effort after the model. (b)
 * Composer: the route hint names the model, Enter starts a new Claude Code through
 * TnaiTeam.startLead with TnaiLaunchPrefs.once(model); clicking the hint ignores the name.
 * startLead and TnaiAgents.send are stubbed: nothing reaches a real CLI (no usage). Returns {ok,
 * log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
const M = window.TnaiModelRoute,
  G = window.TnaiAgents,
  T = window.TnaiTeam,
  P = window.TnaiLaunchPrefs;
const realSend = G?.send,
  realStartLead = T?.startLead,
  realOnce = P?.once,
  realStart = P?.start;
const sends = [],
  leads = [],
  onces = [],
  starts = [];
try {
  check(
    !!M && typeof M.detect === 'function' && typeof M.route === 'function',
    'window.TnaiModelRoute exposes detect/route'
  );
  await Promise.resolve(M?.ready);
  await Promise.resolve(window.TnaiSessionStart?.ready);
  await wait(1500);

  // (a) detect() with a fixed catalog (newest first in each list, as the registry gives them).
  const catalogs = {
    'Claude Code': {
      models: [
        { id: 'claude-opus-5-5', label: 'Opus 5.5', group: 'Opus' },
        { id: 'claude-opus-5', label: 'Opus 5', group: 'Opus' },
        { id: 'claude-sonnet-5', label: 'Sonnet 5', group: 'Sonnet' },
        { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', group: 'Sonnet' },
        { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', group: 'Haiku' },
      ],
      efforts: ['low', 'medium', 'high', 'max'],
    },
    'Codex': {
      models: [
        { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['low', 'medium', 'high', 'xhigh'] },
        { id: 'gpt-5.5-codex', label: 'GPT-5.5-Codex', efforts: ['low', 'medium', 'high'] },
      ],
      efforts: ['low', 'medium', 'high', 'xhigh'],
    },
    'Cursor Agent': {
      models: [
        { id: 'gemini-3-pro', label: 'Gemini 3 Pro', group: 'gemini' },
        { id: 'grok-4', label: 'Grok 4', group: 'grok' },
        // Cursor's real list groups models as "cursor", "composer" and "claude": those words alone
        // must not pick a model (73 RESERVED).
        { id: 'cursor-grok-4.6-high', label: 'Grok 4.6', group: 'cursor' },
        { id: 'composer-2.5', label: 'Composer 2.5', group: 'composer' },
        { id: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5 1M', group: 'claude' },
      ],
      efforts: [],
    },
    // OpenCode as the registry gives it: id provider/model, group = the provider, the model's own
    // name, family and release date.
    'OpenCode': {
      models: [
        {
          id: 'opencode/big-pickle',
          label: 'Big Pickle',
          group: 'opencode',
          family: 'big-pickle',
          released: '2025-10-17',
        },
        {
          id: 'opencode/gpt-5.5',
          label: 'GPT-5.5',
          group: 'opencode',
          family: 'gpt',
          released: '2026-04-01',
        },
        {
          id: 'anthropic/claude-opus-5-5',
          label: 'Claude Opus 5.5',
          group: 'anthropic',
          family: 'claude-opus',
          released: '2026-05-01',
        },
        {
          id: 'moonshot/kimi-k2.5',
          label: 'Kimi K2.5',
          group: 'moonshot',
          family: 'kimi',
          released: '2026-01-10',
        },
        // `efforts` on a model is OpenCode's effort switch ON with its link available
        // (agent-registry.js OPENCODE_EFFORT_ON); the models without it are the OFF state.
        {
          id: 'moonshot/kimi-k2.6',
          label: 'Kimi K2.6',
          group: 'moonshot',
          family: 'kimi',
          released: '2026-05-20',
          efforts: ['low', 'high'],
        },
        {
          id: 'moonshot/kimi-k2.9-old',
          label: 'Kimi K2.9 Old',
          group: 'moonshot',
          family: 'kimi',
          released: '2026-09-01',
          deprecated: true,
        },
        {
          id: 'cloudflare-workers-ai/@cf/meta/llama-4-scout',
          label: 'Llama 4 Scout',
          group: 'cloudflare-workers-ai',
          family: 'llama',
          released: '2026-02-02',
        },
      ],
      efforts: [],
    },
  };
  const cases = [
    ['use Opus 5.5 to refactor the parser', { agent: 'Claude Code', model: 'claude-opus-5-5' }],
    ['have codex fix the tests', { agent: 'Codex', model: '' }],
    [
      'Sonnet: write docs for the settings page',
      { agent: 'Claude Code', model: 'claude-sonnet-5' },
    ],
    ['@opus review this', { agent: 'Claude Code', model: 'claude-opus-5-5' }],
    ['run this on gpt-5.5 high', { agent: 'Codex', model: 'gpt-5.5', effort: 'high' }],
    [
      'deploy a new cursor agent with gemini to check the layout',
      { agent: 'Cursor Agent', model: 'gemini-3-pro' },
    ],
    ['use Opus 5 for this one', { agent: 'Claude Code', model: 'claude-opus-5' }],
    [
      'switch to haiku and summarize the log',
      { agent: 'Claude Code', model: 'claude-haiku-4-5-20251001' },
    ],
    ['fix the Codex detection bug', null],
    ['the opus model list is wrong', null],
    ['update claude code docs', null],
    ['why does cursor agent crash on start', null],
    ['use cursor to fix the layout', null],
    ['then start a fresh Cursor Agent sub-agent with task "reply with CURSOR-OK"', null],
    ['use the composer to send it', null],
    ['use Composer 2.5 to fix it', { agent: 'Cursor Agent', model: 'composer-2.5' }],
    ['have Claude fix the login bug', { agent: 'Claude Code', model: '' }],
    // OpenCode: a full id as typed, the model's own name, its family word (newest by date, never a
    // deprecated one), and no provider word.
    ['use opencode/gpt-5.5 to fix it', { agent: 'OpenCode', model: 'opencode/gpt-5.5' }],
    [
      'use cloudflare-workers-ai/@cf/meta/llama-4-scout to test it',
      { agent: 'OpenCode', model: 'cloudflare-workers-ai/@cf/meta/llama-4-scout' },
    ],
    ['use Big Pickle to echo hi', { agent: 'OpenCode', model: 'opencode/big-pickle' }],
    ['use kimi for this one', { agent: 'OpenCode', model: 'moonshot/kimi-k2.6' }],
    ['use anthropic to write the docs', null],
    ['use moonshot for this', null],
    ['have opencode fix the tests', { agent: 'OpenCode', model: '' }],
    // An effort word counts only for an OpenCode model that lists that level (switch on), never for
    // one that lists none (switch off, or no levels).
    [
      'use Kimi K2.6 high for the review',
      { agent: 'OpenCode', model: 'moonshot/kimi-k2.6', effort: 'high' },
    ],
    [
      'use Kimi K2.6 max for the review',
      { agent: 'OpenCode', model: 'moonshot/kimi-k2.6', effort: '' },
    ],
    [
      'use opencode/gpt-5.5 high to fix it',
      { agent: 'OpenCode', model: 'opencode/gpt-5.5', effort: '' },
    ],
  ];
  for (const [text, want] of cases) {
    let got;
    try {
      got = M.detect(text, catalogs);
    } catch (e) {
      got = { threw: e.message };
    }
    const pass =
      want === null
        ? got === null
        : !!got &&
          got.agent === want.agent &&
          got.model === want.model &&
          (want.effort === undefined || got.effort === want.effort);
    check(
      pass,
      'detect ' +
        JSON.stringify(text) +
        ' → ' +
        (want ? JSON.stringify(want) : 'null') +
        (pass ? '' : ' · got ' + JSON.stringify(got))
    );
  }

  // (b) Composer: stubs first, so no pane or CLI is ever started or typed into.
  G.send = (paneId, text) => {
    sends.push({ paneId, text });
    return true;
  };
  T.startLead = async (opts = {}) => {
    leads.push(opts);
    return {
      paneId: 'tnai-fake-route-pane',
      name: 'Route Test',
      agent: opts.agent || 'Claude Code',
      running: true,
    };
  };
  P.once = (agent, pick) => {
    onces.push({ agent, pick: pick ? { ...pick } : null });
    return realOnce(agent, pick);
  };
  P.start = (...a) => {
    const r = realStart.apply(P, a);
    starts.push({ args: a, r });
    return r;
  };

  window.TnaiRoute?.('overview');
  await wait(200);
  const p = document.getElementById('prompt');
  const key = k =>
    p.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const type = v => {
    p.focus();
    p.value = v;
    p.setSelectionRange(v.length, v.length);
    p.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const hint = () => document.querySelector('.tnai-route-hint');
  const r = M.route('use Opus 5.5 to echo hi', {});
  check(
    !!r &&
      (r.kind === 'new' || r.kind === 'direct') &&
      /Opus 5\.5/.test(r.label || '') &&
      (r.model?.model ?? r.model) === 'claude-opus-5-5',
    'route() → new/direct on Opus 5.5: ' +
      JSON.stringify(r && { kind: r.kind, label: r.label, model: r.model })
  );
  type('use Opus 5.5 to echo hi');
  const named = await until(() => /Opus 5\.5/.test(hint()?.textContent || ''), 5000);
  check(!!named, 'route hint names Opus 5.5: ' + JSON.stringify(hint()?.textContent || ''));
  check(/Claude Code/.test(hint()?.textContent || ''), 'route hint names Claude Code');
  console.log('TNAI_SHOT:model-route-hint');
  key('Enter');
  check(!!(await until(() => leads.length, 8000)), 'Enter started a new lead (stubbed startLead)');
  check(
    leads[0]?.agent === 'Claude Code',
    'startLead got agent Claude Code: ' + JSON.stringify(leads[0])
  );
  const set = onces.find(o => o.pick);
  check(
    set?.agent === 'Claude Code' && set?.pick?.model === 'claude-opus-5-5',
    'TnaiLaunchPrefs.once got claude-opus-5-5: ' + JSON.stringify(onces)
  );
  check(!!(await until(() => sends.length, 5000)), 'task sent to the new agent');
  check(
    sends[0]?.paneId === 'tnai-fake-route-pane' && /echo hi/.test(sends[0]?.text || ''),
    'sent to the fake pane only: ' +
      JSON.stringify(sends.map(s => ({ paneId: s.paneId, text: s.text.slice(0, 80) })))
  );
  check(sends.length === 1, 'sent exactly once (' + sends.length + ')');
  check(p.value === '', 'composer cleared');
  await wait(300);

  // The one-time pick must not outlive this send: if startLead fails before a pane reads it, the
  // next fresh pane would also start on Opus 5.5 (54 clears it the same way).
  check(
    onces[onces.length - 1]?.pick === null,
    'once cleared after the start: ' + JSON.stringify(onces)
  );

  // Clicking the hint ignores the name for that prompt.
  leads.length = 0;
  onces.length = 0;
  sends.length = 0;
  type('use Opus 5.5 to echo again');
  await until(() => /Opus 5\.5/.test(hint()?.textContent || ''), 5000);
  hint()?.click();
  const ignored = await until(() => hint() && !/Opus 5\.5/.test(hint().textContent), 3000);
  check(
    !!ignored,
    'hint click drops the named model: ' + JSON.stringify(hint()?.textContent || '')
  );
  key('Enter');
  await until(() => sends.length || leads.length, 8000);
  await wait(500);
  check(
    !onces.some(o => o.pick?.model === 'claude-opus-5-5'),
    'ignored prompt set no Opus 5.5 once: ' + JSON.stringify(onces)
  );
  check(
    !leads.some(l => l.model),
    'ignored prompt: startLead without a model: ' + JSON.stringify(leads)
  );
  p.value = '';
  p.dispatchEvent(new Event('input', { bubbles: true }));
} catch (e) {
  check(false, 'threw: ' + e.message + ' ' + (e.stack || '').split('\n')[1]);
} finally {
  if (realSend) G.send = realSend;
  if (realStartLead) T.startLead = realStartLead;
  if (realOnce) {
    P.once = realOnce;
    realOnce('Claude Code', null);
  }
  if (realStart) P.start = realStart;
}
return { ok, log };

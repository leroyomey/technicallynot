/*
 * Technically Not · 51-next-actions.js — Desktop app only: what happens after an agent finishes.
 * Every finished task in the shared project context (49 / desktop/agent-context.js) lands in the
 * top-bar bell (newest first, unread count; sub-agents left out, their report goes to the parent);
 * nothing pops up unless the user turns on "Pop up next steps" (prefs.cards, default off since
 * 2026-09-24; automatic mode's countdown always shows). With it on, one that recommends next steps
 * or reports blockers also pops up above the composer, first as a one-line chip (who, tag, next
 * step, one quick Send/Queue/Cancel, +N more; click opens the full card, ▾ makes it small again;
 * Settings: Start small). A chip left untouched for N seconds flies into the bell and stays unread
 * there (decisions and countdowns never do; Settings: Tuck after). Opened, several stack (newest
 * open, the others as one-line rows to open). Each item reads top to bottom: CLI icon (52), who
 * finished and when, a Blocked / Next steps / Done tag, what was asked, what it did, files changed,
 * blockers, and its next steps, each with **Send to <agent>** (typed into that agent as is; **Queue
 * for** while it works — the CLI takes it after its current task) or **Edit in composer**
 * (TnaiContext.toComposer, nothing sent). A result that asks the user to decide (summary.choices,
 * not yet answered / dismissed) also gets a card, tagged Decision needed, with the question and its
 * options (#1 Recommended) each with **Send** (TnaiContext.decide: typed into the agent while it
 * runs, marked answered); automatic mode never continues it. Settings › Agents › After an agent
 * finishes: Pop up next steps (manual cards, default off) and Automatic mode (default off) side by
 * side. Automatic mode sends the agent its own first next step (or all of them as one message)
 * after a visible countdown on the card (Send now / Cancel; delay set in Settings), only when it is
 * running, reported no blockers, no permission prompt is open, no step waits on the user
 * (ask/approve/commit/build/deploy… or the user's own pause words), its CLI is enabled for it, it
 * is idle (or "queue it" is chosen), and fewer than N automatic steps ran in a row (chain counted
 * from the task text); it checks again at send time; otherwise the card stays and says why it
 * paused. Cards show only items still open in Project context: a step sent from a card is marked
 * sent there, and a card whose steps / blockers / decision were all handled since (done by a later
 * result, merged, parked, answered… INFERRED by upkeep in desktop/agent-context.js) puts itself
 * away: out of the stack and out of the bell (a commit that covers it counts too,
 * 49/agent-context.js). Handled items never count as unread and leave the bell at once, open or
 * not. Unread items left untouched for prefs.nudge seconds make the bell's
 * count pulse a few beats (again every prefs.nudge seconds); one that waits on the user (a decision
 * or blockers) keeps pulsing until the bell is opened (Settings: Remind me about unread items
 * after). Pushed (`context:changed`), never polled (a 1 s timer only repaints a countdown). Blocked
 * means the agent can't continue without the user (sign-in, key, approval, answer; INFERRED from
 * the wording); other blockers ("not tested by hand", "a check failed") show as Notes and never tag
 * Blocked or turn the count orange. The same blocker on several reports shows on the newest only,
 * and a Blocked item clears once its agent moved on (a newer result or a new turn on its pane; a
 * user reply also marks it answered in Project context). Items of an agent whose panel was closed
 * count as Handled and leave the bell at once too (tnai:terminal-pane-closed). ✓ on an item (and
 * Mark all done in the bell) marks its open steps, blockers and decision done in Project context;
 * next steps of an agent that moved on (a newer turn or result on its pane) count as Handled
 * (INFERRED; Settings › Agents › Close steps when an agent moves on also dismisses them in Project
 * context); focusing an agent's terminal marks its items read. The bell also holds notices from
 * real checks (app / agent CLI updates; 60 calls notify / unnotify), in the same item markup.
 * window.TnaiNextActions (mode, prefs, setMode, set, pending, counting, dismiss, refresh, openBell,
 * notify, unnotify, unnotifyGroup).
 */
(() => {
  const native = window.tnaiNative,
    agents = window.TnaiAgents;
  if (!native?.context || !agents) return;
  const esc = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));

  // per viewer: { cards, auto, delay, max, steps: 'first'|'all', busy: 'pause'|'queue', skip: [cli
  // keys], hold } (old { mode } migrated)
  const STORE = 'tnai.next-actions.v1';
  const AUTO_TAG = '[TN.ai auto-continue ';

  // A next step that waits on the user is never sent automatically.
  const NEEDS_USER =
    /\b(when (you|the user) (ask|approve|want|say)|wait(s|ing)? (for|on) (you|the user)|(you|the user) to (say|decide|confirm|choose|reply)|go[- ]?ahead|your (ok|okay|input|answer)|if you (want|like|ask)|ask(s|ed)? (you|the user|first)|approv|confirm|your (call|decision|choice)|decide|commit|push|merge|build (the )?(\.?exe|installer)|npm run dist|release|deploy|publish|sign[- ]?in|log ?in|manual(ly)?|by eye)\b/i;
  const BELL_MAX = 30,
    STACK_MAX = 5,
    SETTLE_MS = 1500;
  const CLIS = [
    ['claude-code', 'Claude Code'],
    ['codex', 'Codex'],
    ['cursor-agent', 'Cursor'],
    ['gemini-cli', 'Gemini CLI'],
    ['droid', 'Droid'],
    ['opencode', 'OpenCode'],
    ['github-copilot', 'GitHub Copilot'],
  ];
  const DEFAULTS = {
    cards: false,
    auto: false,
    delay: 10,
    max: 3,
    steps: 'first',
    busy: 'pause',
    skip: [],
    hold: '',
    compact: true,
    tuck: 45,
    nudge: 120,
    closeMovedOn: false,
  };
  const clamp = (v, lo, hi, d) => {
    const n = Math.round(+v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  let prefs = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (saved.mode && saved.cards === undefined) {
      saved.cards = saved.mode !== 'off';
      saved.auto = saved.mode === 'auto';
    }
    if (saved.quiet !== 1) {
      saved.cards = false;
      saved.quiet = 1;
    } // 2026-09-24: finished agents no longer pop up unless the user turns it back on
    delete saved.mode;
    prefs = { ...prefs, ...saved };
  } catch {}
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(prefs));
    } catch {}
  };
  const modeOf = () => (prefs.auto ? 'auto' : prefs.cards ? 'suggest' : 'off');
  const holdRe = () => {
    const words = String(prefs.hold || '')
      .split(',')
      .map(w => w.trim())
      .filter(Boolean)
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return words.length ? new RegExp('\\b(' + words.join('|') + ')', 'i') : null;
  };

  const style = document.createElement('style');
  style.textContent = `
.tnai-next{position:fixed;right:18px;bottom:128px;z-index:59;box-sizing:border-box;display:grid;gap:0;width:440px;max-width:calc(100vw - 36px);max-height:min(520px,calc(100vh - 170px));border:1px solid var(--line,#e1e5dc);border-radius:var(--surface-r,9px);background:#fff;box-shadow:var(--shadow,0 14px 40px #20211f1f);color:var(--ink,#34382f);font:11px/1.5 var(--pg-sans);overflow:auto}
.tnai-next[hidden],body:has(.tnai-perm:not([hidden])) .tnai-next{display:none}
.tnai-next.chip{width:360px;overflow:hidden;animation:tnai-chip-in .2s ease-out}
@keyframes tnai-chip-in{from{opacity:0;transform:translateY(8px)}}
.tnai-nitem.chip{gap:0;padding:7px 8px 7px 10px;cursor:pointer}
.tnai-nitem.chip:hover{background:#f8f9f5}
.tnai-nitem.chip .n-head{gap:7px}
.tnai-nitem.chip .n-head .agent-avatar{width:22px;height:22px;font-size:10px}
.tnai-nitem.chip .n-who b{font-size:11px}
.tnai-nitem .n-more{flex:none;padding:0 6px;border-radius:999px;background:#f1f2ee;color:#6e7467;font:600 9px/16px var(--pg-sans)}
.tnai-nitem details.n-sec summary{color:#8a9084;font:600 9px/1.6 var(--pg-sans);letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
.tnai-nitem details.n-sec[open] summary{margin-bottom:3px}
.tnai-bell.n-pulse{animation:tnai-bell-pulse .6s ease-out}
@keyframes tnai-bell-pulse{40%{transform:scale(1.18);background:#eef3e8}}
.tnai-bell .n-count{--attn:#5e7a4b}
.tnai-bell .n-count[data-k=blocked]{--attn:#b0643b}
.tnai-bell .n-count[data-k=update]{--attn:var(--ac-plum-fg,#7a5a8c)}
.tnai-bell .n-count::after{content:'';position:absolute;inset:-2px;border:2px solid var(--attn);border-radius:inherit;opacity:0;pointer-events:none}
.tnai-bell.n-attn .n-count::after{animation:tnai-bell-attn 1.4s ease-out 3}
.tnai-bell.n-attn-loop .n-count::after{animation:tnai-bell-attn 1.4s ease-out infinite}
@keyframes tnai-bell-attn{from{opacity:.85;transform:scale(1)}to{opacity:0;transform:scale(2)}}
@media (prefers-reduced-motion:reduce){.tnai-next.chip,.tnai-bell.n-pulse{animation:none}.tnai-bell.n-attn .n-count::after,.tnai-bell.n-attn-loop .n-count::after{animation:none;opacity:1;transform:scale(1.35)}}
.tnai-next .n-stackhead{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid #edf0ea;background:#fbfcf9;color:#6e7467;font:10px var(--pg-sans)}
.tnai-next .n-stackhead b{color:#34382f;font:600 11px var(--pg-sans)}
.tnai-next .n-stackhead button:first-of-type{margin-left:auto}
.tnai-nitem{display:grid;gap:9px;padding:11px 13px 12px;border-bottom:1px solid #edf0ea}
.tnai-nitem:last-child{border-bottom:0}
.tnai-nitem.row{gap:0;padding:8px 12px;cursor:pointer}
.tnai-nitem.row:hover{background:#f8f9f5}
.tnai-bell-pop .n-head[data-act=collapse]{cursor:pointer}
.tnai-nitem .n-head{display:flex;align-items:center;gap:9px;min-width:0}
.tnai-nitem .n-head .agent-avatar{flex:none;width:26px;height:26px;font-size:11px}
.tnai-nitem.row .n-head .agent-avatar{width:22px;height:22px;font-size:10px}
.tnai-nitem .n-who{display:grid;flex:1 1 auto;min-width:0}
.tnai-nitem .n-who b{overflow:hidden;font:600 12px/1.3 var(--pg-sans);white-space:nowrap;text-overflow:ellipsis}
.tnai-nitem .n-who small{overflow:hidden;color:#8a9084;font:10px/1.35 var(--pg-sans);white-space:nowrap;text-overflow:ellipsis}
.tnai-nitem .n-tag{flex:none;padding:2px 7px;border-radius:999px;background:#eef3e8;color:#4d6340;font:600 9px/1.5 var(--pg-sans);letter-spacing:.03em;text-transform:uppercase}
.tnai-nitem .n-tag[data-k=blocked]{background:#f8ece4;color:#8f5a3a}
.tnai-nitem .n-tag[data-k=done]{background:#f1f2ee;color:#7a8073}
.tnai-nitem .n-tag:is([data-k=decide],[data-k=update]){background:var(--ac-plum-bg,#f0e9f4);color:var(--ac-plum-fg,#7a5a8c)}
.tnai-nitem .n-sec[data-k=choices]{padding:7px 9px;border-radius:6px;background:#fbf9fc}
.tnai-nitem .n-q{margin:0;color:#34382f;font:600 11px/1.45 var(--pg-sans);overflow-wrap:anywhere}
.tnai-nitem ol.n-opts{display:grid;gap:4px;margin:0;padding:0 0 0 18px}
.tnai-nitem .n-opts li{display:flex;align-items:center;gap:8px}.tnai-nitem .n-opts li>span{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.tnai-nitem .n-opts li.n-other{list-style:none;margin-left:-18px}.tnai-nitem .n-other input{flex:1 1 auto;min-width:0;box-sizing:border-box;height:24px;padding:0 8px;border:1px solid #dfe3d9;border-radius:6px;background:#fff;color:#34382f;font:11px var(--pg-sans)}
.tnai-nitem .n-dot{flex:none;width:7px;height:7px;border-radius:50%;background:#5e7a4b}
.tnai-nitem .n-x{flex:none;width:22px;height:22px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:#81867a;font:12px/1 var(--pg-sans);cursor:pointer}
.tnai-nitem .n-x:hover{border-color:#e5e8e0;background:#f6f7f3}
.tnai-nitem .n-ask{margin:6px 0;padding:0 9px;border-left:2px solid #dfe3d9;color:#6e7467;font:10.5px/1.5 var(--pg-sans);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tnai-nitem .n-sec{display:grid;gap:3px;min-width:0}
.tnai-nitem .n-sec>span{color:#8a9084;font:600 9px/1.6 var(--pg-sans);letter-spacing:.06em;text-transform:uppercase}
.tnai-nitem .n-sec ul{display:grid;gap:3px;margin:0;padding:0 0 0 16px;overflow-wrap:anywhere}
.tnai-nitem .n-sec li::marker{color:#a3a99b}
.tnai-nitem .n-sec[data-k=blockers]{padding:7px 9px;border-radius:6px;background:#fcf5f0}
.tnai-nitem .n-sec[data-k=blockers]>span,.tnai-nitem .n-sec[data-k=blockers] ul{color:#8f5a3a}
.tnai-nitem .n-files{display:flex;flex-wrap:wrap;gap:4px}
.tnai-nitem code.n-ic{padding:0 4px;border:1px solid #edf0ea;border-radius:4px;background:#fbfcf9;color:#5b6353;font:.92em/1.4 Consolas,monospace;overflow-wrap:anywhere}
.tnai-nitem .n-files code{max-width:100%;padding:1px 6px;border:1px solid #edf0ea;border-radius:5px;background:#fbfcf9;color:#5b6353;font:10px/1.6 Consolas,monospace;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tnai-nitem .n-why,.tnai-nitem .n-note{margin:0;padding:5px 8px;border-radius:5px;background:#f6f7f3;color:#6e7467;font:10px/1.45 var(--pg-sans)}
.tnai-nitem ul.n-steps{display:grid;gap:5px;margin:0;padding:0;list-style:none;counter-reset:step}
.tnai-nitem .n-steps li{display:grid;gap:6px;padding:7px 9px;border:1px solid #edf0ea;border-radius:6px;background:#fbfcf9;counter-increment:step}
.tnai-nitem .n-steps li>div:first-child::before{content:counter(step) ". ";color:#8a9084;font-weight:600}
.tnai-nitem .n-tools{display:flex;flex-wrap:wrap;gap:6px}
.tnai-next button.n-b,.tnai-bell-pop button.n-b{box-sizing:border-box;height:24px;padding:0 8px;border:1px solid #dfe3d9;border-radius:6px;background:#fff;color:#5b6353;font:10px var(--pg-sans);cursor:pointer}
.tnai-next button.n-b:hover,.tnai-bell-pop button.n-b:hover{background:#f2f4ee}
.tnai-next button.n-b:disabled,.tnai-bell-pop button.n-b:disabled{opacity:.5;cursor:default}
.tnai-next button.n-b.primary,.tnai-bell-pop button.n-b.primary{border-color:#3d4a33;background:#3d4a33;color:#f3f7ec}
.tnai-next button.n-b.primary:hover,.tnai-bell-pop button.n-b.primary:hover{background:#4a5a3e}
.tnai-nitem .n-foot{display:flex;align-items:center;gap:6px;color:#8a9084;font:10px var(--pg-sans)}
.tnai-nitem .n-foot button:first-of-type{margin-left:auto}
.tnai-bell{position:relative;display:inline-grid;place-items:center;box-sizing:border-box;width:30px;height:30px;padding:0}
.tnai-bell svg{width:15px;height:15px;display:block}
.tnai-bell .n-count{position:absolute;top:-4px;right:-4px;box-sizing:border-box;min-width:16px;height:16px;padding:0 4px;border:2px solid #fff;border-radius:999px;background:#5e7a4b;color:#fff;font:600 9px/12px var(--pg-sans);text-align:center}
.tnai-bell .n-count[data-k=blocked]{background:#b0643b}
.tnai-bell .n-count[data-k=update]{background:var(--ac-plum-fg,#7a5a8c)}
.tnai-bell .n-count[hidden]{display:none}
.tnai-bell-pop{position:fixed;z-index:70;box-sizing:border-box;display:grid;grid-template-rows:auto minmax(0,1fr);width:440px;max-width:calc(100vw - 24px);max-height:calc(100vh - 96px);border:1px solid var(--line,#e1e5dc);border-radius:var(--surface-r,9px);background:#fff;box-shadow:var(--shadow,0 14px 40px #20211f1f);color:var(--ink,#34382f);font:11px/1.5 var(--pg-sans);overflow:hidden}
.tnai-bell-pop[hidden]{display:none}
.tnai-bell-pop .n-pophead{display:flex;align-items:center;gap:6px;padding:9px 12px;border-bottom:1px solid #edf0ea}
.tnai-bell-pop .n-pophead b{flex:1 1 auto;font:600 12px var(--pg-sans)}
.tnai-bell-pop .n-list{overflow:auto}
.tnai-bell-pop .n-empty{margin:0;padding:22px 16px;color:#8a9084;text-align:center}
.tnai-nitem .n-auto{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 9px;border:1px solid #dfe6d6;border-radius:6px;background:#f3f6ee;color:#4d6340;font:10.5px/1.5 var(--pg-sans)}
.tnai-nitem .n-auto>span{flex:1 1 180px}
`;
  document.head.append(style);

  const card = document.createElement('section');
  card.className = 'tnai-next';
  card.hidden = true;
  card.setAttribute('aria-label', 'Finished agents');
  document.body.append(card);

  // Top-bar bell with the unread count, and its panel.
  const bell = document.createElement('button');
  bell.type = 'button';
  bell.className = 'button tnai-bell';
  bell.title = 'Finished agents';
  bell.setAttribute('aria-label', 'Finished agents');
  bell.setAttribute('aria-expanded', 'false');
  bell.innerHTML = window.TnaiIcon('bell') + '<span class="n-count" hidden></span>';
  const topRight = document.querySelector('header.top .top-right');
  if (topRight) topRight.insertBefore(bell, document.getElementById('topCommand'));
  const pop = document.createElement('section');
  pop.className = 'tnai-bell-pop';
  pop.hidden = true;
  pop.setAttribute('aria-label', 'Finished agents');
  document.body.append(pop);

  let entries = [],
    marks = {},
    // known: ids already seen (null until the first load, so old results never pop up)
    known = null;

  // bell: { id, read, note, clearAt, notice? } newest first (clearAt: done / handled, leaves the
  // bell then; notice: app / CLI / integration item from notify(), 60)
  const items = [];
  const stack = []; // card above the composer: entry ids, newest first
  let openId = '',
    popOpenId = '';
  const whyFor = new Map();

  // entry id -> { at, t } an automatic send counting down (shown on the card with Send now /
  // Cancel)
  const timers = new Map();
  let syncSettings = () => {}; // set once the Settings › Agents box is mounted
  let ticker = 0,
    expanded = false,
    tuckT = 0,
    clearT = 0,
    nudgeT = 0,
    beatAt = 0; // expanded: the card shows in full instead of as a chip (prefs.compact)
  const entry = id => entries.find(e => e.id === id);
  const item = id => items.find(i => i.id === id);

  // a notice lives until it is removed or replaced; an agent item while its result is in Project
  // context
  const alive = i => i.notice || entry(i.id);
  const session = e => agents.sessions().find(s => s.paneId === e.paneId);
  const clean = t =>
    (window.TnaiResults?.cleanTask?.(t) || String(t || ''))
      .replace(/^\[(?:TN|TechnicallyNot)\.ai auto-continue [^\]]*\]\s*/, '')
      .replace(/<\/?pasted_content[^>]*>/g, '')
      .trim();
  const chainOf = e => {
    const m = String(e.task || '').match(/^\[(?:TN|TechnicallyNot)\.ai auto-continue (\d+)\//);
    return m ? +m[1] : 0;
  };
  const busy = s => s.status === 'working' || window.TnaiTeam?.busy?.(s.paneId);
  const permissionOpen = () => !!document.querySelector('.tnai-perm:not([hidden])');
  const ago = at => {
    const s = Math.max(0, (Date.now() - (+at || Date.now())) / 1000);
    return s < 45
      ? 'just now'
      : s < 3600
        ? Math.round(s / 60) + ' min ago'
        : s < 86400
          ? Math.round(s / 3600) + ' h ago'
          : new Date(at).toLocaleDateString();
  };
  const took = e => {
    const s = (+e.at - +e.startedAt) / 1000;
    return s > 0 ? ' · took ' + (s < 60 ? Math.round(s) + 's' : Math.round(s / 60) + ' min') : '';
  };
  const avatar = name =>
    window.TnaiCliIcons?.avatar(name) ||
    `<span class="agent-avatar">${esc(String(name || '?').charAt(0))}</span>`;

  // An open decision (summary.choices not yet answered / dismissed in Project context) waits on the
  // user: tagged, shown, never auto-continued. A report with several decisions: the first one still
  // open ({ …decision, n }; 49 openChoice), so the one decision section steps through them in
  // order.
  const choicesOf = e => window.TnaiContext?.openChoice?.(e, key => marks[key]) || null;

  // Next steps / blockers still open in Project context ({t, i}: i is the index in the summary,
  // used for mark keys and data-i). Marked ones (done by a later result, merged, parked, sent,
  // dismissed…) are handled and left out; a card with nothing open left puts itself away (settle).
  const openOf = (e, k) =>
    (e.summary?.[k] || [])
      .map((t, i) => ({ t, i }))
      .filter(x => !marks[e.id + ':' + k + ':' + x.i]);

  // Blocked only when the agent can't continue without the user (a sign-in, key, approval,
  // answer…). Notes like "not tested by hand" or "a check failed" stay on the card as Notes, tagged
  // Done / Next steps, and don't turn the count orange. INFERRED from the wording.
  const MUST_USER =
    /\b(can(no|')?t (continue|proceed|go on|finish)|unable to (continue|proceed)|blocked (on|by|until)|until (you|the user)|wait(s|ing)? (for|on) (you|your|the user|approval|access)|needs? (your|the user'?s?) (decision|approval|answer|input|ok|okay|go-?ahead|credentials?|access|permission|key|token)|not (signed|logged)[- ]?in|needs? (to )?(sign|log)[- ]?in|(sign|log)[- ]?in (is )?(required|needed|first)|credentials?|api[- ]?key|access token|password|permission (denied|required|needed)|approval|your (decision|call|choice|answer|go-?ahead))\b/i;
  const ASKS_USER =
    /\b((you|the user) (must|need to|have to|should|will need to)|needs? (you|the user))\b/i;
  const JUST_NOTE =
    /\b(not (yet )?(tested|verified|checked|run|confirmed|tried)|unverified|untested|by (hand|eye)|manual(ly)?|fail(s|ed|ing|ure)?|skipped|timed? ?out)\b/i;
  const mustUser = t => MUST_USER.test(t) || (ASKS_USER.test(t) && !JUST_NOTE.test(t));

  // The same blocker from several agents or reports shows once, on the newest report that still has
  // it open.
  const words = t =>
    new Set(
      String(t)
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9._-]{2,}/g) || []
    );
  const sameBlocker = (a, b) => {
    const A = words(a),
      B = words(b),
      n = [...A].filter(w => B.has(w)).length,
      m = Math.min(A.size, B.size);
    return m
      ? m >= 3
        ? n / m >= 0.8
        : n === m && A.size === B.size
      : String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  };

  // A Blocked item clears once the agent moved on: a newer result from the same pane, or a new turn
  // started there (the user answering in its terminal or the chat box also marks it answered in
  // Project context, answeredElsewhere). paneId -> start of the newest turn there (any sender),
  // this Technically Not run
  const turnAt = new Map();
  const movedOn = e =>
    !!e.paneId &&
    ((turnAt.get(e.paneId) || 0) > +(e.startedAt || e.at) ||
      entries.some(x => x !== e && x.paneId === e.paneId && +x.at > +e.at));
  const hardOf = e =>
    movedOn(e)
      ? []
      : openOf(e, 'blockers').filter(
          x =>
            mustUser(x.t) &&
            !entries.some(
              o =>
                o !== e &&
                +o.at > +e.at &&
                !o.subagent &&
                !movedOn(o) &&
                openOf(o, 'blockers').some(y => mustUser(y.t) && sameBlocker(x.t, y.t))
            )
        );
  const notesOf = e => openOf(e, 'blockers').filter(x => !mustUser(x.t));

  // Next steps still waiting: none once the agent moved on (the user or another agent gave it new
  // work since, INFERRED), so the bell doesn't keep a wall of steps the user already handled in the
  // terminal. The full item still lists them with Send.
  const nextOf = e => (movedOn(e) ? [] : openOf(e, 'next'));

  // Everything still open on a result, as Project context mark keys (✓ Mark done / Mark all done).
  const openKeys = e =>
    (choicesOf(e) ? [e.id + ':choices:0'] : []).concat(
      openOf(e, 'next').map(x => e.id + ':next:' + x.i),
      openOf(e, 'blockers').map(x => e.id + ':blockers:' + x.i)
    );

  // An agent whose panel was closed can't take a step or answer here any more: its items count as
  // handled and leave the bell (still in Project context).
  const closedPanes = new Set();
  const closedOf = e => !!e.paneId && closedPanes.has(e.paneId);
  const actionable = e => !closedOf(e) && !!(nextOf(e).length || hardOf(e).length || choicesOf(e));
  const hadAction = e =>
    !!(
      e.summary?.next?.length ||
      (e.summary?.blockers || []).some(mustUser) ||
      e.summary?.choices?.options?.length
    );
  const tagOf = e => {
    const n = nextOf(e).length;
    return closedOf(e)
      ? ['done', 'Handled']
      : choicesOf(e)
        ? ['decide', 'Decision needed']
        : hardOf(e).length
          ? ['blocked', 'Blocked']
          : n
            ? ['next', n + ' next step' + (n > 1 ? 's' : '')]
            : hadAction(e)
              ? ['done', 'Handled']
              : ['done', 'Done'];
  };

  // Why a card was put away: the newest automatic or user mark on its items, in plain words.
  const HANDLED = {
    auto: 'done by a later result',
    superseded: 'replaced by a newer report',
    merged: 'restated by a newer result',
    stale: 'parked as old',
    sent: 'sent to an agent',
    answered: 'answered',
    done: 'marked done',
    dismissed: 'dismissed',
    deleted: 'deleted',
  };

  function handledWhy(e) {
    const m = Object.entries(marks)
      .filter(([k]) => k.startsWith(e.id + ':'))
      .map(([, v]) => v)
      .sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    const by = m?.by && entry(m.by);
    if (closedOf(e)) return 'Handled: ' + e.name + ' was closed (still in the shared context)';
    if ((!m || m.state === 'dismissed') && movedOn(e))
      return 'Handled: ' + e.name + ' moved on to newer work (inferred)';
    if (!m && openOf(e, 'blockers').some(x => mustUser(x.t)))
      return 'Handled: the same blocker is on a newer report';
    return (
      'Handled: ' +
      (m?.commit
        ? 'done in commit ' + m.commit
        : (HANDLED[m?.state] || 'resolved') +
          (by && m.state !== 'stale' ? ' (' + by.name + ')' : ''))
    );
  }

  // Report text with `backticks` shows them as inline code instead of raw backticks.
  const rich = t => esc(t).replace(/`([^`\n]+)`/g, '<code class="n-ic">$1</code>');
  const list = arr => `<ul>${arr.map(t => `<li>${rich(t)}</li>`).join('')}</ul>`;

  // One-line row: who, tag, and the first thing it did (or what was asked).
  function rowHtml(e, where) {
    const [k, tag] = tagOf(e),
      it = item(e.id),
      line = e.summary?.did?.[0] || clean(e.task) || 'Finished its task';
    return `<div class="tnai-nitem row" data-item="${esc(e.id)}" data-where="${where}" data-act="expand" role="button" tabindex="0" title="Open"><div class="n-head">${avatar(e.agent)}<div class="n-who"><b>${esc(e.name)} finished</b><small>${esc(line)}</small></div>${where === 'bell' && it && !it.read ? '<i class="n-dot" title="New"></i>' : ''}<span class="n-tag" data-k="${k}">${esc(tag)}</span>${actionable(e) ? '<button type="button" class="n-x" data-act="done" title="Mark done: you handled this (also closes its open steps in the shared context)" aria-label="Mark done">✓</button>' : ''}</div></div>`;
  }

  // The small chip a new card starts as: who, tag, one line (countdown, pause reason, question,
  // first next step…), one quick action, open, dismiss.
  function chipHtml(e, count) {
    const [k, tag] = tagOf(e),
      s = session(e),
      live = !!s?.running,
      sum = e.summary || {},
      first = nextOf(e)[0],
      blocker = hardOf(e)[0],
      choice = choicesOf(e),
      why = whyFor.get(e.id),
      who = esc(e.name);
    const line = timers.has(e.id)
      ? `Sending next step to ${who} in <b data-count>${countdown(e.id)}</b>`
      : esc(
          why ||
            (choice
              ? choice.question
              : first
                ? 'Next: ' + first.t
                : blocker?.t || sum.did?.[0] || clean(e.task) || 'Finished its task')
        );
    const quick = timers.has(e.id)
      ? '<button type="button" class="n-b" data-act="auto-cancel" title="Keep this card; you decide what runs next">Cancel</button>'
      : live && first && !choice && !blocker
        ? `<button type="button" class="n-b primary" data-act="send" data-i="${first.i}" title="${esc((busy(s) ? 'Queue for ' : 'Send to ') + e.name + ': ' + first.t)}">${busy(s) ? 'Queue' : 'Send'}</button>`
        : '';
    return `<div class="tnai-nitem chip" data-item="${esc(e.id)}" data-where="card" data-act="expand" role="button" tabindex="0" title="Open the full card"><div class="n-head">${avatar(e.agent)}<div class="n-who"><b>${who} finished</b><small>${line}</small></div>${count > 1 ? `<span class="n-more" title="${count - 1} more finished">+${count - 1}</span>` : ''}<span class="n-tag" data-k="${k}">${esc(tag)}</span>${quick}${actionable(e) ? '<button type="button" class="n-x" data-act="done" title="Mark done: you handled this (also closes its open steps in the shared context)" aria-label="Mark done">✓</button>' : ''}<button type="button" class="n-x" data-act="dismiss" title="Dismiss (still in the bell and the shared context)" aria-label="Dismiss">✕</button></div></div>`;
  }

  // The full item, read top to bottom.
  function detailHtml(e, where) {
    const s = session(e),
      live = !!s?.running,
      queues = live && busy(s),
      sum = e.summary || {},
      next = openOf(e, 'next'),
      blockers = hardOf(e).map(x => x.t),
      notes = notesOf(e).map(x => x.t),
      did = sum.did || [];
    const files = (e.edited?.length ? e.edited : sum.changed || []).slice(0, 8),
      more = (e.edited?.length || 0) - files.length;
    const why = whyFor.get(e.id),
      note = item(e.id)?.note,
      who = esc(e.name),
      task = clean(e.task),
      [k, tag] = tagOf(e),
      choice = choicesOf(e);
    const x =
      (actionable(e)
        ? '<button type="button" class="n-x" data-act="done" title="Mark done: you handled this (also closes its open steps in the shared context)" aria-label="Mark done">✓</button>'
        : '') +
      (where === 'card' && prefs.compact
        ? '<button type="button" class="n-x" data-act="collapse" title="Make small" aria-label="Make small">▾</button>'
        : '') +
      (where === 'card'
        ? '<button type="button" class="n-x" data-act="dismiss" title="Dismiss (still in the bell and the shared context)" aria-label="Dismiss">✕</button>'
        : '<button type="button" class="n-x" data-act="remove" title="Remove from this list (still in the shared context)" aria-label="Remove">✕</button>');
    const sendTitle = !live
      ? who + ' is not running'
      : queues
        ? who + ' is working; this waits in its queue and runs after its current task'
        : 'Types this into ' + who + ' as its next task';
    return `<div class="tnai-nitem" data-item="${esc(e.id)}" data-where="${where}"><div class="n-head"${where === 'bell' ? ' data-act="collapse" role="button" tabindex="0" title="Collapse" aria-expanded="true"' : ''}>${avatar(e.agent)}<div class="n-who"><b>${who} finished</b><small>${esc(e.agent)} · ${esc(ago(e.at))}${esc(took(e))}</small></div><span class="n-tag" data-k="${k}">${esc(tag)}</span>${x}</div>
${task ? `<p class="n-ask" title="${esc(task)}">${esc(task)}</p>` : ''}
${did.length ? `<div class="n-sec" data-k="did"><span>What it did</span>${list(did)}</div>` : ''}
${files.length ? `<details class="n-sec" data-k="files"><summary>Files changed (${files.length + Math.max(0, more)})</summary><div class="n-files">${files.map(f => `<code title="${esc(f)}">${esc(f)}</code>`).join('')}${more > 0 ? `<code>+${more} more</code>` : ''}</div></details>` : ''}
${blockers.length ? `<div class="n-sec" data-k="blockers"><span>Blockers</span>${list(blockers)}</div>` : ''}
${notes.length ? `<div class="n-sec" data-k="notes"><span>Notes</span>${list(notes)}</div>` : ''}
${choice ? `<div class="n-sec" data-k="choices"><span>Decision needed${choice.extracted ? ' · extracted' : ''}</span><p class="n-q">${esc(choice.question)}</p><ol class="n-opts">${choice.options.map((o, i) => `<li><span>${esc(o.label)}${o.recommended ? '<span class="tnai-rec">Recommended</span>' : ''}</span><button type="button" class="n-b${i ? '' : ' primary'}" data-act="decide" data-i="${i}"${live ? '' : ' disabled'} title="${live ? 'Types this choice into ' + who + (queues ? ' (it is working; the CLI takes it after its current task)' : '') : who + ' is not running.'}">Send</button></li>`).join('')}<li class="n-other"><input type="text" value="${esc(drafts.get(e.id) || '')}" placeholder="Something else…" aria-label="Reply in your own words" maxlength="1000"><button type="button" class="n-b" data-act="decide" data-i="other"${live ? '' : ' disabled'} title="${live ? 'Types your reply into ' + who : who + ' is not running.'}">Send</button></li></ol></div>` : ''}
${why ? `<p class="n-why">${esc(why)}</p>` : ''}${note ? `<p class="n-note">${esc(note)}</p>` : ''}
${timers.has(e.id) ? `<div class="n-auto"><span>Sending ${prefs.steps === 'all' && next.length > 1 ? 'all ' + next.length + ' next steps' : 'next step 1'} to ${who} automatically in <b data-count>${countdown(e.id)}</b></span><button type="button" class="n-b primary" data-act="auto-now">Send now</button><button type="button" class="n-b" data-act="auto-cancel" title="Keep this card; you decide what runs next">Cancel</button></div>` : ''}
${next.length ? `<div class="n-sec" data-k="next"><span>Next steps</span><ul class="n-steps">${next.map(({ t, i }) => `<li><div>${rich(t)}</div><div class="n-tools"><button type="button" class="n-b primary" data-act="send" data-i="${i}"${live ? '' : ' disabled'} title="${sendTitle}">${queues ? 'Queue for' : 'Send to'} ${who}</button><button type="button" class="n-b" data-act="compose" data-i="${i}" title="Puts it in the composer to edit and send to any agent; nothing is sent yet">Edit in composer</button></div></li>`).join('')}</ul></div>` : ''}
<div class="n-foot"><span>${where === 'card' ? (prefs.auto ? 'Automatic mode is on' : 'You decide what runs next') : ''}</span><button type="button" class="n-b" data-act="result">Open result</button>${where === 'card' ? '<button type="button" class="n-b" data-act="settings" title="Settings › Agents">Settings</button>' : ''}</div></div>`;
  }

  function paintBell() {
    const unread = items.filter(i => !i.read && alive(i)),
      count = bell.querySelector('.n-count');

    // Muted (the Mute button in the bell's panel): notifications are still collected in the
    // panel, but the bell shows no count and does not pulse, so it stops lighting up.
    if (prefs.muted) {
      count.hidden = true;
      bell.title = unread.length
        ? 'Notifications (muted): ' + unread.length + ' new'
        : 'Notifications (muted)';
      nudge([]);
      return;
    }
    count.hidden = !unread.length;
    count.textContent = unread.length > 9 ? '9+' : String(unread.length);

    // Count color: orange when one waits on you, purple when an update (Technically Not or an agent
    // CLI, notice k 'update') is new, else green.
    const upd = unread.some(i => i.notice?.k === 'update');
    count.dataset.k = unread.some(i => needsYou(entry(i.id))) ? 'blocked' : upd ? 'update' : '';
    bell.title = unread.length
      ? unread.length +
        ' new notification' +
        (unread.length > 1 ? 's' : '') +
        ' since you last looked' +
        (upd ? ' · an update is available' : '')
      : 'Notifications';
    nudge(unread);
  }

  // Nudge: unread items left untouched for prefs.nudge seconds make the count pulse a few beats,
  // again every prefs.nudge seconds while still unread. One that waits on the user (a decision or
  // blockers) keeps pulsing until the bell is opened. Opening the bell stops it (closing marks all
  // read).
  const needsYou = e => !!(e && (choicesOf(e) || hardOf(e).length));

  function nudge(unread) {
    clearTimeout(nudgeT);
    nudgeT = 0;
    const now = Date.now(),
      wait = prefs.nudge * 1000;
    const late = pop.hidden && wait ? unread.filter(i => now - i.at >= wait) : [];
    const loop = late.some(i => needsYou(entry(i.id)));
    bell.classList.toggle('n-attn-loop', loop);
    if (!late.length || loop) {
      bell.classList.remove('n-attn');
      if (!late.length) beatAt = 0;
    } else if (now - beatAt >= wait) {
      bell.classList.remove('n-attn');
      void bell.offsetWidth;
      bell.classList.add('n-attn');
      beatAt = now;
    }
    if (loop) bell.title += ' · one needs your answer';
    else if (late.length) bell.title += ' · waiting for you';
    if (!pop.hidden || !wait || !unread.length || loop) return;
    const at = Math.min(
      ...unread.filter(i => now - i.at < wait).map(i => i.at + wait),
      late.length ? beatAt + wait : Infinity
    );
    if (Number.isFinite(at)) nudgeT = setTimeout(paintBell, Math.max(1000, at - now));
  }

  function render() {
    for (let i = stack.length - 1; i >= 0; i--) if (!entry(stack[i])) stack.splice(i, 1);

    // Cards off: only what automatic mode is counting down or paused on still shows (it needs you).
    const shown = prefs.cards ? stack : stack.filter(id => timers.has(id) || whyFor.has(id));

    // The card's buttons are built anew each time, and pushes from the main process repaint it at
    // any moment: with a press in progress on the card, it is painted right after that press, so
    // the pressed button still gets its click.
    if (window.TnaiPress?.defer(card, render)) {
      // nothing here: the card keeps what is pressed
    } else if (!shown.length) {
      card.hidden = true;
      card.replaceChildren();
      expanded = false;
    } else {
      const top = shown.includes(openId) ? openId : shown[0],
        chip = prefs.compact && !expanded;
      card.classList.toggle('chip', chip);
      card.innerHTML = chip
        ? chipHtml(entry(top), shown.length)
        : (shown.length > 1
            ? `<div class="n-stackhead"><b>${shown.length} agents finished</b><span>newest first</span><button type="button" class="n-b" data-act="clear-stack" title="Dismiss all (still in the bell)">Dismiss all</button></div>`
            : '') +
          shown
            .map(id => (id === top ? detailHtml(entry(id), 'card') : rowHtml(entry(id), 'card')))
            .join('');
      card.hidden = false;
      place();
    }
    paintBell();
    if (!pop.hidden) paintPop();
    armTuck();
  }

  // Just above the docked composer, which grows with its text (46), like the permission card (45);
  // popped out or hidden, the CSS default applies.
  function place() {
    const top = document.querySelector('.composer')?.getBoundingClientRect().top;
    const docked = top > 0 && top < innerHeight - 40;
    card.style.bottom = docked ? Math.round(innerHeight - top + 12) + 'px' : '';
    card.style.maxHeight = docked ? 'min(520px,' + Math.max(160, Math.round(top - 54)) + 'px)' : '';
  }
  const composerEl = document.querySelector('.composer');
  if (composerEl && window.ResizeObserver)
    new ResizeObserver(() => {
      if (!card.hidden) place();
    }).observe(composerEl);
  window.addEventListener('resize', () => {
    if (!card.hidden) place();
  });

  // Tuck: a chip left untouched for prefs.tuck seconds flies into the bell and stays unread there.
  // Never while open, hovered or focused, and never a decision or an automatic send counting down
  // (those need to stay in sight).
  const keeps = id => timers.has(id) || !!choicesOf(entry(id) || {});

  function armTuck() {
    clearTimeout(tuckT);
    tuckT = 0;
    if (
      card.hidden ||
      expanded ||
      !prefs.tuck ||
      card.matches(':hover') ||
      card.contains(document.activeElement) ||
      !stack.some(id => !keeps(id))
    )
      return;
    tuckT = setTimeout(tuck, prefs.tuck * 1000);
  }

  function tuck() {
    const go = stack.filter(id => !keeps(id)),
      all = go.length === stack.length;
    if (!go.length || expanded) return;
    const done = () => {
      for (const id of go) {
        const i = stack.indexOf(id);
        if (i >= 0) stack.splice(i, 1);
        whyFor.delete(id);
      }
      render();
      bell.classList.remove('n-pulse');
      void bell.offsetWidth;
      bell.classList.add('n-pulse');
    };
    const b = bell.getBoundingClientRect(),
      c = card.getBoundingClientRect();
    if (!all || !b.width || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    const dx = b.left + b.width / 2 - (c.left + c.width / 2),
      dy = b.top + b.height / 2 - (c.top + c.height / 2);
    card
      .animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: `translate(${dx}px,${dy}px) scale(.08)`, opacity: 0 },
        ],
        { duration: 450, easing: 'cubic-bezier(.4,0,.2,1)' }
      )
      .finished.then(done, done);
  }
  card.addEventListener('pointerenter', () => {
    clearTimeout(tuckT);
    tuckT = 0;
  });
  card.addEventListener('pointerleave', armTuck);
  card.addEventListener('focusin', () => {
    clearTimeout(tuckT);
    tuckT = 0;
  });
  card.addEventListener('focusout', () => setTimeout(armTuck));
  bell.addEventListener('animationend', () => bell.classList.remove('n-pulse'));

  // A notice (app update, agent CLI update, integration change; 60) in the same item markup: who
  // (source), one line, tag; open shows the text and its action. Update notices are always open:
  // their 'current → new' line and Update button show without a click.
  const noticeActs = n => n.actions || (n.action ? [n.action] : []);

  function noticeHtml(it, open) {
    const fixed = it.notice.k === 'update' || it.notice.open;
    open = open || fixed; // notice.open: always shown in full (54's offers, their buttons in reach)
    const n = it.notice,
      dot = !it.read ? '<i class="n-dot" title="New"></i>' : '',
      tag = `<span class="n-tag" data-k="${esc(n.k || 'next')}">${esc(n.tag || 'Update')}</span>`;
    const head = `${avatar(n.source)}<div class="n-who"><b>${esc(n.title)}</b><small>${esc(n.source)} · ${esc(ago(it.at))}</small></div>`;
    if (!open)
      return `<div class="tnai-nitem row" data-item="${esc(it.id)}" data-where="bell" data-act="expand" role="button" tabindex="0" title="Open"><div class="n-head">${head}${dot}${tag}</div></div>`;
    return `<div class="tnai-nitem" data-item="${esc(it.id)}" data-where="bell"><div class="n-head"${fixed ? '' : ' data-act="collapse" role="button" tabindex="0" title="Collapse" aria-expanded="true"'}>${head}${tag}<button type="button" class="n-x" data-act="remove" title="Remove from this list" aria-label="Remove">✕</button></div>
${n.text ? `<p class="n-ask">${rich(n.text)}</p>` : ''}${
      noticeActs(n).length
        ? `<div class="n-foot"><span></span>${noticeActs(n)
            .map(
              (a, i) =>
                `<button type="button" class="n-b${a.primary ? ' primary' : ''}" data-act="notice" data-i="${i}"${a.id ? ` data-a="${esc(a.id)}"` : ''}${a.title ? ` title="${esc(a.title)}"` : ''}>${esc(a.label)}</button>`
            )
            .join('')}</div>`
        : ''
    }</div>`;
  }

  function paintPop() {
    // the same as the card: a press in progress on the list keeps its button until it ends
    if (window.TnaiPress?.defer(pop, paintPop)) return;
    const live = items.filter(alive);
    const muteButton = prefs.muted
      ? '<button type="button" class="n-b" data-act="mute" aria-pressed="true" title="The bell lights up again for new notifications">Unmute</button>'
      : '<button type="button" class="n-b" data-act="mute" aria-pressed="false" title="Keep collecting notifications here, without the count and the pulse on the bell">Mute</button>';
    pop.innerHTML = `<div class="n-pophead"><b>Notifications</b>${muteButton}<button type="button" class="n-b" data-act="done-all"${live.some(i => !i.notice && entry(i.id) && actionable(entry(i.id))) ? '' : ' disabled'} title="Mark every notification that still waits on you as done (also in the shared context)">Mark all done</button><button type="button" class="n-b" data-act="clear-all"${live.length ? '' : ' disabled'}>Clear</button></div>
<div class="n-list">${live.length ? live.map(i => (i.notice ? noticeHtml(i, i.id === popOpenId) : i.id === popOpenId ? detailHtml(entry(i.id), 'bell') : rowHtml(entry(i.id), 'bell'))).join('') : '<p class="n-empty">Nothing new since Technically Not opened. Finished agents and updates for Technically Not and your agent CLIs show up here, newest first.</p>'}</div>`;
  }

  function openBell(show = pop.hidden) {
    pop.hidden = !show;
    bell.setAttribute('aria-expanded', String(show));
    if (!show) {
      items.forEach(i => {
        i.read = true;
      });
      popOpenId = '';
      paintBell();
      return;
    }
    popOpenId = items.find(i => !i.read && alive(i))?.id || '';
    paintPop();
    paintBell();
    window.TnaiFloat?.attach(bell, pop, { placement: 'bottom-end' });
  }

  function dismiss(id) {
    stopTimer(id);
    const i = stack.indexOf(id);
    if (i >= 0) stack.splice(i, 1);
    const it = item(id);
    if (it) it.read = true;
    whyFor.delete(id);
    render();
  }

  function sendStep(e, text, auto) {
    const s = session(e);
    if (!s?.running) {
      say(e.name + ' is not running. Use Edit in composer to send it to another agent.');
      return false;
    }

    // Busy: sent anyway — the CLI holds it and takes it next (the card's "N queued" pill, 42).
    const n = chainOf(e) + 1;
    const msg = auto
      ? AUTO_TAG +
        n +
        '/' +
        prefs.max +
        '] Continue with the next step' +
        (/\n/.test(text) ? 's' : '') +
        ' you recommended in your last result (' +
        e.id +
        '): ' +
        text
      : text;
    if (!agents.send(s.paneId, msg)) {
      say(e.name + ' stopped before the step could be sent.');
      return false;
    }
    window.TnaiLiveTasks?.record?.(
      s.paneId,
      (auto ? 'Auto-continued: ' : 'Next step: ') + text,
      s.name + ' (' + s.agent + ')'
    );
    return true;
  }

  // What automatic mode sends: the first next step, or all of them as one numbered message.
  const autoSteps = e => {
    const next = openOf(e, 'next');
    return prefs.steps === 'all' ? next : next.slice(0, 1);
  };
  const autoText = e => {
    const steps = autoSteps(e);
    return steps.length > 1
      ? steps.map((x, n) => n + 1 + '. ' + x.t).join('\n')
      : steps[0]?.t || '';
  };

  // A step sent from a card is marked sent in Project context, so it leaves the open lists (and
  // other cards) everywhere. ✓ Mark done: the user handled these results themselves. Their open
  // steps, blockers and decision are marked done in Project context (the context:changed push then
  // settles them as Handled); the bell updates at once.
  function markDone(list) {
    const keys = list.flatMap(openKeys);
    for (const e of list) {
      const it = item(e.id);
      if (it) {
        it.note = 'Handled: marked done by you';
        it.byUser = true;
        cleared(it);
      }
      stopTimer(e.id);
      whyFor.delete(e.id);
      const i = stack.indexOf(e.id);
      if (i >= 0) stack.splice(i, 1);
    }
    if (keys.length) native.context.mark?.(keys, 'done')?.catch?.(() => {});
    if (popOpenId && list.some(e => e.id === popOpenId)) popOpenId = '';
    render();
  }

  // Setting "Close steps when an agent moves on": the next steps the bell already treats as handled
  // (nextOf, INFERRED) are also dismissed in Project context. Runs on each refresh / new turn; each
  // key is sent once.
  const closedMovedOn = new Set();

  function closeMovedOn() {
    if (!prefs.closeMovedOn) return;
    const keys = entries
      .filter(e => !e.subagent && movedOn(e))
      .flatMap(e => openOf(e, 'next').map(x => e.id + ':next:' + x.i))
      .filter(k => !closedMovedOn.has(k));
    if (!keys.length) return;
    keys.forEach(k => closedMovedOn.add(k));
    native.context.mark?.(keys, 'dismissed')?.catch?.(() => {});
  }
  const markSent = (e, idx) => {
    if (idx.length)
      native.context
        .mark?.(
          idx.map(i => e.id + ':next:' + i),
          'sent'
        )
        ?.catch?.(() => {});
  };

  // Automatic mode: decide in plain words, send only when every condition holds; otherwise explain
  // on the card.
  function autoDecide(e) {
    const s = session(e),
      steps = autoSteps(e).map(x => x.t),
      hold = holdRe(),
      c = choicesOf(e);
    if (c) return 'Paused: ' + e.name + ' needs your decision (“' + c.question.slice(0, 80) + '”).';
    if (!steps.length) return 'nothing to continue';
    if (prefs.skip.includes(window.TnaiCliIcons?.key?.(e.agent) || ''))
      return 'Paused: automatic mode is off for ' + e.agent + ' (Settings › Agents).';
    if (hardOf(e).length)
      return 'Paused: ' + e.name + ' reported blockers. You decide the next step.';
    const waits = steps.find(t => NEEDS_USER.test(t) || hold?.test(t));
    if (waits) return 'Paused: the next step waits on you (“' + waits.slice(0, 80) + '”).';
    if (chainOf(e) >= prefs.max)
      return (
        'Paused: ' +
        prefs.max +
        ' automatic steps ran in a row. Send the next one yourself to keep going.'
      );
    if (!s?.running) return 'Paused: ' + e.name + ' is not running.';
    if (busy(s) && prefs.busy !== 'queue')
      return 'Paused: ' + e.name + ' already started something else.';
    if (permissionOpen()) return 'Paused: a permission prompt is waiting for you.';
    if (window.TnaiLiveFeed?.asking?.(s.paneId))
      return 'Paused: ' + e.name + ' asked you a question.'; // 53
    return '';
  }

  const countdown = id => {
    const t = timers.get(id);
    return t ? Math.max(0, Math.ceil((t.at - Date.now()) / 1000)) + 's' : '';
  };

  // Visible countdown only (the send itself is one timeout per entry): repaint the seconds while
  // any is pending.
  function tick() {
    if (!timers.size) {
      clearInterval(ticker);
      ticker = 0;
      return;
    }
    card.querySelectorAll('[data-item]').forEach(n => {
      const b = n.querySelector('[data-count]');
      if (b) b.textContent = countdown(n.dataset.item);
    });
  }

  function stopTimer(id) {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t.t);
      timers.delete(id);
    }
  }

  // Checks again at send time: the agent may have started something, stopped, or a prompt opened
  // meanwhile.
  function fireAuto(id) {
    stopTimer(id);
    const e = entry(id);
    if (!e) return render();
    const why = autoDecide(e),
      text = autoText(e),
      idx = autoSteps(e).map(x => x.i);
    if (!why && sendStep(e, text, true)) {
      markSent(e, idx);
      const it = item(e.id);
      if (it) it.note = 'Auto-continued: ' + text;
      const i = stack.indexOf(e.id);
      if (i >= 0) stack.splice(i, 1);
      say(
        'Automatic mode: sent ' +
          e.name +
          ' its next step' +
          (/\n/.test(text) ? 's' : '') +
          ' (' +
          (chainOf(e) + 1) +
          ' of ' +
          prefs.max +
          '). Change it in Settings › Agents.'
      );
    } else if (why && why !== 'nothing to continue') whyFor.set(e.id, why);
    render();
  }

  function scheduleAuto(e) {
    // at least let the CLI settle after its Stop hook
    const wait = Math.max(SETTLE_MS, prefs.delay * 1000);
    timers.set(e.id, { at: Date.now() + wait, t: setTimeout(() => fireAuto(e.id), wait) });
    if (!ticker) ticker = setInterval(tick, 1000);
  }

  async function refresh() {
    try {
      const st = (await (window.TnaiContextState?.() ?? native.context.state())) || {};

      /* shared, debounced read (49) */ entries = st.entries || [];
      marks = st.marks || {};
    } catch {
      return;
    }
    const fresh = known ? entries.filter(e => !known.has(e.id)) : [];
    known = new Set(entries.map(e => e.id));

    // an open decision makes its agent "Needs your decision" (71 deciding) now, not on the next
    // tick
    window.TnaiAgents?.repaint?.();
    for (const e of fresh.reverse()) {
      // oldest first, so the newest ends up on top
      // a sub-agent's report already goes to its parent; everything else goes to the bell (popping
      // up is separate: prefs.cards)
      if (e.subagent) continue;
      items.unshift({ id: e.id, read: false, note: '', at: Date.now() });
      items.splice(BELL_MAX);
      if (!actionable(e)) {
        cleared(items[0]);
        continue;
      } // done: read at once, leaves the bell on its own
      if (!prefs.cards && !prefs.auto) continue; // bell only: it never pops up later either
      if (prefs.auto) {
        const why = autoDecide(e);

        // Pauses that can change in a moment (busy, prompt open) are rechecked at send time; the
        // rest are final now.
        if (!why || /already started|permission prompt/.test(why)) scheduleAuto(e);
        else if (why !== 'nothing to continue') whyFor.set(e.id, why);
      }
      stack.unshift(e.id);
      stack.splice(STACK_MAX);
      openId = e.id;
    }

    // removed in Project context
    for (let i = items.length - 1; i >= 0; i--) if (!alive(items[i])) items.splice(i, 1);
    for (const id of [...timers.keys()]) if (!entry(id)) stopTimer(id);
    answeredElsewhere(); // a reply may have started before this result was recorded
    closeMovedOn();
    settle();
    render();
  }

  // Put away: a card whose next steps, blockers and decision were all handled since (Project
  // context marks: done by a later result, merged, parked, sent, answered, dismissed…) leaves the
  // stack and the bell at once (clearDone). Pushed with context:changed like everything else.
  function settle() {
    for (const id of [...stack]) {
      const e = entry(id);
      if (!e || actionable(e) || !hadAction(e)) continue;
      stopTimer(id);
      whyFor.delete(id);
      stack.splice(stack.indexOf(id), 1);
      const it = item(id);
      if (it) {
        it.note ||= handledWhy(e);
        cleared(it);
      }
    }
    for (const it of items) {
      const e = entry(it.id);
      if (e && hadAction(e) && !actionable(e)) {
        it.note ||= handledWhy(e);
        cleared(it);
      }
    }
  }

  // Handled items leave the bell at once, open or not (nothing the user
  // already took care of, here or in a terminal, stays listed; still in Project context). ✓
  // (it.byUser) goes before the context:changed push confirms it; others once nothing is open.
  function cleared(it) {
    it.read = true;
    it.clearAt ||= Date.now();
    armClear();
  }

  function armClear() {
    if (!clearT) clearT = setTimeout(clearDone, 0);
  } // after the current pass, so a card leaving the stack goes too

  function clearDone() {
    clearT = 0;
    let gone = false;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i],
        e = entry(it.id);
      if (!it.clearAt || stack.includes(it.id) || (e && actionable(e) && !it.byUser)) continue;
      items.splice(i, 1);
      gone = true;
      if (popOpenId === it.id) popOpenId = '';
    }
    if (!gone) return;
    paintBell();
    if (!pop.hidden) paintPop();
  }

  // A notice with onRemove (54's offers: ✕ = Not now) is its owner's to put away and ask again; it
  // is not remembered as dismissed here.
  const callRemove = n => {
    try {
      n.onRemove();
    } catch (err) {
      console.error('[tnai] notice remove failed:', err);
    }
  };

  // notice key -> title the user cleared (this Technically Not run only): the next push of the same
  // title stays out of the bell
  const dismissedNotices = new Map();
  const drafts = new Map(); // "Something else" replies being typed, by result id (cards re-render)

  function onAct(b) {
    const host = b.closest('[data-item]'),
      e = host && entry(host.dataset.item),
      where = host?.dataset.where,
      act = b.dataset.act;
    if (act === 'clear-stack') {
      [...stack].forEach(dismiss);
      return;
    }
    if (act === 'clear-all') {
      items.forEach(i => {
        if (i.notice?.onRemove) callRemove(i.notice);
        else if (i.notice) dismissedNotices.set(i.notice.key, i.notice.title);
      });
      items.splice(0);
      popOpenId = '';
      render();
      return;
    }

    // Mute or unmute the bell (paintBell); the choice is kept with the other bell settings.
    if (act === 'mute') {
      prefs.muted = !prefs.muted;
      save();
      render();
      return;
    }
    if (act === 'done-all') {
      markDone(items.map(i => !i.notice && entry(i.id)).filter(x => x && actionable(x)));
      return;
    }
    const it = !e && host && item(host.dataset.item);
    if (it?.notice) {
      if (act === 'expand') {
        popOpenId = it.id;
        it.read = true;
        paintPop();
        paintBell();
      } else if (act === 'collapse') {
        popOpenId = '';
        paintPop();
      } else if (act === 'remove') {
        if (it.notice.onRemove) callRemove(it.notice);
        else dismissedNotices.set(it.notice.key, it.notice.title);
        items.splice(items.indexOf(it), 1);
        paintPop();
        paintBell();
      } else if (act === 'notice') {
        openBell(false);
        try {
          noticeActs(it.notice)[+b.dataset.i || 0]?.run?.();
        } catch (err) {
          console.error('[tnai] notice action failed:', err);
        }
      }
      return;
    }
    if (!e) return;
    const text = (e.summary?.next || [])[+b.dataset.i];
    const done = note => {
      const it = item(e.id);
      if (it) {
        it.note = note;
        it.read = true;
      }
      dismiss(e.id);
    };
    if (act === 'expand') {
      if (where === 'bell') {
        popOpenId = e.id;
        const it = item(e.id);
        if (it) it.read = true;
        paintPop();
        paintBell();
      } else {
        openId = e.id;
        expanded = true;
        render();
      }
    } else if (act === 'collapse') {
      if (where === 'bell') {
        popOpenId = '';
        paintPop();
      } else {
        expanded = false;
        render();
      }
    } else if (act === 'done') markDone([e]);
    else if (act === 'dismiss') dismiss(e.id);
    else if (act === 'auto-now') fireAuto(e.id);
    else if (act === 'auto-cancel') {
      stopTimer(e.id);
      whyFor.set(e.id, 'Automatic send cancelled. You decide what runs next.');
      render();
    } else if (act === 'remove') {
      const i = items.findIndex(x => x.id === e.id);
      if (i >= 0) items.splice(i, 1);
      dismiss(e.id);
    } else if (act === 'send' && text) {
      const s = session(e),
        wasBusy = s && busy(s);
      if (sendStep(e, text, false)) {
        markSent(e, [+b.dataset.i]);
        say(
          (wasBusy
            ? 'Queued for ' + e.name + ' — it takes this after its current task: '
            : 'Sent to ' + e.name + ': ') + text.slice(0, 80)
        );
        done((wasBusy ? 'Queued for ' : 'Sent to ') + e.name + ': ' + text);
      }
    } else if (act === 'decide') {
      drafts.delete(e.id);
      const input = b.dataset.i === 'other' ? b.closest('li').querySelector('input') : null,
        own = input?.value.trim();
      if (input && !own) {
        input.focus();
        return;
      }
      const c = choicesOf(e),
        label = own || c?.options?.[+b.dataset.i]?.label;
      if (label && c && window.TnaiContext?.decide?.(e.id + '#' + c.n, b.dataset.i, 'send', own)) {
        if (choicesOf(e)) {
          // another decision of this report is still open (49 keeps this answer until the last):
          // the card stays and shows the next
          if (where === 'bell') paintPop();
          else render();
        } else done((own ? 'Replied: ' : 'Decided: ') + label);
      }
    } else if (act === 'compose' && text) {
      if (window.TnaiContext?.toComposer?.(e.id, text, 'next')) {
        done('Put in the composer: ' + text);
        openBell(false);
      }
    } else if (act === 'result') window.TnaiResults?.open?.(b, e.paneId);
    else if (act === 'settings') window.TnaiSettings?.open?.('agents');
  }
  for (const host of [card, pop]) {
    host.addEventListener('click', event => {
      const b = event.target.closest('[data-act]');
      if (b && host.contains(b)) onAct(b);
    });
    host.addEventListener('input', event => {
      const i = event.target.closest('.n-other input'),
        h = i?.closest('[data-item]');
      if (h) drafts.set(h.dataset.item, i.value);
    });
    host.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.matches('.n-other input')) {
        event.preventDefault();
        event.target.nextElementSibling?.click();
        return;
      }
      const b = event.target.matches('[data-act=expand],.n-head[data-act=collapse]')
        ? event.target
        : null;
      if (b && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onAct(b);
      }
    });
  }
  bell.addEventListener('click', () => openBell());
  document.addEventListener(
    'pointerdown',
    event => {
      if (!pop.hidden && !pop.contains(event.target) && !bell.contains(event.target))
        openBell(false);
    },
    true
  );
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!pop.hidden) {
      openBell(false);
      bell.focus();
      return;
    }
    if (!card.hidden && card.contains(document.activeElement))
      dismiss(stack.includes(openId) ? openId : stack[0]);
  });

  // Settings › Agents (column A): manual cards and automatic mode, and what automatic mode may do.
  // Short help on each row; the full rule is in the help's hover title.
  const mount =
    document.getElementById('agentsColA') || document.getElementById('settingsPanel-agents');
  if (mount) {
    const box = document.createElement('section');
    box.className = 'set-group tnai-next-set';
    const help = (h, tip) => (h ? `<small${tip ? ` title="${esc(tip)}"` : ''}>${h}</small>` : '');
    const row = (text, h, control, cls = '', tip = '') =>
      `<label class="set-row${cls}"><span class="set-text"><b>${text}</b>${help(h, tip)}</span>${control}</label>`;
    const seg = (text, h, k, opts) =>
      `<div class="set-row"><span class="set-text"><b>${text}</b>${help(h)}</span><span class="set-seg set-seg-sm" role="radiogroup" aria-label="${esc(text)}">${opts.map(([v, l]) => `<label><input type="radio" name="n-${k}" data-k="${k}" value="${v}">${l}</label>`).join('')}</span></div>`;
    const num = (k, lo, hi, unit) =>
      `<span class="set-ctl"><input type="number" class="set-input set-num" min="${lo}" max="${hi}" data-k="${k}"><em>${unit}</em></span>`;
    box.innerHTML = `<header class="set-group-head"><div><h3>After an agent finishes</h3><p title="Every finished agent goes to the bell in the top bar. Technically Not reads the next steps and blockers from each finished result. Agents keep all their own tools; this only decides what gets sent to them next. Both can be on: automatic mode sends what is safe, the cards keep everything else for you.">Finished agents always land in the bell. Choose what else happens.</p></div></header>
<div class="set-card">
${row('Remind me about unread items', '0 = never.', num('nudge', 0, 3600, 'seconds'), '', 'The bell’s count pulses a few times, and again after the same wait while still unread. One that needs your answer (a decision or blockers) keeps pulsing until you open the bell.')}
${row('Notification sounds', 'A short chime when an agent finishes.', '<input type="checkbox" class="set-switch" id="notificationSounds">', '', 'Chimes when a Claude Code agent finishes its turn or any agent CLI session ends. Plain terminals never chime.')}
${row('Close steps when an agent moves on', 'Also in the shared context, so other agents stop listing them.', '<input type="checkbox" class="set-switch" data-k="closeMovedOn">', '', 'Once an agent gets new work in its thread (from you or another agent) or reports again, its earlier next steps count as handled in the bell. On: they are also closed (dismissed) in the shared context. Off: they stay open there until you press ✓ or they are done.')}
${row('Pop up next steps', 'A card above the composer. Nothing sends until you click.', '<input type="checkbox" class="set-switch" data-k="cards">', '', 'The card offers Send to the agent, Edit in composer, or Dismiss; several stack. Off: finished agents wait in the bell, and only automatic sends counting down (and their pauses) show.')}
<div class="tnai-next-size set-sub">
${row('Start small', 'A one-line chip; click it for the full card.', '<input type="checkbox" class="set-switch" data-k="compact">')}
${row('Tuck untouched cards into the bell', '0 = never. Decisions stay in sight.', num('tuck', 0, 600, 'seconds'))}
</div>
${row('Automatic mode', 'Sends the agent its own next step when it’s safe.', '<input type="checkbox" class="set-switch" data-k="auto">', '', 'Only when the agent reported no blockers, the step doesn’t wait on you (approve, commit, build, deploy…), and no permission prompt is open. Otherwise it pauses and shows the card, saying why.')}
<div class="tnai-next-auto set-sub">
${row('Wait before sending', 'Counts down with Send now / Cancel.', num('delay', 0, 120, 'seconds'))}
${row('Steps in a row', 'Then you send the next one.', num('max', 1, 10, 'steps'))}
${seg('Send', '', 'steps', [
  ['first', 'First step'],
  ['all', 'All steps'],
])}
${seg('If the agent is busy', '', 'busy', [
  ['pause', 'Ask me'],
  ['queue', 'Queue it'],
])}
${row('Also pause on words', 'Comma-separated.', '<input type="text" class="set-input set-text-input" data-k="hold" placeholder="database, migration, payment" spellcheck="false">', ' n-hold')}
<div class="set-row n-clis"><span class="set-text"><b>Use it for</b></span><span class="set-chips">${CLIS.map(([k, n]) => `<label class="set-chip"><input type="checkbox" data-cli="${k}">${esc(n)}</label>`).join('')}</span></div>
</div>
</div>`;
    const put = (k, v) => {
      const els = box.querySelectorAll(`[data-k=${k}]`);
      if (els[0]?.type === 'radio')
        els.forEach(r => {
          r.checked = r.value === String(v);
        });
      else if (els[0]) els[0].value = v;
    };
    const sync = () => {
      // stored by 03, played by 40 / 71
      box.querySelector('#notificationSounds').checked = !!window.TnaiNotify?.enabled?.();
      box.querySelector('[data-k=cards]').checked = !!prefs.cards;
      box.querySelector('[data-k=auto]').checked = !!prefs.auto;
      box.querySelector('[data-k=compact]').checked = !!prefs.compact;
      box.querySelector('[data-k=closeMovedOn]').checked = !!prefs.closeMovedOn;
      box.querySelector('.tnai-next-size').classList.toggle('off', !prefs.cards);
      for (const k of ['delay', 'max', 'steps', 'busy', 'hold', 'tuck', 'nudge']) put(k, prefs[k]);
      box.querySelectorAll('[data-cli]').forEach(c => {
        c.checked = !prefs.skip.includes(c.dataset.cli);
      });
      box.querySelector('.tnai-next-auto').classList.toggle('off', !prefs.auto);
    };
    box.addEventListener('change', event => {
      const t = event.target,
        k = t.dataset.k;
      if (t.id === 'notificationSounds') {
        window.TnaiNotify?.setEnabled(t.checked);
        return;
      }
      if (k === 'cards' || k === 'auto' || k === 'compact' || k === 'closeMovedOn')
        prefs[k] = t.checked;
      else if (k === 'tuck') prefs.tuck = clamp(t.value, 0, 600, DEFAULTS.tuck);
      else if (k === 'nudge') prefs.nudge = clamp(t.value, 0, 3600, DEFAULTS.nudge);
      else if (k === 'delay') prefs.delay = clamp(t.value, 0, 120, DEFAULTS.delay);
      else if (k === 'max') prefs.max = clamp(t.value, 1, 10, DEFAULTS.max);
      else if (k === 'steps' || k === 'busy' || k === 'hold')
        prefs[k] = t.value.trim ? t.value.trim() : t.value;
      else if (t.dataset.cli)
        prefs.skip = CLIS.map(([c]) => c).filter(
          c => !box.querySelector(`[data-cli="${c}"]`).checked
        );
      if (k === 'closeMovedOn') closeMovedOn();
      if (k === 'auto' && !prefs.auto)
        for (const id of [...timers.keys()]) {
          stopTimer(id);
          whyFor.set(id, 'Automatic mode was turned off. You decide what runs next.');
        }
      save();
      sync();
      render();
    });
    sync();
    mount.prepend(box);
    syncSettings = sync; // changes made through TnaiNextActions.set/setMode show here too
  }

  // A decision answered somewhere else: the user replied to that agent in its terminal (or a Build
  // panel / Agents page mirror of the same session), so a later turn started on its pane in the
  // same process. Same as Send on the card: marked 'answered' in Project context, which puts the
  // card away (settle) and updates the bell. Pushed (agent:turn), never polled; prompts from other
  // agents or Technically Not itself (delegation, hand-backs, auto-continue) don't count.
  const FROM_AGENT =
    /^\s*(\[from\b|<task-notification>|<agent-message\b|\[Subagent hand-back\]|Sub-agent report:|\[(?:TN|TechnicallyNot)\.ai\] (Sub-agent|New task from|Follow-up from|Task from|Revived for)\b|\[(?:TN|TechnicallyNot)\.ai auto-continue )/i;
  const replied = new Map(),
    // paneId -> start of the newest turn the user started there; mark keys already sent
    answered = new Set();

  function answeredElsewhere() {
    // agents.sessions() builds every session: read once for this pass, not once per entry
    let all = null;
    const keys = entries
      .filter(e => {
        if (!(replied.get(e.paneId) > +e.startedAt)) return false; // cheap test first
        const s = e.paneId && (all ||= agents.sessions()).find(x => x.paneId === e.paneId);
        return s?.running && (+s.startedAt || 0) <= +e.startedAt;
      })
      .flatMap(e =>
        (choicesOf(e) ? [e.id + ':choices:0'] : []).concat(
          openOf(e, 'blockers')
            .filter(x => mustUser(x.t))
            .map(x => e.id + ':blockers:' + x.i)
        )
      )
      .filter(k => !answered.has(k));
    if (!keys.length) return;
    keys.forEach(k => answered.add(k));
    native.context.mark?.(keys.join(','), 'answered')?.catch?.(() => {});
  }

  function onTurn(t) {
    if (!t?.paneId || !t.startedAt) return;
    if (t.startedAt > (turnAt.get(t.paneId) || 0)) {
      turnAt.set(t.paneId, t.startedAt);
      closeMovedOn();
      settle();
      render();
    } // the agent moved on: its Blocked items clear
    if (FROM_AGENT.test(t.task || '')) return;
    if (t.startedAt > (replied.get(t.paneId) || 0)) {
      replied.set(t.paneId, t.startedAt);
      answeredElsewhere();
    }
  }

  // Clicking into an agent's terminal (Terminal page, Agents page, Build panel) is looking at the
  // same thing its notifications say: they turn read.
  document.addEventListener('focusin', ev => {
    const paneId = ev.target.closest?.('[data-pane-id]')?.dataset.paneId;
    if (!paneId) return;
    let any = false;
    for (const it of items)
      if (!it.read && entry(it.id)?.paneId === paneId) {
        it.read = true;
        any = true;
      }
    if (any) {
      paintBell();
      if (!pop.hidden) paintPop();
    }
  });
  native.agentTurns?.on(onTurn);
  native.agentTurns
    ?.state()
    .then(list => (list || []).forEach(onTurn))
    .catch(() => {});

  window.addEventListener('tnai:terminal-pane-closed', event => {
    const id = event.detail?.paneId;
    if (!id) return;
    closedPanes.add(id);
    for (const e of entries)
      if (e.paneId === id) {
        stopTimer(e.id);
        whyFor.delete(e.id);
      }
    settle();
    render();
  });
  native.context.onChange(refresh);
  refresh();
  window.TnaiNextActions = {
    mode: modeOf,
    prefs: () => ({ ...prefs, skip: [...prefs.skip] }),
    // 'suggest' = cards only, 'auto' = cards + automatic, 'off' = neither (bell only when either is
    // on).
    setMode(mode, max) {
      if (['suggest', 'auto', 'off'].includes(mode)) {
        prefs.cards = mode !== 'off';
        prefs.auto = mode === 'auto';
      }
      if (max) prefs.max = clamp(max, 1, 10, 3);
      save();
      syncSettings();
      render();
    },
    set(patch) {
      prefs = { ...prefs, ...patch };
      save();
      syncSettings();
      render();
    },
    pending: () => [...stack],
    counting: () => [...timers.keys()],
    dismiss,
    refresh,
    openBell,
    // The newest unanswered "- Decide:" choice of a still-running agent that has not moved on since
    // ({ id, question, options } or null; 71 status, 11 card options: id is the context entry,
    // answered through TnaiContext.decide).
    deciding(paneId) {
      // 10's status() asks this for every pane inside agents.sessions(): a pane with no result
      // entries answers before building every session again.
      const mine = entries.filter(x => x.paneId === paneId && !x.subagent);
      if (!mine.length) return null;
      const s = agents.sessions().find(x => x.paneId === paneId);
      if (!s?.running) return null;
      const e = mine
        .filter(x => (+s.startedAt || 0) <= +(x.startedAt || x.at))
        .sort((a, b) => +b.at - +a.at)[0];
      const c = e && !movedOn(e) ? choicesOf(e) : null;

      // "<result id>#<n>": which decision of the report the row shows (49 decide)
      return c ? { ...c, id: e.id + '#' + c.n } : null;
    },
    // Bell-only notices from real checks (60) and offers (54): { key, source, title, text?, tag?,
    // k?: 'next'|'blocked'|'done'|'update' (purple count), action?: { label, run }, actions?: [{
    // id?, label, run, primary?, title? }] (several buttons), open? (always in full), onRemove?
    // (called on ✕ / Clear instead of remembering it dismissed), resolved?, group? (the bell keeps
    // only the newest notice of a group; unnotifyGroup(group) removes them all) }. Same key + same
    // title/text = no change; changed = replaced, on top, unread. resolved = read and gone at once.
    notify(n) {
      if (!n?.key || !n.title) return;
      if (dismissedNotices.has(n.key)) {
        if (dismissedNotices.get(n.key) === n.title) return;
        dismissedNotices.delete(n.key);
      }
      const id = 'notice:' + n.key,
        old = item(id);
      if (old && old.notice.title === n.title && old.notice.text === n.text) {
        old.notice = n;
        return;
      }
      if (old) items.splice(items.indexOf(old), 1);
      if (n.group)
        for (const it of items.filter(i => i.notice?.group === n.group))
          // one notice per group: the newest replaces the older ones
          items.splice(items.indexOf(it), 1);
      items.unshift({ id, read: false, note: '', at: Date.now(), notice: n });
      items.splice(BELL_MAX);
      if (n.resolved) cleared(items[0]);
      paintBell();
      if (!pop.hidden) paintPop();
    },
    unnotify(key) {
      dismissedNotices.delete(key);
      const it = item('notice:' + key);
      if (it) {
        items.splice(items.indexOf(it), 1);
        paintBell();
        if (!pop.hidden) paintPop();
      }
    },
    // Every notice of one group leaves (e.g. all "Preview ready" notices of an agent whose panel
    // closed).
    unnotifyGroup(group) {
      const gone = items.filter(i => i.notice?.group === group);
      if (!group || !gone.length) return;
      for (const it of gone) {
        dismissedNotices.delete(it.notice.key);
        items.splice(items.indexOf(it), 1);
      }
      paintBell();
      if (!pop.hidden) paintPop();
    },
  };
})();

// Technically Not · 44-agent-results.js — Desktop app only: a clean view of an agent's final answer
// once its task finishes. Main pushes the finished task's text and final answer on `agent:turn`
// (desktop/agent-turns.js: Claude Code's Stop hook, Codex's task_complete). Shown as a Result
// section at the top of the Agents page detail (25 calls paintDetail), a small Result chip next to
// the "Cooked for" meter on Overview cards (11 calls paintCard), and a Result button on Terminal
// page pane headers; the chip and button open the same view in a popover (Esc / outside click close
// it; drag its header to move it, remembered for the session). Unread results carry a subtle dot
// until seen (per pane + task start, localStorage): opening the Result, its Agents page section, or
// the agent's terminal panel on screen with the window in front; lead agents' rows on the Agent
// Tree (94) show the same dot. A long task line or answer gets Show more / Show less. A new task
// starting clears the old result. The answer is light markdown with all HTML escaped.
// window.TnaiResults (get, unread, markRead, open, close, paintCard, paintDetail, markdown,
// cleanTask, repaint). With the shared project context (49), the view leads with the structured
// summary.
(() => {
  const native = window.tnaiNative;
  if (!native?.agentTurns || !window.TnaiAgents) return;
  const agentsApi = window.TnaiAgents;

  // paneId -> finished turn with a result { startedAt, endedAt, endedBy, tokens, task, result }
  const results = new Map();

  // paneId -> startedAt of the result the user opened (a convenience only)
  const SEEN_KEY = 'tnai.result-seen.v1';
  let seen = {};
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY)) || {};
  } catch {}
  const saveSeen = () => {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch {}
  };
  const esc = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  const style = document.createElement('style');
  style.textContent = `
.tnai-result{display:grid;gap:7px;min-width:0}
.tnai-result .r-head{display:flex;align-items:center;gap:8px;min-width:0}
.tnai-result .r-meta{flex:1 1 auto;min-width:0;overflow:hidden;color:#8a9084;font:10px var(--pg-sans);font-variant-numeric:tabular-nums;white-space:nowrap;text-overflow:ellipsis}
.tnai-result .r-task{margin:0;overflow:hidden;color:#6e7467;font:10px/1.45 var(--pg-sans);white-space:nowrap;text-overflow:ellipsis}
.tnai-result .r-task b{color:#4f5549;font-weight:600}
.tnai-result button{box-sizing:border-box;flex:none;height:24px;padding:0 8px;border:1px solid #dfe3d9;border-radius:6px;background:#fff;color:#5b6353;font:10px var(--pg-sans);white-space:nowrap;cursor:pointer}
.tnai-result button:hover:not(:disabled){background:#f2f4ee}.tnai-result button[hidden]{display:none}
.tnai-result button:disabled{opacity:.5;cursor:default}
.tnai-result .r-more,.tnai-result .r-task-more{justify-self:start}
.tnai-result .r-task[data-open]{white-space:pre-wrap;overflow-wrap:anywhere}
.tnai-result .r-body{min-width:0;overflow-wrap:anywhere}
.tnai-result .r-body[data-collapsed]{max-height:calc(8 * 1.55 * 11px);overflow:hidden;-webkit-mask-image:linear-gradient(#000 70%,transparent);mask-image:linear-gradient(#000 70%,transparent)}
.tnai-result .r-body[data-collapsed][data-fits]{-webkit-mask-image:none;mask-image:none}
.tnai-md{color:#3f453a;font:11px/1.55 var(--pg-sans)}
.tnai-md>:first-child{margin-top:0}.tnai-md>:last-child{margin-bottom:0}
.tnai-md p{margin:0 0 7px}
.tnai-md :is(h4,h5,h6){margin:10px 0 5px;color:#353a30;font:600 12px/1.4 var(--pg-sans)}.tnai-md h5{font-size:11px}.tnai-md h6{font-size:10px;color:#5b6353}
.tnai-md :is(ul,ol){margin:0 0 7px;padding-left:18px}.tnai-md li{margin:2px 0}
.tnai-md code{padding:0 3px;border-radius:3px;background:#f1f3ee;color:#4a5142;font:10px Consolas,monospace}
.tnai-md pre{margin:0 0 7px;padding:8px 9px;overflow:auto;border:1px solid #edf0ea;border-radius:6px;background:#fbfcf9}
.tnai-md pre code{padding:0;background:none;font:10px/1.45 Consolas,monospace;white-space:pre}
.tnai-md hr{height:0;margin:8px 0;border:0;border-top:1px solid #edf0ea}
.tnai-md blockquote{margin:0 0 7px;padding-left:9px;border-left:2px solid #e1e5dc;color:#6e7467}
.tnai-result-dot{flex:none;width:6px;height:6px;border-radius:50%;background:#82a95f}
.tnai-result-dot[hidden]{display:none}
/* Result pill (Overview card + Terminal panel header): icon · label · chevron; a new result swaps the icon for a pulsing dot on a filled pill. */
.tnai-result-chip,.tnai-result-btn{display:inline-flex;align-items:center;gap:5px;flex:none;box-sizing:border-box;height:22px;padding:0 7px 0 8px;border:1px solid #d6e2c6;border-radius:999px;background:#f0f5e9;color:#46603a;font:600 10px/1 var(--pg-sans);letter-spacing:.02em;white-space:nowrap;cursor:pointer;box-shadow:0 1px 2px #20211f0f;transition:background .15s,border-color .15s,color .15s,box-shadow .15s,transform .1s}
.tnai-result-chip:hover,.tnai-result-btn:hover{background:#e6efdb;border-color:#c2d3ae;box-shadow:0 2px 6px #294c3d1a}
.tnai-result-chip:active,.tnai-result-btn:active{transform:scale(.97)}
.tnai-result-chip:focus-visible,.tnai-result-btn:focus-visible{outline:var(--pg-ring,2px) solid #9fbf7f;outline-offset:2px}
.tnai-result-chip[hidden],.tnai-result-btn[hidden]{display:none}
.tnai-result-chip .r-ico,.tnai-result-btn .r-ico{flex:none;width:11px;height:11px}
.tnai-result-chip .r-go,.tnai-result-btn .r-go{flex:none;width:7px;height:7px;margin-left:1px;opacity:.55;transition:transform .15s,opacity .15s}
.tnai-result-chip:hover .r-go,.tnai-result-btn:hover .r-go{opacity:1;transform:translateX(2px)}
.tnai-result-chip[data-unread],.tnai-result-btn[data-unread]{background:#46603a;border-color:#46603a;color:#f4f8ee}
.tnai-result-chip[data-unread]:hover,.tnai-result-btn[data-unread]:hover{background:#3b5230;border-color:#3b5230}
.tnai-result-chip[data-unread] .r-ico,.tnai-result-btn[data-unread] .r-ico{display:none}
:root:root :is(.tnai-result-chip,.tnai-result-btn)[data-unread] .tnai-result-dot{background-color:#c7f36b;box-shadow:0 0 0 0 #c7f36b99;animation:tnaiResultPing 1.8s ease-out infinite}
@keyframes tnaiResultPing{0%{box-shadow:0 0 0 0 #c7f36b99}70%,100%{box-shadow:0 0 0 5px #c7f36b00}}
@media (prefers-reduced-motion:reduce){:root:root :is(.tnai-result-chip,.tnai-result-btn)[data-unread] .tnai-result-dot{animation:none}}
/* Overview card: the meter and the pill share a row (the meter clips its own overflow, so the pill sits beside it, right-aligned). */
.tnai-turn-row{display:flex;align-items:center;gap:8px;min-width:0}
.tnai-turn-row>.c-turn{flex:0 1 auto;min-width:0}
.tnai-turn-row:not(:has(>:not([hidden]))){display:none}
.tnai-turn-row>.tnai-result-chip{margin:-4px 0 -4px auto}
/* Header copy (paintCard): on grid cards wider than 200px (next to the status dot), with equal space on both sides; the meter-row copy hides there. */
.tnai-card .agent-node-head>.tnai-result-chip{display:none}
@container tnai-card (min-width:201px){
.tnai-card .agent-node-head>.tnai-result-chip:not([hidden]){display:inline-flex;margin:0 auto}
.tnai-card .agent-node-head:has(>.tnai-result-chip:not([hidden]))>.agent-node-identity{flex:0 1 auto}
.tnai-card .agent-node-head:has(>.tnai-result-chip:not([hidden]))>.agent-status-pill{margin-left:0}
.tnai-card .tnai-turn-row>.tnai-result-chip{display:none}
.tnai-card .tnai-turn-row:not(:has(>.c-turn:not([hidden]))){display:none}}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-result-chip{height:18px;padding:0 6px;font-size:9px}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-result-chip .r-go{display:none}
/* Terminal panel header: before the panel tools, as tall as them (24 px); the terminal is never resized or covered. */
.tnai-result-btn{height:24px;padding:0 9px 0 10px}
.terminal-workspace-grid[data-density=dense] .tnai-result-btn{padding:0 6px}
.terminal-workspace-grid[data-density=dense] .tnai-result-btn .r-go{display:none}
/* One state per pane header: once a result is in, "Waiting for input" is implied, so only the Result button shows. */
.terminal-pane[data-has-result][data-status=waiting] .terminal-pane-state{display:none}
/* With the state label hidden, the Result pill takes over its push, so Result and the panel tools stay on the right edge. */
.terminal-pane[data-has-result][data-status=waiting] .terminal-pane-head>.tnai-result-btn{margin-left:auto}
/* Agents page: the section at the top of the detail column. */
.tnai-result-sec h3 .tnai-result-dot{align-self:center}
/* Popover (Overview chip, Terminal pane button). */
.tnai-result-pop{position:fixed;z-index:60;box-sizing:border-box;display:grid;grid-template-rows:auto minmax(0,1fr);width:min(560px,calc(100vw - 32px));max-height:min(70vh,560px);border:1px solid #e1e5dc;border-radius:9px;background:#fff;box-shadow:0 14px 40px #20211f1f;overflow:hidden}
.tnai-result-pop[hidden]{display:none}
.tnai-result-pop>.p-head{cursor:grab;touch-action:none;user-select:none}.tnai-result-pop[data-dragging]>.p-head{cursor:grabbing}
.tnai-result-pop.out{position:static;box-sizing:border-box;width:auto!important;height:100vh!important;max-height:none!important;border:0;border-radius:0;box-shadow:none}.tnai-result-pop.out>.p-head{cursor:default}
.tnai-result-pop .p-head{display:flex;align-items:center;gap:8px;min-width:0;padding:8px 8px 8px 14px;border-bottom:1px solid #edf0ea}
.tnai-result-pop .p-head b{flex:1 1 auto;min-width:0;overflow:hidden;color:#3f453a;font:600 11px var(--pg-sans);white-space:nowrap;text-overflow:ellipsis}
.tnai-result-pop .p-close{box-sizing:border-box;flex:none;width:24px;height:24px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:#81867a;font:13px/1 var(--pg-sans);cursor:pointer}
.tnai-result-pop .p-close:hover{border-color:#e5e8e0;background:#f6f7f3}
.tnai-result-pop .p-body{min-height:0;padding:12px 14px;overflow:auto}
`;
  document.head.append(style);

  // ---------- Text ----------
  // Technically Not's own framing is not the user's task: the CLI's <pasted_content> / Technically
  // Not's <pasted_text> wrapper tags, attachment references, "[TN.ai] ", the busy note, the "[New
  // task while you work on …] … New task: " wrapper. Relayed wrappers read as what they carry: a
  // sub-agent hand-back → "Sub-agent report: <its first line>", a task notification → its
  // <summary>.
  const unwrap = text => {
    const s = String(text || '');
    if (/^\s*\[Subagent hand-back\]/i.test(s)) {
      const body = (s.split(/The report follows:\s*/i)[1] || '')
        .split(/\r?\n/)
        .map(l => l.trim())
        .find(l => l && !/^[-=*#`]+$/.test(l));
      return (
        'Sub-agent report' +
        (body ? ': ' + body.replace(/^[#*\-\s]+/, '').replace(/\*\*/g, '') : '')
      );
    }
    if (/^\s*<task-notification>/i.test(s)) {
      const m = s.match(/<summary>([\s\S]*?)<\/summary>/i);
      return m ? m[1].trim() : 'Background task finished';
    }
    return s;
  };
  const cleanTask = text =>
    unwrap(String(text || '').replace(/^(\s*\[from [^\]\n]*\])+\s*/, ''))
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/<[\/\\]?(pasted_content|pasted_text)\b[^<>]*>/g, '')
      .replace(/\s*\[Attached (image|file): [^\]]*\]/g, '')
      .replace(/^\s*\[(?:TN|TechnicallyNot)\.ai\]\s*/, '')

      // relay headers from tnai send ("[from Claude Code · Lark] [from Lark] ...")
      .replace(/^(\s*\[from [^\]\n]*\])+\s*/, '')
      .replace(
        /^\[New task(?: while you work on|, unrelated to your current work on) [\s\S]*?New task:\s*/,
        ''
      )
      .replace(/^\[[^\n]*? is busy in this project[\s\S]*?first\.\]\s*/, '')
      .trim();
  const used = k => (k ? (k.input || 0) + (k.cacheWrite || 0) + (k.output || 0) : 0);

  function meta(r) {
    const fmt = window.TnaiTurns?.format;
    const time = fmt
      ? fmt.duration(r.endedAt - r.startedAt)
      : Math.round((r.endedAt - r.startedAt) / 1000) + 's';
    return (
      (r.endedBy === 'stop' ? 'Cooked for ' : 'Stopped after ') +
      time +
      (r.tokens && fmt ? ' · ' + fmt.tokens(used(r.tokens)) + ' tokens' : '')
    );
  }

  // Light markdown: headings, paragraphs, bullet/numbered lists, block quotes, rules, fenced code,
  // inline code, bold; links as their text. Every piece of the answer is escaped first, so HTML in
  // it (a <script>, an <img>) shows as text.
  function inline(raw) {
    const codes = [];
    let s = esc(String(raw).replace(/\u0000/g, '')).replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = s
      .replace(/!?\[([^\]\n]*)\]\(([^)\s]*)[^)]*\)/g, (_, label, url) => label || url)
      .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<b>$1</b>')

      // __bold__ only as whole words, never inside snake__names
      .replace(/(^|[^\w])__(?=\S)([^_\n]*?\S)__(?!\w)/g, '$1<b>$2</b>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + codes[+i] + '</code>');
  }

  function markdown(text) {
    const lines = String(text || '')
        .replace(/\r\n?/g, '\n')
        .split('\n'),
      out = [];
    let para = [],
      list = null,
      quote = [];
    const flushPara = () => {
      if (para.length) out.push('<p>' + para.map(inline).join('<br>') + '</p>');
      para = [];
    };
    const flushList = () => {
      // Numbers of two or more digits need a wider left gutter, or "19." is clipped at the edge
      const lastNumber = list ? list.start + list.items.length - 1 : 0;
      const digits = String(lastNumber).length;
      if (list)
        out.push(
          '<' +
            list.tag +
            (list.start > 1 ? ' start="' + list.start + '"' : '') +
            (list.tag === 'ol' && digits > 1 ? ' data-digits="' + Math.min(digits, 3) + '"' : '') +
            '>' +
            list.items.map(i => '<li>' + inline(i) + '</li>').join('') +
            '</' +
            list.tag +
            '>'
        );
      list = null;
    };
    const flushQuote = () => {
      if (quote.length) out.push('<blockquote>' + quote.map(inline).join('<br>') + '</blockquote>');
      quote = [];
    };
    const flush = () => {
      flushPara();
      flushList();
      flushQuote();
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        flush();
        const code = [];
        while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i]);
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      if (!line.trim()) {
        flushPara();
        flushQuote();
        if (list && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i + 1] || '')) flushList();
        continue;
      }
      const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) {
        flush();
        const tag = h[1].length === 1 ? 'h4' : h[1].length === 2 ? 'h5' : 'h6';
        out.push('<' + tag + '>' + inline(h[2]) + '</' + tag + '>');
        continue;
      }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flush();
        out.push('<hr>');
        continue;
      }
      const q = line.match(/^\s{0,3}>\s?(.*)$/);
      if (q) {
        flushPara();
        flushList();
        quote.push(q[1]);
        continue;
      }
      const bullet = line.match(/^\s*[-*+]\s+(.*)$/),
        num = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      if (bullet || num) {
        flushPara();
        flushQuote();
        const tag = bullet ? 'ul' : 'ol';
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag, items: [], start: num ? +num[1] : 1 };
        list.items.push(bullet ? bullet[1] : num[2]);
        continue;
      }
      if (list && /^\s{2,}\S/.test(line)) {
        list.items[list.items.length - 1] += ' ' + line.trim();
        continue;
      } // an item's continuation line
      flushList();
      flushQuote();
      para.push(line.trim());
    }
    flush();
    return out.join('');
  }

  // ---------- State ----------
  const get = paneId => results.get(paneId) || null;
  const unread = paneId => {
    const r = results.get(paneId);
    return !!r && seen[paneId] !== r.startedAt;
  };

  function markRead(paneId) {
    const r = results.get(paneId);
    if (!r || seen[paneId] === r.startedAt) return;
    seen[paneId] = r.startedAt;
    saveSeen();
    repaintSoon();
  }

  function apply(t) {
    if (!t?.paneId) return;
    const had = results.get(t.paneId);
    if (!t.cleared && t.endedAt && t.result)
      results.set(t.paneId, {
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        endedBy: t.endedBy || '',
        tokens: t.tokens || null,
        task: cleanTask(t.task),
        result: String(t.result),
      });

    // a new task started (or the pane was forgotten): the old result goes
    else results.delete(t.paneId);
    const now = results.get(t.paneId);
    if (had !== now) repaintSoon();
  }

  // The answer up to its last "Technically Not report" line (the block agents end with;
  // desktop/agent-context.js parses it).
  const withoutReport = text => {
    const lines = String(text).split('\n');
    for (let i = lines.length - 1; i >= 0; i--)
      if (/^\W*(?:technically not|tnai) report\W*$/i.test(lines[i].trim()))
        return lines.slice(0, i).join('\n').trimEnd();
    return text;
  };

  // ---------- The view (Agents page section and popover body) ----------
  function view(paneId, { collapsed = true } = {}) {
    const r = get(paneId);
    if (!r) return null;
    const box = document.createElement('div');
    box.className = 'tnai-result';
    box.dataset.pane = paneId;
    box.innerHTML =
      '<div class="r-head"><span class="r-meta"></span><button type="button" class="r-follow">Follow up</button><button type="button" class="r-second">Second opinion</button><button type="button" class="r-copy" title="Copy the answer as text">Copy</button></div>' +
      (r.task
        ? '<p class="r-task"><b>Task</b> · <span></span></p><button type="button" class="r-task-more" hidden>Show more</button>'
        : '') +
      '<div class="r-body tnai-md"></div><button type="button" class="r-more" hidden>Show more</button>';
    const metaText = meta(r);
    box.querySelector('.r-meta').textContent = metaText;
    box.querySelector('.r-meta').title =
      metaText + ' · ended ' + new Date(r.endedAt).toLocaleString();
    if (r.task) {
      const t = box.querySelector('.r-task');
      t.lastChild.textContent = r.task;
      t.title = r.task;
    }
    const body = box.querySelector('.r-body'),
      more = box.querySelector('.r-more');

    // The structured summary from the shared project context (49), above the full answer (without
    // its report block, which the summary shows).
    const sum = window.TnaiContext?.summaryFor(paneId, r.startedAt);
    body.innerHTML = markdown(sum ? withoutReport(r.result) : r.result);
    if (sum) {
      const label = document.createElement('p');
      label.className = 'r-label';
      label.textContent = 'Full answer';
      box.insertBefore(sum, body);
      box.insertBefore(label, body);
    }
    if (collapsed) body.dataset.collapsed = '';

    // "Show more" only when the task line / answer is longer than the space shown (measured once on
    // screen and on every resize).
    const taskEl = box.querySelector('.r-task'),
      taskMore = box.querySelector('.r-task-more');
    const measure = () => {
      if (taskEl && !taskEl.hasAttribute('data-open'))
        taskMore.hidden = taskEl.scrollWidth <= taskEl.clientWidth + 1;
      if (!body.hasAttribute('data-collapsed')) return;
      const fits = body.scrollHeight <= body.clientHeight + 1;
      more.hidden = fits;
      body.toggleAttribute('data-fits', fits);
    };
    box._measure = measure;
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    if (taskEl) ro.observe(taskEl); // also when a hidden page with it is shown
    box.addEventListener('click', event => {
      if (event.target.closest('.r-task-more')) {
        const open = !taskEl.hasAttribute('data-open');
        taskEl.toggleAttribute('data-open', open);
        taskMore.textContent = open ? 'Show less' : 'Show more';
        taskMore.hidden = false;
      } else if (event.target.closest('.r-more')) {
        const open = body.hasAttribute('data-collapsed');
        body.toggleAttribute('data-collapsed', !open);
        more.textContent = open ? 'Show less' : 'Show more';
        more.hidden = false;
      } else if (event.target.closest('.r-follow')) {
        const b = event.target.closest('.r-follow');
        if (followUp(paneId)) {
          b.textContent = 'Sent';
          b.disabled = true;
          setTimeout(() => {
            b.textContent = 'Follow up';
            paintFollow(b);
          }, 1800);
        }
      } else if (event.target.closest('.r-second')) {
        secondOpinion(paneId, event.target.closest('.r-second'));
      } else if (event.target.closest('.r-copy')) {
        const b = event.target.closest('.r-copy');
        (box.ownerDocument.defaultView || window).navigator.clipboard?.writeText(r.result).then(
          () => {
            b.textContent = 'Copied';
            setTimeout(() => {
              b.textContent = 'Copy';
            }, 1400);
          },
          () => {
            b.textContent = 'Copy failed';
            setTimeout(() => {
              b.textContent = 'Copy';
            }, 1400);
          }
        );
      }
    });
    paintFollow(box.querySelector('.r-follow'));
    paintSecond(box.querySelector('.r-second'));
    return box;
  }

  // ---------- Follow up: ask the same agent (its own pane) to look into what remains of this task
  // and recommend next steps ----------
  const sessionOf = paneId => agentsApi.sessions().find(s => s.paneId === paneId) || null;

  function paintFollow(b) {
    if (!b || b.textContent === 'Sent') return;
    const s = sessionOf(b.closest('.tnai-result')?.dataset.pane),
      on = !!s?.running;
    b.disabled = !on;
    const tip = on
      ? 'Ask ' +
        s.name +
        ' to look into what remains from this task and recommend next steps' +
        (s.status === 'working' ? ' (it is busy: its CLI takes it next)' : '')
      : (s?.name || 'This agent') + ' is not running. Resume it in its thread to follow up.';
    if (b.title !== tip) b.title = tip;
  }
  const paintFollowAll = () => {
    document.querySelectorAll('.tnai-result .r-follow').forEach(paintFollow);
    document.querySelectorAll('.tnai-result .r-second').forEach(paintSecond);
  };

  // ---------- Second opinion: a fresh agent of a DIFFERENT AI tool checks this
  // finished work and reports what it finds. It is told to change nothing. Only on a click, never
  // by itself: it spends that tool's usage. Started the way a hand-off starts its successor (19
  // startLead). ---------- CLIs that can take a task as a new agent, in order of preference
  const REVIEWERS = ['Codex', 'Claude Code', 'OpenCode', 'Cursor Agent'];
  const say = message => (typeof toast === 'function' ? toast : console.info)(message);
  const reviewerFor = paneId => {
    const own = sessionOf(paneId)?.agent || '',
      info = agentsApi.info?.() || [];
    return own
      ? REVIEWERS.find(
          id => id !== own && info.some(a => a.id === id && a.installed && a.loggedIn !== false)
        ) || ''
      : '';
  };

  function paintSecond(b) {
    if (!b || b.dataset.busy) return;
    const paneId = b.closest('.tnai-result')?.dataset.pane,
      s = sessionOf(paneId),
      who = reviewerFor(paneId),
      on = !!who && !!window.TnaiTeam?.startLead;
    b.disabled = !on;
    const tip = on
      ? 'Start a new ' +
        who +
        ' agent to check this work on its own and report what it finds. It is told to change no files. Uses your ' +
        who +
        ' usage.'
      : !s || s.agent === 'Terminal'
        ? 'A second opinion needs the agent that did this work to still have its thread.'
        : 'A second opinion needs another AI tool that is installed and signed in (this work was done by ' +
          s.agent +
          ').';
    if (b.title !== tip) b.title = tip;
  }

  async function secondOpinion(paneId, b) {
    const s = sessionOf(paneId),
      r = get(paneId),
      who = reviewerFor(paneId);
    if (!s || !r || !who || b.dataset.busy) return false;
    if (window.TnaiPaneLimit?.full?.()) {
      say(
        'This workspace is full, so there is no room for the agent that would check this. Close a thread first.'
      );
      return false;
    }
    const done = (label, ms) => {
      b.textContent = label;
      setTimeout(() => {
        delete b.dataset.busy;
        b.textContent = 'Second opinion';
        paintSecond(b);
      }, ms);
    };
    b.dataset.busy = '1';
    b.disabled = true;
    b.textContent = 'Starting ' + who + '…';
    let next = null;
    try {
      next = await window.TnaiTeam.startLead({ agent: who });
    } catch (error) {
      next = { error: error?.message || String(error) };
    }
    if (!next?.paneId) {
      say('Second opinion not started: ' + (next?.error || who + ' could not start') + '.');
      done('Not started', 2500);
      return false;
    }
    const clip = (t, n) => {
      t = String(t).replace(/\s+/g, ' ').trim();
      return t.length > n ? t.slice(0, n - 1) + '…' : t;
    };
    const e = window.TnaiContext?.entryFor?.(paneId, r.startedAt),
      files = (e?.files || []).slice(0, 30);
    const body =
      'Second opinion: you are a second pair of eyes from a different AI tool. ' +
      s.name +
      ' (' +
      s.agent +
      ') just finished a task in this project' +
      (r.task ? ': "' + clip(r.task, 500) + '"' : '') +
      '. ' +
      'Check that work on your own and say plainly what is wrong, risky or not proven, and what is fine. Read what it changed (git diff where it helps) and run only cheap checks that change nothing. ' +
      'Do not edit, create or delete any file, do not redo the task, and do not commit. ' +
      (files.length ? 'Files it changed: ' + files.join(', ') + '. ' : '') +
      (e?.id
        ? 'Its full answer: run `tnai context show ' + e.id + '`. '
        : 'Its answer, shortened: ' + clip(r.result, 1500) + ' ') +
      'End with your usual Technically Not report, each problem under "- Found:" with a one-sentence fix.';
    if (!agentsApi.send(next.paneId, who === 'Claude Code' ? '[TN.ai] ' + body : body)) {
      say((next.name || who) + ' stopped before the request could be sent.');
      done('Not sent', 2500);
      return false;
    }
    window.TnaiLiveTasks?.record?.(
      next.paneId,
      'Second opinion on ' + s.name + '’s work' + (r.task ? ' ("' + clip(r.task, 120) + '")' : ''),
      (next.name || who) + ' (' + who + ')'
    );
    done('Asked ' + (next.name || who), 4000);
    return true;
  }

  function followUp(paneId) {
    const s = sessionOf(paneId),
      r = get(paneId);
    if (!s?.running || !r) {
      (typeof toast === 'function' ? toast : console.info)(
        (s?.name || 'This agent') + ' is not running.'
      );
      return false;
    }
    const task = r.task
      ? ' ("' + (r.task.length > 200 ? r.task.slice(0, 200) + '…' : r.task) + '")'
      : '';
    const body =
      'Follow up on your last task' +
      task +
      ': look into what remains from it (anything unfinished, unverified, blocked or left as a TODO), check its current state in the project, ' +
      "and recommend the next steps in priority order with a short reason for each. Don't start the next steps yet; only small checks needed to answer. End with your usual Technically Not report.";
    if (
      !agentsApi.send(
        paneId,
        s.agent === 'Claude Code' && window.TnaiTeam ? '[TN.ai] ' + body : body
      )
    ) {
      (typeof toast === 'function' ? toast : console.info)(
        s.name + ' stopped before the follow-up could be sent.'
      );
      return false;
    }
    window.TnaiLiveTasks?.record?.(
      paneId,
      'Follow up: remaining work and next steps' + task,
      s.name + ' (' + s.agent + ')'
    );
    return true;
  }
  const keyOf = paneId => {
    const r = get(paneId),
      e = r && window.TnaiContext?.entryFor(paneId, r.startedAt);
    return r
      ? paneId +
          ':' +
          r.startedAt +
          ':' +
          r.endedAt +
          ':' +
          r.result.length +
          ':' +
          (e ? e.id + (e.delivered?.length || 0) + (e.queued?.length || 0) : '')
      : '';
  };

  // ---------- Popover ----------
  let pop = null,
    popPane = '',
    popAnchor = null;

  // where the user dragged the popover (this session): it opens there, kept inside the window,
  // instead of beside its button
  let dragPos = null;

  function close() {
    if (!pop || pop.hidden) return;
    if (isOut()) {
      window.TnaiPopout.back(POP_ID);
      return;
    }
    pop.hidden = true;
    popPane = '';
    popAnchor = null;
  } // its own window: closed with it (onBack)

  // Pop out (93): the Result card in its own OS window, e.g. on another monitor; ⤡ puts it back
  // beside its button, × / closing the window closes it.
  const POP_ID = 'result';
  const isOut = () => !!window.TnaiPopout?.isOut(POP_ID);
  let keepOnBack = false;

  function paintPop() {
    const b = pop?.querySelector('.p-pop');
    if (!b) return;
    b.hidden = !window.TnaiPopout?.available();
    const out = isOut();
    b.textContent = out ? '⤡' : '⤢';
    b.title = out
      ? 'Put the result back into Technically Not'
      : 'Pop out into its own window: place it on any monitor';
    b.setAttribute('aria-label', out ? 'Bring back' : 'Pop out');
  }

  function popOut() {
    if (!pop || pop.hidden || isOut()) return false;
    const name = agentsApi.sessions().find(s => s.paneId === popPane)?.name || '';
    const win = window.TnaiPopout.open(POP_ID, pop, {
      title: 'Result' + (name ? ' · ' + name : ''),
      head: pop.querySelector('.p-head'),
      width: 560,
      height: 640,
      onBack: () => {
        pop.style.left = pop.style.top = '';
        dragPos = null;
        if (keepOnBack && popAnchor?.isConnected) {
          keepOnBack = false;
          paintPop();
          place();
          return;
        }
        keepOnBack = false;
        pop.hidden = true;
        popPane = '';
        popAnchor = null;
        paintPop();
      },
    });
    if (!win) {
      try {
        toast('Could not open a separate window');
      } catch {}
      return false;
    }
    listen(win.document);
    paintPop();
    return true;
  }

  function popIn() {
    keepOnBack = true;
    window.TnaiPopout.back(POP_ID);
  }

  function place() {
    if (!pop || pop.hidden || !popAnchor || isOut() || pop.hasAttribute('data-tnai-resizing'))
      return; // 67: the user is resizing it: stay put
    const a = popAnchor.getBoundingClientRect(),
      w = pop.offsetWidth,
      h = pop.offsetHeight,
      m = 16,
      window = pop.ownerDocument.defaultView || self; // its own window (an Overview pop-out, 79)
    if (dragPos) {
      pop.style.left = Math.max(m, Math.min(dragPos.left, window.innerWidth - w - m)) + 'px';
      pop.style.top = Math.max(m, Math.min(dragPos.top, window.innerHeight - h - m)) + 'px';
      return;
    }

    // Its button is not drawn any more (the window got narrower and the row folded it away, or
    // its page is not the one on screen): the popover stays where it is, inside the window. Placed
    // by a button with no place it jumped to the window's top left corner.
    if (!popAnchor.isConnected || !popAnchor.getClientRects().length) {
      const now = pop.getBoundingClientRect();
      pop.style.left = Math.max(m, Math.min(now.left, window.innerWidth - w - m)) + 'px';
      pop.style.top = Math.max(m, Math.min(now.top, window.innerHeight - h - m)) + 'px';
      return;
    }
    const below = window.innerHeight - a.bottom - m,
      above = a.top - m;
    const top = h <= below || below >= above ? a.bottom + 6 : Math.max(m, a.top - 6 - h);
    pop.style.top =
      Math.min(top, window.innerHeight - m - Math.min(h, window.innerHeight - 2 * m)) + 'px';
    pop.style.left = Math.max(m, Math.min(a.right - w, window.innerWidth - w - m)) + 'px';
  }

  function open(anchor, paneId) {
    if (!get(paneId)) return false;
    if (!pop) {
      pop = document.createElement('section');
      pop.className = 'tnai-result-pop';
      pop.hidden = true;
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Result');
      pop.innerHTML =
        '<div class="p-head"><b></b><button type="button" class="p-close p-pop" hidden></button><button type="button" class="p-close p-x" title="Close (Esc)" aria-label="Close">×</button></div><div class="p-body"></div>';
      pop.querySelector('.p-x').addEventListener('click', close);
      pop.querySelector('.p-pop').addEventListener('click', () => (isOut() ? popIn() : popOut()));

      // Drag by the header (not from its buttons/links) to move it; pointer capture keeps the drag
      // while the pointer leaves the header.
      const head = pop.querySelector('.p-head');
      head.addEventListener('pointerdown', event => {
        if (event.button !== 0 || isOut() || event.target.closest('button,a,input,select,textarea'))
          return;
        event.preventDefault();
        const r = pop.getBoundingClientRect(),
          dx = event.clientX - r.left,
          dy = event.clientY - r.top;
        try {
          head.setPointerCapture(event.pointerId);
        } catch {}
        pop.dataset.dragging = '';
        const move = e => {
          dragPos = { left: e.clientX - dx, top: e.clientY - dy };
          place();
        };
        const end = () => {
          head.removeEventListener('pointermove', move);
          head.removeEventListener('pointerup', end);
          head.removeEventListener('pointercancel', end);
          delete pop.dataset.dragging;
        };
        head.addEventListener('pointermove', move);
        head.addEventListener('pointerup', end);
        head.addEventListener('pointercancel', end);
      });

      // Show more / less changes its height: keep it inside the window
      new ResizeObserver(place).observe(pop);
    }

    // In the anchor's own document: a card popped out into its own window (79) shows its Result
    // there, with Esc / outside click. popped out (93): it stays in its own window
    const home = isOut() ? pop.ownerDocument : anchor?.ownerDocument || document;
    if (pop.ownerDocument !== home || !pop.isConnected) {
      dragPos = null;
      pop.hidden = true;
      home.body.append(pop);
      listen(home);
    }
    if (popPane === paneId && !pop.hidden) {
      if (isOut()) {
        window.TnaiPopout.window(POP_ID)?.focus();
        return true;
      }
      close();
      return true;
    } // the chip / button toggles (its own window: brought to the front)
    const name = agentsApi.sessions().find(s => s.paneId === paneId)?.name || '';
    pop.querySelector('.p-head b').textContent = 'Result' + (name ? ' · ' + name : '');
    const v = view(paneId);
    pop.querySelector('.p-body').replaceChildren(v);
    pop.dataset.key = keyOf(paneId);
    popPane = paneId;
    popAnchor = anchor;
    pop.hidden = false;
    paintPop();
    place();
    requestAnimationFrame(() => {
      v._measure?.();
      place();
    });
    markRead(paneId);
    return true;
  }

  // A modal dialog on top (session start, confirm, update…) owns Escape: leave the popover alone.
  const modalOpen = () =>
    [...document.querySelectorAll('[aria-modal="true"]')].some(m => m.getClientRects().length);
  const listened = new WeakSet();

  function listen(doc) {
    if (listened.has(doc)) return;
    listened.add(doc);
    doc.addEventListener(
      'keydown',
      event => {
        if (
          event.key === 'Escape' &&
          pop &&
          !pop.hidden &&
          !modalOpen() &&
          (!isOut() || doc === pop.ownerDocument)
        ) {
          event.stopPropagation();
          close();
        }
      },
      true
    );
    doc.addEventListener(
      'mousedown',
      event => {
        if (
          pop &&
          !pop.hidden &&
          !isOut() &&
          !pop.contains(event.target) &&
          !(popAnchor && popAnchor.contains(event.target))
        )
          close();
      },
      true
    ); // popped out: clicks elsewhere leave it open
  }
  listen(document);

  // A window resize keeps it open and moves it with its button (or keeps it inside the window when
  // the button is gone / hidden by the new layout).
  window.addEventListener('resize', () => {
    if (!pop || pop.hidden || isOut()) return;
    place();
  });

  // ---------- Where it shows ----------
  const dot = () => '<i class="tnai-result-dot" aria-hidden="true"></i>';

  function paintTrigger(btn, paneId) {
    const r = get(paneId);
    btn.hidden = !r;
    if (!r) return;
    btn.dataset.pane = paneId;
    const u = unread(paneId);
    btn.querySelector('.tnai-result-dot').hidden = !u;
    btn.toggleAttribute('data-unread', u);
    const tip =
      (u ? 'New result · ' : 'Result · ') +
      meta(r) +
      (r.task ? '\n' + r.task.slice(0, 200) : '') +
      '\nClick to read the final answer';
    if (btn.title !== tip) btn.title = tip;
  }

  function trigger(cls, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.hidden = true;
    b.draggable = false;
    b.innerHTML =
      '<svg class="r-ico" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5h4l2.5 2.5v6.5H3z"/><path d="M4.7 7.2l1.1 1.1 2-2.3"/></svg>' +
      dot() +
      '<span>' +
      label +
      '</span>' +
      '<svg class="r-go" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 1.2 5.3 4 2.5 6.8"/></svg>';

    // Its own click only: an Overview card click opens the Agents page, a pane header is draggable.
    b.addEventListener('click', event => {
      event.stopPropagation();
      event.preventDefault();
      open(b, b.dataset.pane);
    });
    b.addEventListener('mousedown', event => event.stopPropagation());
    b.addEventListener('dragstart', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    return b;
  }

  const painted = new Map(); // host element -> { kind, paneId } for repaints on pushed turns

  // A host that left the page (a card of a workspace no longer shown, a closed pane) is dropped
  // when a new one is added, so removed cards are not kept alive between repaints.
  const track = (el, v) => {
    if (!painted.has(el)) for (const k of painted.keys()) if (!k.isConnected) painted.delete(k);
    painted.set(el, v);
  };

  // Overview card: two hosts, CSS shows one. Grid cards wider than 330px: in the header, centered
  // between the name and the status dot. Narrower cards: beside the task meter (42), right-aligned
  // on its row. The meter clips its own overflow, so the pill never sits inside it.
  function paintCard(el, s) {
    if (!el || !s) return;
    track(el, { kind: 'card', paneId: s.paneId });
    const meter = el.querySelector('.c-turn'),
      head = el.querySelector('.agent-node-head');
    if (!meter || !head) return;
    let chip = meter.parentElement.querySelector(':scope>.tnai-result-chip'),
      headChip = head.querySelector(':scope>.tnai-result-chip');
    if (!chip) {
      if (!get(s.paneId)) return;
      chip = trigger('tnai-result-chip', 'Result');
      let row = meter.parentElement;
      if (!row.classList.contains('tnai-turn-row')) {
        row = document.createElement('div');
        row.className = 'tnai-turn-row';
        meter.before(row);
        row.append(meter);
      }
      row.append(chip);
    }
    if (!headChip) {
      headChip = trigger('tnai-result-chip', 'Result');
      head.querySelector('.agent-node-identity')?.after(headChip);
    }
    paintTrigger(chip, s.paneId);
    paintTrigger(headChip, s.paneId);
  }

  // Agents page: a Result section at the top of the detail column; opening it there counts as read.
  function paintDetail(box, s) {
    if (!box || !s) return;
    track(box, { kind: 'detail', paneId: s.paneId });
    const side = box.querySelector('.ap-side');
    if (!side) return;
    let sec = side.querySelector(':scope>.tnai-result-sec');
    const r = get(s.paneId);
    if (!r) {
      if (sec) {
        sec.hidden = true;
        sec.dataset.key = '';
      }
      return;
    }
    if (!sec) {
      sec = document.createElement('section');
      sec.className = 'ap-sec tnai-result-sec';
      sec.innerHTML = '<h3><span>RESULT</span>' + dot() + '</h3><div></div>';
      side.prepend(sec);
    }
    sec.hidden = false;
    const key = keyOf(s.paneId);
    if (sec.dataset.key !== key) {
      sec.dataset.key = key;
      sec.lastElementChild.replaceChildren(view(s.paneId));
    }
    sec.querySelector('h3 .tnai-result-dot').hidden = !unread(s.paneId);

    // Read once shown for 600 ms. Its visibility is checked in the timer, not here: offsetParent
    // right after the writes above forced a layout per paint, and paints come in bursts while
    // agents finish (a cause of page-switch lag).
    if (document.visibilityState === 'visible' && !sec.tnaiReadTimer)
      sec.tnaiReadTimer = setTimeout(() => {
        sec.tnaiReadTimer = 0;
        const id = painted.get(box)?.paneId;
        if (id && sec.isConnected && sec.offsetParent && sec.dataset.key === keyOf(id))
          markRead(id);
      }, 600);
  }

  // Terminal page pane headers: a Result button before the pane tools.
  function paintPanes() {
    document.querySelectorAll('.terminal-pane[data-pane-id]').forEach(pane => {
      const head = pane.querySelector('.terminal-pane-head');
      if (!head) return;
      let b = head.querySelector(':scope>.tnai-result-btn');
      if (!b) {
        if (!get(pane.dataset.paneId)) return;
        b = trigger('tnai-result-btn', 'Result');
        const tools = head.querySelector('.terminal-pane-tools');
        tools ? head.insertBefore(b, tools) : head.append(b);
      }
      paintTrigger(b, pane.dataset.paneId);

      // a finished result replaces the "Waiting for input" pill (CSS below)
      pane.toggleAttribute('data-has-result', !b.hidden);
      if (seenIO && !watched.has(pane)) {
        watched.add(pane);
        seenIO.observe(pane);
      }
    });
    checkSeen();
  }

  // Seeing the agent's terminal panel counts as seeing its result, on any page: a
  // panel on screen for 600 ms while this window is in front marks it read, the same as the Agents
  // page Result section. Pushed by IntersectionObserver (a page switch shows or hides the panel),
  // window focus and new results; never polled. Extra terminal views (33 marks their host with
  // data-pane) count the same, on the page or popped out into their own window (93, 23), while that
  // window is in front.
  const onScreen = new Set(),
    watched = new WeakSet(),
    popWins = new Set();
  const seenIO =
    'IntersectionObserver' in window
      ? new IntersectionObserver(entries => {
          for (const e of entries)
            e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target);
          checkSeen();
        })
      : null;
  const inFront = doc => doc.visibilityState === 'visible' && doc.hasFocus();
  const buildViews = () =>
    [document, ...[...popWins].filter(w => !w.closed).map(w => w.document)].flatMap(d => [
      ...d.querySelectorAll('.bw-term-host[data-pane]'),
    ]);
  let seenTimer = 0;

  function checkSeen() {
    if (seenTimer || ![...results.keys()].some(unread)) return;
    seenTimer = setTimeout(() => {
      seenTimer = 0;
      if (inFront(document))
        for (const pane of onScreen) {
          if (!pane.isConnected) {
            onScreen.delete(pane);
            continue;
          }
          const id = pane.dataset.paneId;
          if (id && pane.offsetParent && unread(id)) markRead(id);
        }
      for (const host of buildViews())
        if (unread(host.dataset.pane) && host.offsetParent && inFront(host.ownerDocument))
          markRead(host.dataset.pane);
    }, 600);
  }
  window.addEventListener('focus', checkSeen);
  document.addEventListener('visibilitychange', checkSeen);
  window.addEventListener('tnai:panel-popout', event => {
    const win = event.detail?.win;
    if (!win || popWins.has(win)) return;
    for (const w of popWins) if (w.closed) popWins.delete(w);
    popWins.add(win);
    win.addEventListener('focus', checkSeen);
    setTimeout(checkSeen, 300); // its panel is moved in right after this event
  });

  // Finished turns and context refreshes come in bursts (several per frame while agents finish):
  // they repaint once, on the next frame, or within 100 ms when the window isn't painting, so a
  // page the user just clicked to isn't redrawn once per push first.
  let repaintQueued = 0;
  const repaintSoon = () => {
    if (repaintQueued) return;
    repaintQueued = 1;
    const run = () => {
      if (repaintQueued) {
        repaintQueued = 0;
        repaint();
      }
    };
    requestAnimationFrame(run);
    setTimeout(run, 100);
  };

  function repaint() {
    paintPanes();

    // read once: it builds every session afresh
    const sessions = painted.size ? agentsApi.sessions() : [];
    for (const [el, { kind, paneId }] of painted) {
      if (!el.isConnected) {
        painted.delete(el);
        continue;
      }
      const s = sessions.find(x => x.paneId === paneId) || { paneId };
      kind === 'card' ? paintCard(el, s) : paintDetail(el, s);
    }

    // The open popover follows its pane: a new task closes it, a newer result replaces it.
    if (pop && !pop.hidden) {
      if (isOut() ? !popPane : !get(popPane) || !popAnchor?.isConnected) close();
      else if (isOut() && !get(popPane)) {
        /* popped out: a new task keeps the last result shown until the next one */
      } else if (pop.dataset.key !== keyOf(popPane)) {
        const a = popAnchor,
          p = popPane;
        popPane = '';
        open(a, p);
      }
    }
  }

  native.agentTurns.on(apply);
  native.agentTurns
    .state()
    .then(list => (list || []).forEach(apply))
    .catch(() => {});
  let frame = 0; // session changes come in bursts while agents work: at most one repaint per frame
  agentsApi.onChange(() => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        paintPanes();
        paintFollowAll();
      });
  });
  window.addEventListener('tnai:terminal-pane-renamed', paintPanes);
  window.addEventListener('tnai:terminal-pane-closed', event => {
    const id = event.detail?.paneId;
    if (!id) return;
    results.delete(id);
    if (id in seen) {
      delete seen[id];
      saveSeen();
    }
    if (popPane === id) close();
  });

  window.TnaiResults = {
    get: paneId => (get(paneId) ? { ...get(paneId) } : null),
    unread,
    markRead,
    open,
    close,
    paintCard,
    paintDetail,
    markdown,
    cleanTask,
    repaint: repaintSoon,
  };
})();

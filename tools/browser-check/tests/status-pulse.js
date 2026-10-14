// Every live green status dot uses the one shared pulse (05-status-colors.css). Run:
// .\tools\browser-check\check.ps1 -Test status-pulse
(async () => {
  const { log, wait } = check;
  try {
    await wait(600);
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;left:20px;top:20px;z-index:99999;background:#fff;padding:12px';
    box.innerHTML = `<div class="tnai-card" data-tone="working"><span class="agent-status-pill working"><i></i>Working</span></div>
<div class="c-skill" data-state="in-use"><i></i></div><span class="repo-agent-tag"><i></i></span><div class="skill-row in-use"><span class="skill-dot"></span></div>
<div class="t-sub" data-status="running"><div class="t-row"><i></i></div></div><div data-tone="working"><span class="ap-dot"></span></div>
<div class="ap-sub" data-status="running"><span class="ap-dot"></span></div><div class="tnai-turn" data-state="running"><span class="t-dot"></span></div>
<div class="terminal-pane" data-status="working"><span class="terminal-pane-state"><i></i>Working</span></div><span class="bw-dot" data-s="working"></span>
<div class="tnai-graph-line" data-status="working"><span class="g-state"><i></i></span></div><div class="tnai-graph-item" data-status="working"><span class="g-dot"></span></div>`;
    document.body.append(box);
    await wait(100);
    const dots = box.querySelectorAll(
      '.agent-status-pill i,.c-skill i,.repo-agent-tag i,.skill-dot,.t-row>i,.ap-dot,.t-dot,.terminal-pane-state i,.bw-dot,.g-state i,.g-dot'
    );
    const seen = new Set();
    dots.forEach(d => {
      const s = getComputedStyle(d),
        a = getComputedStyle(d, '::after'),
        k = [
          s.animationName,
          s.boxShadow,
          a.animationName,
          a.animationDuration,
          a.backgroundColor,
        ].join(' | ');
      seen.add(k);
      log(d.parentElement.className || d.parentElement.dataset.tone, '=>', k);
    });
    log('distinct styles:', seen.size, 'dots:', dots.length);
  } catch (e) {
    log('ERROR', e.message);
  }
  check.done();
})();

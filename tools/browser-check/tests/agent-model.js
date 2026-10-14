// Which model an agent runs on, as one readable name (108 `window.TnaiAgentModel`): names from a
// CLI's list, dated and "[1m]" ids, a Claude id the list does not hold, the ran-vs-picked wording,
// and nothing at all when the model is not known. Run: .\tools\browser-check\check.ps1 -Test
// agent-model
(async () => {
  const { log, wait } = check;
  try {
    await wait(400);
    const M = window.TnaiAgentModel,
      list = [
        { id: 'claude-opus-5-5', label: 'Opus 5.5' },
        { id: 'claude-opus-5', label: 'Opus 5' },
        { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
        { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
      ];
    const eq = (what, got, want) =>
      log(
        (got === want ? 'ok   ' : 'FAIL ') +
          what +
          ': ' +
          JSON.stringify(got) +
          (got === want ? '' : ' (wanted ' + JSON.stringify(want) + ')')
      );
    eq('listed id', M.name('Claude Code', 'claude-opus-5-5', list), 'Opus 5.5');
    eq(
      'shorter id is not taken for a longer one',
      M.name('Claude Code', 'claude-opus-5', list),
      'Opus 5'
    );
    eq('1M variant', M.name('Claude Code', 'claude-opus-5-5[1m]', list), 'Opus 5.5');
    eq('undated id of a dated row', M.name('Claude Code', 'claude-haiku-4-5', list), 'Haiku 4.5');
    eq(
      'dated id of an undated row',
      M.name('Claude Code', 'claude-opus-5-5-20260301', list),
      'Opus 5.5'
    );
    eq('Claude id not in the list', M.name('Claude Code', 'claude-sonnet-6-1', list), 'Sonnet 6.1');
    eq(
      'dated Claude id not in the list',
      M.name('Claude Code', 'claude-opus-4-20250514', []),
      'Opus 4'
    );
    eq('other CLI, listed', M.name('Codex', 'gpt-5.2-codex', list), 'GPT-5.2 Codex');
    eq('other CLI, not listed: the id as it is', M.name('Codex', 'o9-mini', []), 'o9-mini');
    eq('no id', M.name('Claude Code', '', list), '');

    const turns = window.TnaiTurns,
      prefs = window.TnaiLaunchPrefs,
      s = { paneId: 'p1', agent: 'Claude Code' };
    let turn = null,
      pick = { model: '', effort: '' };
    window.TnaiTurns = { get: () => turn };
    window.TnaiLaunchPrefs = { pane: () => pick };
    eq('unknown: no text', M.text(s), '');
    eq('unknown: no tip', M.tip(s), '');
    eq('unknown: null', M.of(s), null);
    pick = { model: 'claude-sonnet-5-5', effort: 'high' };
    eq('picked', M.text(s), 'Sonnet 5.5 · high');
    eq('picked: not yet run', M.of(s).ran, false);
    eq(
      'picked tip',
      M.tip(s),
      'Model: Sonnet 5.5 (claude-sonnet-5-5) · effort high. Set for this agent; its next reply confirms it.'
    );
    turn = { model: 'claude-opus-5-5[1m]', effort: '' };
    eq('ran wins over the pick, effort from the pick', M.text(s), 'Opus 5.5 · high');
    eq('ran', M.of(s).ran, true);
    eq('shell panel', M.text({ paneId: 'p1', agent: 'Terminal' }), '');
    window.TnaiTurns = turns;
    window.TnaiLaunchPrefs = prefs;
  } catch (e) {
    log('ERROR', e.message);
  }
  check.done();
})();

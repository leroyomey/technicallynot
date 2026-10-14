/*
 * Technically Not tools · desktop-check/tests/limit-resume.js — Auto-continue after a usage limit
 * (72-limit-resume.js + 15 clearLimit + 22 pref): reset-time parsing for Claude Code / Codex /
 * Gemini CLI / OpenCode wording (none for Cursor Agent's date-only line); a PowerShell pane (never
 * an agent CLI, so no usage) prints a limit line → 15 detects it, 72 schedules the resume for a
 * minute after "resets <time>"; firing it clears the limit (card note gone) and types the continue
 * message; printing the line again re-detects it; the Settings switch is on by default and, off,
 * nothing is scheduled. Returns {ok, log}.
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
const G = window.TnaiAgents,
  N = window.tnaiNative,
  R = window.TnaiLimitResume,
  ACC = window.TnaiAccounts;
let shell;
try {
  check(!!R && !!ACC?.clearLimit, 'TnaiLimitResume and clearLimit loaded');
  const now = new Date(2026, 8, 25, 13, 0).getTime(),
    at = (h, m = 0, dd = 0) => new Date(2026, 8, 25 + dd, h, m).getTime();
  const cases = [
    ['5-hour limit reached ∙ resets 3pm', at(15)],
    ['Claude usage limit reached. Your limit will reset at 3:30pm (America/New_York).', at(15, 30)],
    ['Session limit reached ∙ resets 9am', at(9, 0, 1)],
    ['Weekly limit reached ∙ resets Oct 2, 9am', new Date(2026, 9, 2, 9).getTime()],
    [
      "You've hit your usage limit. Upgrade to Pro or try again in 2 hours 13 minutes.",
      now + (2 * 60 + 13) * 60000,
    ],
    ["You've hit your usage limit. Try again at 3:45 PM.", at(15, 45)],
    ['usage limit reached, resets 5', null],
    // Gemini CLI: "Access resets at <en-US h:mm AM/PM> <zone>" (Intl, narrow no-break space before
    // PM in newer ICU)
    ['│ Usage limit reached for gemini-2.5-pro. │ │ Access resets at 2:00 PM PDT. │', at(14)],
    // OpenCode Go: "It will reset in 5 hours 23 minutes."
    [
      '5 hour usage limit reached. It will reset in 5 hours 23 minutes. To continue using this model now',
      now + (5 * 60 + 23) * 60000,
    ],
    // Gemini CLI daily quota (API key) and Cursor Agent (a date, no time): no reset time → the
    // 30-minute retry
    ['API Error: You have exhausted your daily quota on this model.', null],
    [
      'Error: You’ve hit your usage limit You’ve saved $12 on API model usage this month with Pro. Your usage limits will reset when your monthly cycle ends on 8/14/2025.',
      null,
    ],
  ];
  for (const [text, want] of cases)
    check(
      R.resetAt(text, now) === want,
      'resetAt ' +
        JSON.stringify(text) +
        ' → ' +
        (want ? new Date(want).toString().slice(4, 21) : 'null')
    );
  check(
    window.TnaiSettings.get('autoResumeLimit') === true,
    'Settings: "Continue agents when usage resets" is on by default'
  );
  check(
    !!document.querySelector('input[data-pref="autoResumeLimit"]'),
    'Settings › Agents has the switch'
  );

  shell = await window.TnaiTest.open('Terminal');
  check(shell?.ok, 'PowerShell pane opened');
  await wait(1500);
  const buffer = async () =>
    ((await N.pty.replay(shell.paneId))?.buffer || '')
      .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
      .replace(/\r?\n/g, '');

  // Built from parts so the typed command itself never contains the phrase unquoted; only the
  // output line does. the panel shell: PowerShell on Windows, bash elsewhere
  const windows = /Windows/.test(navigator.userAgent);
  const limitLine = () =>
    windows ? "Write-Output ($a + $b + ' ∙ resets 11:58pm')" : 'echo "$a$b ∙ resets 11:58pm"';
  G.send(
    shell.paneId,
    windows
      ? "$a='5-hour limit'; $b=' reached'; Write-Output ($a + $b + ' ∙ resets 11:58pm')"
      : "a='5-hour limit'; b=' reached'; " + limitLine()
  );
  check(!!(await until(() => ACC.limitFor(shell.paneId), 6000)), 'limit line detected (15)');
  const plan = await until(() => R.pending().find(p => p.paneId === shell.paneId), 6000);
  const want = new Date();
  want.setHours(23, 58, 0, 0);
  if (want.getTime() <= Date.now()) want.setDate(want.getDate() + 1);
  check(
    !!plan && Math.abs(plan.due - (want.getTime() + 60000)) < 2000,
    'resume scheduled a minute after 11:58pm: ' +
      (plan ? new Date(plan.due).toString().slice(4, 24) : 'none')
  );

  R.fire(shell.paneId);
  check(!ACC.limitFor(shell.paneId), 'firing clears the limit (card note goes)');

  // bash reads the resume's Esc (sent 400 ms earlier to close an agent CLI's limit menu) with the
  // next key as Meta-Y, so the message's first letter is eaten there.
  check(
    !!(await until(
      async () =>
        (await buffer()).includes(
          windows
            ? 'Your usage limit has reset. Continue the task'
            : 'our usage limit has reset. Continue the task'
        ),
      5000
    )),
    'continue message typed into the pane'
  );

  N.pty.write(shell.paneId, '');

  // PowerShell reads the message's "do" as a do-loop and waits for more; an agent CLI takes it as a
  // prompt
  await wait(600);
  G.send(shell.paneId, limitLine());
  check(
    !!(await until(() => ACC.limitFor(shell.paneId), 6000)),
    'still limited: the next limit line is detected again'
  );
  const again = await until(
    () => R.pending().find(p => p.paneId === shell.paneId && p.tries === 1 && p.scheduled),
    6000
  );
  check(!!again, 'rescheduled, keeping the try count');

  window.TnaiSettings.set('autoResumeLimit', false);
  ACC.clearLimit(shell.paneId);
  R.cancel(shell.paneId);
  G.send(shell.paneId, limitLine());
  await until(() => ACC.limitFor(shell.paneId), 6000);
  await wait(3200);
  check(!R.pending().some(p => p.paneId === shell.paneId), 'switch off: nothing scheduled');
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
window.TnaiSettings?.set('autoResumeLimit', true);
if (shell?.paneId) {
  R?.cancel(shell.paneId);
  G.stop(shell.paneId);
}
await wait(300);
return { ok, log };

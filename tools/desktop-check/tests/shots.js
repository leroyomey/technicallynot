// Technically Not tools · desktop-check/tests/shots.js — Screenshots of the pages a user has in
// the desktop app, with a live shell thread (no assertions): Threads empty, Threads with the
// thread on its CLI screen, the side column's Files tab, All threads, Skills and Settings.
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(700);
};
await window.TnaiAgents.detect(true);
await shot('threads-empty');

// one PowerShell thread, opened: a thread without a conversation shows its CLI screen
const { paneId } = await window.TnaiTest.startThread({ tool: 'Terminal', show: true });
await wait(2500);
await shot('threads-live');
window.TnaiThreadSide?.open('files');
await wait(600);
await shot('threads-files');
window.TnaiThreadSide?.close();

// the route 'terminal' is the All threads page
window.TnaiRoute('terminal');
await wait(900);
await shot('all-threads');
window.TnaiRoute('skills');
await wait(700);
await shot('skills');
window.TnaiSettings.open('general');
await wait(700);
await shot('settings');
window.TnaiThreads.open();
await window.TnaiAgents.stop(paneId);
await wait(800);
return { ok: true, log: ['shots saved'] };

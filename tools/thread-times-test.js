// Technically Not tools · thread-times-test.js — the times in threads
// (src/scripts/172-thread-times.js): the short form, the day line's words, lengths, a helper's
// line, and that a day line comes once a day and a reply in the same minute gets no second time.
// Runs the real file with a small stand-in for the page. Run: node tools/thread-times-test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function check(ok, name) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}

// A stand-in element: enough of the DOM for what 172 makes.
function element(tag) {
  return {
    tag,
    className: '',
    title: '',
    textContent: '',
    dateTime: '',
    children: [],
    isConnected: true,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    after(node) {
      this.next = node;
    },
    querySelector(selector) {
      return this.children.find(child => child.tag === selector) || null;
    },
  };
}

const context = { window: {}, document: { createElement: element }, Date, Number, String, Math };
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '../src/scripts/172-thread-times.js'), 'utf8'),
  context
);
const times = context.window.TnaiTimes;

const now = new Date(2026, 9, 22, 14, 30).getTime();
const morning = new Date(2026, 9, 22, 9, 41).getTime();
const lastNight = new Date(2026, 9, 21, 23, 58).getTime();
const sunday = new Date(2026, 9, 19, 16, 40).getTime();
const lastYear = new Date(2025, 11, 30, 8, 0).getTime();

// 1. the short form
check(times.short(morning, now) === times.clock(morning), 'today is a clock');
check(/9:41/.test(times.clock(morning)), 'the clock says 9:41');
check(times.short(lastNight, now) === 'Yesterday', 'the day before is "Yesterday"');
check(
  /Oct/.test(times.short(sunday, now)) && /19/.test(times.short(sunday, now)),
  'this year: a date'
);
check(!/2026/.test(times.short(sunday, now)), 'this year: no year');
check(/2025/.test(times.short(lastYear, now)), 'an earlier year: with its year');
check(times.short(0, now) === '' && times.short(NaN, now) === '', 'no time: nothing');

// 2. the day line's words, lengths and a helper's line
check(/^Today · /.test(times.dayWords(morning, now)), 'a day line says Today');
check(/^Yesterday · /.test(times.dayWords(lastNight, now)), 'a day line says Yesterday');
check(
  !/^(Today|Yesterday)/.test(times.dayWords(sunday, now)),
  'an older day line has its date only'
);
check(times.span(0, 45000) === '' && times.span(1000, 46000) === '45s', 'seconds');
check(times.span(1000, 1000 + 192000) === '3m 12s', 'minutes and seconds');
check(times.span(1000, 1000 + 3840000) === '1h 04m', 'hours and minutes');
check(times.span(5000, 1000) === '', 'an end before its start says nothing');
check(/^since /.test(times.helperWords(morning, 0)), 'a running helper: since when');
check(
  / → .* · 3m 12s$/.test(times.helperWords(morning, morning + 192000)),
  'a done helper: start → end · how long'
);
check(times.helperWords(0, morning) === '', 'a helper with no start time: nothing');

// 3. in the conversation: one day line a day, one time a minute for replies, prompts always
const state = {};
const added = [];
const add = node => added.push(node);
times.day(state, morning, add);
times.day(state, morning + 60000, add);
check(added.length === 1 && added[0].className === 'tnt-day', 'one day line for one day');
times.day(state, lastNight, add);
check(added.length === 2, 'another day: another day line');

const reply = element('div');
times.stamp(state, morning, false, reply);
check(reply.next?.className === 'tnt-at', 'a reply gets its time');
check(/2026/.test(reply.next.children[0]?.title), 'its hover has the full date');
const sameMinute = element('div');
times.stamp(state, morning + 5000, false, sameMinute);
check(!sameMinute.next, 'a reply in the same minute gets no second time');
const prompt = element('div');
times.stamp(state, morning + 5000, true, prompt);
check(
  prompt.next?.className === 'tnt-at tnt-at-you',
  'a prompt always gets its time, at the right'
);
const none = element('div');
times.stamp(state, 0, false, none);
check(!none.next, 'no time in the record (Cursor Agent): none is shown');

const card = element('section');
card.append(element('h3'));
times.onReport(card, morning);
check(card.children[0].children[0]?.className === 'tnt-report-at', 'a report has its time');

// 4. the hooks are there
const readable = fs.readFileSync(
  path.join(__dirname, '../src/scripts/122-thread-readable.js'),
  'utf8'
);
check((readable.match(/TnaiTimes\?\.stamp/g) || []).length === 2, '122 stamps prompts and replies');
check(/TnaiTimes\?\.onReport/.test(readable), '122 times the report');
check(
  (readable.match(/TnaiTimes\?\.helperWords/g) || []).length === 2,
  "122 times a helper's card"
);
check(/timesDay = 0/.test(readable), 'a fresh read starts the day lines again');
const list = fs.readFileSync(path.join(__dirname, '../src/scripts/119-thread-list.js'), 'utf8');
check(/TnaiTimes\?\.short/.test(list), 'the thread list uses the short form');
const index = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
check(
  /172-thread-times\.js/.test(index) && /53-thread-times\.css/.test(index),
  'index.html loads both'
);

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

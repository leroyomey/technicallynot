// Technically Not tools · thread-charts-test.js — charts in threads
// (src/scripts/178-thread-charts.js): reading a chart block and a table of numbers out of a reply,
// refusing what is not a chart, and that a reply without one is left to 122 exactly as before. The
// reading runs for real; the drawing is checked in the source. Run: node
// tools/thread-charts-test.js
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

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const context = { window: {}, document: {} };
vm.runInNewContext(source('src/scripts/178-thread-charts.js'), context);
const charts = context.window.TnaiThreadCharts;

// 1. numbers
check(charts.number('84') === 84 && charts.number('1,234.5') === 1234.5, 'plain and thousands');
check(
  charts.number('212 ms') === 212 && charts.number('$12') === 12 && charts.number('48.5%') === 48.5,
  'units around a number'
);
check(
  Number.isNaN(charts.number('fast')) && Number.isNaN(charts.number('')),
  'words are not numbers'
);

// 2. a chart block
const reply = [
  'I measured each page.',
  '```chart',
  'title: Page switch time',
  'unit: ms',
  'Threads: 84',
  'Settings: 212',
  '```',
  'Settings is the slowest.',
].join('\n');
const parts = charts.split(reply);
check(parts.map(p => p.kind).join(',') === 'text,chart,text', 'text, chart, text in order');
const chart = parts[1].chart;
check(chart.title === 'Page switch time' && chart.unit === 'ms', 'title and unit');
check(JSON.stringify(chart.rows) === '[["Threads",84],["Settings",212]]', 'one row per item');

const two = charts.parseChart([
  'title: Before and after',
  'series: 0.3.74, 0.3.75',
  'Threads: 118, 84',
  'Settings: 340, 212',
]);
check(
  two.series.length === 2 && JSON.stringify(two.rows[1]) === '["Settings",340,212]',
  'two series side by side'
);
check(
  charts.parseChart(['series: a, b', 'X: 1', 'Y: 2, 3']) === null,
  'rows of different widths are refused'
);
check(charts.parseChart(['title: Nothing']) === null, 'no rows: no chart');
check(
  charts.parseChart(['A: soon', 'B: 3']).rows.length === 1,
  'a row without a number is left out'
);
check(
  charts.parseChart(Array.from({ length: 50 }, (_, i) => 'Item ' + i + ': ' + i)).rows.length ===
    30,
  'at most 30 rows'
);

// a code block that is not a chart stays text
check(
  charts.split('```js\nconst a = 1;\n```').every(p => p.kind === 'text'),
  'other code blocks stay text'
);
check(
  charts.split('```chart\nno colon here\n```').every(p => p.kind === 'text'),
  'an empty chart block stays text'
);

// 3. a table of numbers
const table = [
  '| Agent | Files | Note |',
  '|---|---:|---|',
  '| Lead | 41 | busy |',
  '| Nyx | 3 | quiet |',
].join('\n');
const tableParts = charts.split('Today:\n' + table);
check(tableParts[1]?.kind === 'table', 'a table with a numbers column is found');
check(JSON.stringify(tableParts[1].table.numeric) === '[1]', 'its numbers column is known');
check(
  charts.split('| A | B |\n|---|---|\n| x | y |').every(p => p.kind === 'text'),
  'a table of words stays text'
);

// 3b. a list of values becomes a chart (data-charts.html mock)
const list = [
  'The five biggest folders:',
  '- node_modules: 412 MB',
  '- **dist**: 238 MB',
  '- docs — 64 MB (mostly pictures)',
  '- src: 11 MB',
].join('\n');
const listParts = charts.split(list);
check(listParts.map(p => p.kind).join(',') === 'text,chart', 'a list of values is a chart');
const listChart = listParts[1].chart;
check(
  listChart.title === 'The five biggest folders' && listChart.unit === 'MB',
  'its title and unit'
);
check(JSON.stringify(listChart.rows[1]) === '["dist",238]', 'bold marks are taken off');
check(
  listChart.table.rows[2][1] === '64 MB (mostly pictures)',
  'the table keeps the words as written'
);
check(
  charts.split('- a: 1 MB\n- b: 2 MB').every(p => p.kind === 'text'),
  'two items stay a list'
);
check(
  charts.split('- a: 1 MB\n- b: 2 ms\n- c: 3 MB').every(p => p.kind === 'text'),
  'mixed units stay a list'
);
check(
  charts
    .split('- Passed: 31 of 40\n- Failed: 9 of 40\n- Skipped: 0 of 40')
    .every(p => p.kind === 'text'),
  'items with more words than a value stay a list'
);
check(
  charts.split('- cost: $12\n- tax: $3\n- tip: $2').some(p => p.chart?.unit === '$'),
  'a currency is the unit'
);

// 3c. a series in order is a line
check(
  charts.kindOf([
    ['0.3.71', 1],
    ['0.3.72', 2],
    ['0.3.73', 3],
    ['0.3.74', 4],
  ]) === 'line',
  'versions draw a line'
);
check(
  charts.kindOf([
    ['Jan', 1],
    ['Feb', 2],
    ['Mar', 3],
    ['Apr', 4],
  ]) === 'line',
  'months draw a line'
);
check(
  charts.kindOf([
    ['2026-10-01', 1],
    ['2026-10-02', 2],
    ['2026-10-03', 3],
    ['2026-10-04', 4],
  ]) === 'line',
  'dates draw a line'
);
check(
  charts.kindOf([
    ['0.3.72', 2],
    ['0.3.73', 3],
    ['0.3.74', 4],
  ]) === 'bars',
  'three points stay bars'
);
check(
  charts.kindOf([
    ['Lead', 1],
    ['Nyx', 2],
    ['Jade', 3],
    ['Fern', 4],
  ]) === 'bars',
  'names stay bars'
);
check(charts.kindOf([['Lead', 1]], 'line') === 'line', 'type: line is kept');
check(
  charts.parseChart(['type: bar', '2021: 1', '2022: 2', '2023: 3', '2024: 4']).kind === 'bars',
  'type: bar wins'
);
check(
  charts.niceTop(188) === 200 && charts.niceTop(412) === 500 && charts.niceTop(0.7) === 1,
  'scale tops are round'
);

// 3d. code blocks stay as written
check(
  charts.split('```\n- a: 1 MB\n- b: 2 MB\n- c: 3 MB\n```').every(p => p.kind === 'text'),
  'a list in a code block stays text'
);
check(
  charts.split('```md\n| A | N |\n|---|---|\n| x | 1 |\n```').every(p => p.kind === 'text'),
  'a table in a code block stays text'
);

// 3e. a table of numbers keeps every column for its Table view and opens on Chart
const fromTable = charts.chartOfTable(tableParts[1].table);
check(
  fromTable.unit === 'Files' && fromTable.table.head.length === 3,
  'its table keeps every column'
);
check(
  /card\(chartOfTable\(part\.table, part\.title\), 'chart'\)/.test(
    source('src/scripts/178-thread-charts.js')
  ),
  'a table opens on Chart'
);
check(
  charts.split('Page switch time:\n' + table)[1]?.title === 'Page switch time',
  'the line before a table names its chart'
);

// 4. the hook, the rule and the page
const readable = source('src/scripts/122-thread-readable.js');
check(
  /function drawWords/.test(readable) && /TnaiThreadCharts\?\.fill/.test(readable),
  '122 asks 178 first'
);
check(
  (readable.match(/drawWords\(/g) || []).length >= 3,
  'both ways a reply is drawn go through it'
);
const code = source('src/scripts/178-thread-charts.js');
check(
  !/innerHTML\s*=\s*(?!markdown)/.test(
    code.replace(/holder\.innerHTML = markdown\(part\.text\)/, '')
  ),
  'labels and titles never go in as HTML'
);
const rule = source('desktop/hidden-skills/46-charts.md');
check(
  /for: every-agent/.test(rule) && /```chart/.test(rule),
  'every agent CLI is told how to write one'
);
check(
  /178-thread-charts\.js/.test(source('index.html')) &&
    /56-thread-charts\.css/.test(source('index.html')),
  'index.html loads both'
);

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

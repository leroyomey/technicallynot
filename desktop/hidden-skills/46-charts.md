---
name: charts
description: Draw numbers a reply compares as a chart card in the user's thread, by writing a plain-text chart block (src/scripts/178-thread-charts.js draws it). Every agent CLI can, since it is text in the reply.
for: every-agent
tnai-hidden: true
---
- Charts in replies: when a reply compares numbers the user cares about (speeds, sizes, counts, scores, prices, before and after, change over time), put them in a chart block as well as the sentence that says what they mean. Technically Not draws the block as a chart card in the thread, with a Table view and a button that opens it beside the thread; elsewhere it reads as plain text. Not for a single number, and not for numbers nobody compares.
- When the user's prompt compares, ranks, asks "how much / how many / which is faster" or asks how something changed, answer with a chart block whenever the answer has such numbers.
- Write it as a fenced block named chart: the line ```chart, then `title: …` (a few words), `unit: …` (ms, MB, %, $, files…), optional `series: A, B` for two measures side by side (at most two; before and after is the usual pair), optional `type: line` or `type: bar`, then one line per item `Name: 84` (with series: `Name: 118, 84`), then ``` to close. Items in order (versions, dates, months, builds) draw as a line by themselves. At most 30 items; numbers only after the colon; measured values, never guessed ones (say "estimate" in the title when they are).
- A Markdown table whose columns hold numbers, and a list of three or more `- Name: 84 MB` lines in one unit, become the same chart by themselves, so a table or such a list is enough when the reader needs the words too.

/*
 * Technically Not desktop · agent-errors.js — The one shape of every failure an agent gets back
 * from Technically Not: the `tnai` command (agent-mesh.js, agent-context.js, agent-tasks.js,
 * dev-servers.js, file-locks.js) and the tnai_* tools (agent-graph.js through agent-hooks.js).
 *
 * A failure keeps its readable sentence first, unchanged, and carries a short code from the fixed
 * list below and, where a fix exists, a hint: the exact command or step that fixes it. Printed for
 * the agent as one extra line in a fixed shape:
 *
 *   code: not_found · try: tnai agents
 *
 * so an agent of any CLI can recover on its own (it runs the "try" command first) instead of
 * guessing. agent-shim.js prints that line itself: it is copied out and runs alone, so it cannot
 * load this file, and keeps the same shape by hand.
 */
'use strict';

// The fixed list. Keep it short: an agent should know them all by heart.
//   not_found    the agent, sub-agent, note, task, result, skill or file named does not exist here
//   invalid      the command was used the wrong way: a missing or wrong word, too long, empty
//   busy         the target is working or was just used; wait, or take another way
//   locked       another agent holds the file
//   full         a limit is reached (notes, tasks, sub-agents, agents started with tnai new)
//   refused      not allowed here (a rule, the user's setting, the wrong kind of session)
//   unreachable  Technically Not's window, a dev server or the app itself did not answer
//   internal     something broke inside Technically Not; tell the user if it keeps happening
const CODES = [
  'not_found',
  'invalid',
  'busy',
  'locked',
  'full',
  'refused',
  'unreachable',
  'internal',
];

// The extra line, in its fixed shape: "code: CODE" and, when a fix exists, " · try: HINT".
function line(code, hint) {
  return 'code: ' + code + (hint ? ' · try: ' + hint : '');
}

// A failed `tnai` reply: { ok: false, error, code, hint? }. An unknown code becomes internal, so a
// typo here can never send an agent a code it was not told about.
function fail(code, message, hint) {
  const known = CODES.includes(code) ? code : 'internal';
  const reply = { ok: false, error: String(message || ''), code: known };
  if (hint) reply.hint = String(hint);
  return reply;
}

// A failure handed on from another check keeps its own code and hint; a plain one (only error)
// gets the code and hint given here.
function pass(failed, code, hint) {
  return fail(failed?.code || code, failed?.error || '', failed?.code ? failed.hint : hint);
}

// The last guard before a reply leaves Technically Not (agent-mesh.js onSocket): a failure that no
// site tagged still carries a code, so every failure an agent sees has one.
function ensure(reply, code = 'refused') {
  if (!reply || reply.ok !== false || CODES.includes(reply.code)) return reply;
  return { ...reply, code };
}

// A failed tnai_* tool result (MCP): the sentence, then the code line, in the text the agent reads;
// code and hint also as fields of the result (MCP allows extra fields; clients ignore them).
function toolFail(message, code, hint) {
  const known = CODES.includes(code) ? code : 'internal';
  const result = {
    content: [{ type: 'text', text: String(message || '') + '\n' + line(known, hint) }],
    isError: true,
    code: known,
  };
  if (hint) result.hint = String(hint);
  return result;
}

// The sentence of a tool failure without its code line (agent-mesh.js `tnai delegate | wait |
// subagents | assign`, which prints the line itself from code and hint).
function withoutLine(text) {
  return String(text || '').replace(/\ncode: [a-z_]+( · try: [^\n]*)?$/, '');
}

module.exports = { CODES, line, fail, pass, ensure, toolFail, withoutLine };

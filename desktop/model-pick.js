/*
 * Technically Not · model-pick.js — the model and effort an agent started by a prompt runs on
 * (`tnai new --model --effort`, agent-mesh.js; tnai_delegate model/effort, agent-graph.js). Matches
 * what an agent wrote ("Opus 5.5", "sonnet", "claude-opus-5-5", "gpt-5.5", "extra high") against
 * that CLI's own model list (agent-registry.js models(), the same list as the composer's dropdowns,
 * 46), so only real ids reach the command line. Anything it cannot match is refused with the names
 * that work, never quietly started on the CLI's default.
 */
const registry = require('./agent-registry');

const EFFORT_WORDS = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  med: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  'x-high': 'xhigh',
  'extra-high': 'xhigh',
  max: 'max',
  maximum: 'max',
  ultra: 'ultra',
};
const norm = s =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/^claude-(?=opus|sonnet|haiku|fable|mythos)/, '');
const names = list =>
  list
    .slice(0, 12)
    .map(m => (m.label && m.label !== m.id ? m.label + ' (' + m.id + ')' : m.id))
    .join(', ') + (list.length > 12 ? ', …' : '');

// { model, effort } (ids the CLI takes; '' = its default) or { error }.
async function resolve(agent, model, effort) {
  model = String(model || '').trim();
  effort = String(effort || '').trim();
  if (!model && !effort) return { model: '', effort: '' };
  const cat = (await registry.models(agent).catch(() => null)) || { models: [], efforts: [] };
  const list = cat.models || [];
  let hit = null;
  if (model) {
    if (!list.length)
      return {
        error:
          'Could not read ' +
          agent +
          '’s model list (is it installed and signed in?), so it cannot be started on "' +
          model +
          '".',
      };
    const want = norm(model);
    hit =
      list.find(m => m.id.toLowerCase() === model.toLowerCase()) ||
      list.find(
        m => norm(m.id) === want || norm(m.label) === want || norm(m.id.split('/').pop()) === want
      );
    if (!hit) {
      // A family name ("opus", "sonnet"): Claude Code's list is newest first, so its first match is
      // the current one; elsewhere only when it is unambiguous. OpenCode's `group` is the provider,
      // so its family is the model's own `family` ("claude-sonnet", "gpt"), and of several matches
      // the newest by release date that is not deprecated is taken (models of exactly that family
      // first, so "gpt" is not "gpt-pro").
      const oc = agent === 'OpenCode';
      const family = list.filter(
        m =>
          norm(oc ? m.family : m.group) === want ||
          norm(m.label).startsWith(want + '-') ||
          norm(m.id.split('/').pop()).startsWith(want + '-')
      );
      if (family.length === 1 || (family.length && agent === 'Claude Code')) hit = family[0];
      else if (family.length) {
        const exact = family.filter(m => norm(m.family) === want),
          dated = (exact.length ? exact : family).filter(m => !m.deprecated && m.released);
        if (oc && dated.length)
          hit = dated.reduce((best, m) => (m.released > best.released ? m : best));
        else
          return {
            error:
              '"' +
              model +
              '" matches several ' +
              agent +
              ' models: ' +
              names(family) +
              '. Name one.',
          };
      }
    }
    if (!hit)
      return { error: agent + ' has no model "' + model + '". Its models: ' + names(list) + '.' };
  }
  let pickedEffort = '';
  if (effort) {
    const efforts = hit?.efforts?.length ? hit.efforts : cat.efforts || [];
    if (!efforts.length)
      return {
        error:
          agent +
          ' has no separate effort setting' +
          (agent === 'Cursor Agent'
            ? ' (the effort is part of its model names; pick one of those instead)'
            : agent !== 'OpenCode' || cat.effortWhy === 'off'
              ? // OpenCode with its effort switch off (agent-registry.js OPENCODE_EFFORT_ON): the

                // plain sentence
                ''
              : cat.effortWhy === 'nolink'
                ? ' here: Technically Not’s link to OpenCode is off, so its effort cannot be set (it is set on its CLI screen)'
                : hit
                  ? ': ' + (hit.label || hit.id) + ' has no effort levels'
                  : ': its effort levels belong to a model, so name a model that has them with --model') +
          '.',
      };
    const word = EFFORT_WORDS[norm(effort)] || norm(effort);
    if (!efforts.includes(word))
      return {
        error:
          (hit ? hit.label || hit.id : agent) +
          ' has no effort "' +
          effort +
          '". Its efforts: ' +
          efforts.join(', ') +
          '.',
      };
    pickedEffort = word;
  }
  return {
    model: hit?.id || '',
    effort: pickedEffort,
    label: [hit ? hit.label || hit.id : '', pickedEffort && pickedEffort + ' effort']
      .filter(Boolean)
      .join(', '),
  };
}

module.exports = { resolve };

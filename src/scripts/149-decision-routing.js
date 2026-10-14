/* Technically Not · 149-decision-routing.js — Where a decision pressed in a thread goes, so the
   user never has to write the follow-up prompt themselves (pressing an option that names another
   agent used to only pre-write the prompt box). An option that hands the work to another
   agent by name is sent to that agent, with the result it came from, and the asking agent is told
   it was handed over. Any other option is sent to the asking agent. A working agent gets it when
   its task ends (the app holds it, and its thread shows it as waiting). The prompt box is used
   only when nobody can take it: the agent is not running, or the option asks for the user's own
   words. Called from 49 `decideInThread`; sends through 10 `TnaiAgents.send`. */
(() => {
  // Options that ask for the user's own words go to the prompt box, where the user writes them.
  const OWN_WORDS = /\b(tell me|something else|my own words|i'?ll (say|write|type))\b/i;

  // A button reads "… (recommended)"; the agents get the option without that mark.
  const withoutMark = label => String(label || '').replace(/\s*\(recommended\)\s*$/i, '');

  const escapeForPattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const sessionOf = paneId =>
    (window.TnaiAgents?.sessions?.() || []).find(one => one.paneId === paneId) || null;

  // True when the option's words hand the work to this agent: "hand them to Launch Lead",
  // "send it to Kite", "ask Sol", "Launch Lead takes it". A name alone is not enough: "wait for
  // Launch Lead" names an agent without handing it anything.
  function handsTo(label, name) {
    const who = escapeForPattern(name);
    const patterns = [
      new RegExp(
        '\\b(hand|hands|handing|give|gives|pass|passes|send|sends|forward|forwards|delegate|' +
          'delegates|assign|assigns|leave|leaves|route|routes|move|moves|over)\\b[^.;]{0,60}' +
          '\\bto\\s+(the\\s+)?' +
          who +
          '\\b',
        'i'
      ),
      new RegExp('\\b(ask|let|have)\\s+' + who + '\\b', 'i'),
      new RegExp('\\b' + who + '\\s+(does|do|takes|take|handles|handle|owns|picks)\\b', 'i'),
    ];
    return patterns.some(pattern => pattern.test(label));
  }

  // The other agent an option hands the work to, or null. A longer name wins, so "Launch Lead"
  // is found before a shorter name it contains.
  function targetOf(label, askerPaneId) {
    const others = (window.TnaiAgents?.sessions?.() || [])
      .filter(one => one.paneId !== askerPaneId && one.agent !== 'Terminal')
      .filter(one => /[a-z]{2,}/i.test(one.name || '') && one.name !== one.paneId)
      .sort((a, b) => b.name.length - a.name.length);
    return others.find(one => handsTo(label, one.name)) || null;
  }

  function say(message) {
    try {
      window.toast?.(message);
    } catch {}
  }

  // Sends one message to an agent, held while it works. → true when the app took it.
  function deliver(session, text, shown) {
    const sent = window.TnaiAgents.send(session.paneId, text, {
      userText: shown,
      holdIfBusy: true,
    });
    if (sent) {
      window.TnaiLiveTasks?.record?.(
        session.paneId,
        shown,
        session.name + ' (' + session.agent + ')'
      );
    }
    return sent;
  }

  // An option that hands the work to another agent: sent to that agent, and the asking agent is
  // told, so it does not forward it a second time. → true when it was sent.
  function handOff(askerPaneId, question, pressed, resultId) {
    const label = withoutMark(pressed);
    const target = targetOf(label, askerPaneId);
    if (!target) {
      return false;
    }
    if (!target.running) {
      say(target.name + ' is not running. The answer is in the prompt box.');
      return false;
    }
    const asker = sessionOf(askerPaneId);
    const askerName = asker?.name || 'another agent';
    const fullResult = resultId ? ' The full result: `tnai context show ' + resultId + '`.' : '';
    const forTarget =
      'The user answered a decision from ' +
      askerName +
      ' that hands this work to you. ' +
      askerName +
      ' asked: "' +
      question +
      '" The user chose: "' +
      label +
      '". Do the work that answer describes, as laid out in ' +
      askerName +
      '’s report.' +
      fullResult;
    if (!deliver(target, forTarget, 'Handed over from ' + askerName + ': ' + label)) {
      say(target.name + ' stopped before the answer could be sent.');
      return false;
    }

    // The asking agent learns the answer too, and that it is already handed over.
    if (asker?.running) {
      const forAsker =
        'Decision on "' +
        question +
        '": go with ' +
        label +
        '. Technically Not already sent it to ' +
        target.name +
        ', so do not forward it yourself.';
      deliver(asker, forAsker, 'Decision: ' + label + ' (sent to ' + target.name + ')');
    }
    say('Sent to ' + target.name + ': ' + label);
    return true;
  }

  // True when a plain option can go straight to the asking agent: it is running and the option
  // does not ask for the user's own words. An option that hands the work to another agent is
  // never one: when that agent is not running, its answer waits in the prompt box.
  function sendsItself(askerPaneId, label) {
    if (OWN_WORDS.test(label) || targetOf(withoutMark(label), askerPaneId)) {
      return false;
    }
    return !!sessionOf(askerPaneId)?.running;
  }

  // A plain option for a decision with no saved result: sent to the asking agent as the same
  // words a result card sends. → true when it was sent.
  function sendPlain(askerPaneId, question, pressed) {
    const label = withoutMark(pressed);
    const asker = sessionOf(askerPaneId);
    if (!asker?.running) {
      return false;
    }
    const text = 'Decision on "' + question + '": go with ' + label + '.';
    if (!deliver(asker, text, 'Decision: ' + label)) {
      return false;
    }
    say('Sent to ' + asker.name + ': ' + label);
    return true;
  }

  window.TnaiDecisionRouting = { handOff, sendsItself, sendPlain, targetOf };
})();

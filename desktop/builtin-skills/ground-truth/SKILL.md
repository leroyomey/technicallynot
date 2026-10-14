---
name: ground-truth
description: >-
  Verify the actual artifact, content, or live external state directly instead
  of trusting a tool's self-reported success, a status flag, or memory of
  state observed earlier in the session. Use before claiming a build shipped,
  a UI action took effect, or an external device/service is ready.
---

# Ground truth

**TL;DR:** A tool telling you it succeeded is not evidence. Check the actual
thing: the shipped file's hash/timestamp, the real content behind a status
flag, the live state of an external device or service — checked at the
moment you're about to act on it, not recalled from earlier in the session.

## Why this keeps happening

Four independent, verified incidents, four different domains, same root
cause: something reported success — or looked like a match — while the real
state disagreed.

- **Build scripts lie about what they shipped.** A packaging step (e.g.
  `npm run build:exe` over PyInstaller) printed "Build complete!" while the
  actual double-clickable binary on disk was untouched — the build wrote to
  a staging path and a separate copy step was needed to install it, and that
  copy step silently didn't run. Caught only by comparing the shipped file's
  hash and timestamp before and after, not by reading the build log.
- **A widget's own status flag can be wrong.** A Notepad tab reported itself
  "Unmodified" while its buffer held 5 characters in place of a real
  26,000-character document — trusting the flag would have let a save
  silently discard the real content. Only reading the actual buffer/file
  content caught it.
- **Cached knowledge of an external device's state goes stale.** Assuming a
  phone/emulator is still attached and authorized because it was earlier in
  the session, instead of re-checking at the moment of the action that needs
  it, risks building or shipping blind.
- **A CLI's text output can echo your own query back at you.** Probing
  `git agent --help` to test whether an `agent` subcommand exists returned
  exit code 1 and the text `"'agent' is not a git command"` — which contains
  the word "agent" and would pass a naive text-match test while actually
  reporting the opposite. The exit code was the honest signal; the text
  wasn't. When probing a CLI for a capability, trust the exit code over the
  text.

## The rule

Before claiming something worked:
1. Identify the actual artifact or state that matters (the shipped binary,
   the real buffer/file, the live device/service) — not the tool's report
   about it.
2. Check that directly: hash/timestamp, the real content, a fresh state
   query. Never assume it's unchanged since you last checked.
3. Only then say "verified" — and say what you checked, not just that you
   checked something.

Compiling, a green log line, or "done" in a status field are not verification
by themselves. Say which you actually have: compiles / asserted in-process /
verified against the real artifact or live state.

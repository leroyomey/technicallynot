---
name: safe-file-split
description: >-
  Splits an oversized file or module into labeled files without changing
  behavior, proving losslessness mechanically instead of trusting a careful
  read. Use when a file has grown large enough that finding something in it
  costs a real search, before splitting any file/module, or when a previous
  split needs to be trusted.
---

# Safe file split

**TL;DR:** Split along existing seams, never mid-function or mid-shared-state.
Cut mechanically (`sed`/scripted extraction, never hand-retyping), then prove
losslessness with a byte-for-byte diff of the reconstructed concatenation
against the original — before it ships. Preserve every external call site
unchanged. Verify the split behaviorally against real usage, not just that it
imports/parses.

## When to split

A file has grown into a dumping ground when finding something in it costs a
real search. Split into coordinated, clearly-labeled files rather than
appending to whichever file already happens to own that concern. A numeric
prefix when load order matters, otherwise a name that says what's actually
inside — the goal is that the right file is guessable without a grep.

## The procedure

1. **Find the real seams first, not assumed ones.** For markup/script files
   sharing one execution scope (classic `<script src>` tags, for example),
   splitting on script-tag boundaries preserves behavior automatically — verify
   there are exactly as many boundaries as you think; one hidden
   `</script><script>` pair sitting back-to-back with no HTML between them is
   invisible by eye and lands as literal text inside a neighboring file.
2. **For a module with shared mutable state, find where that state is actually
   touched before cutting.** State coupling is not always a clean block at the
   top of the file — it can be scattered across the entire file, read and
   written by functions far apart. A plain line-range cut when that's true
   silently splits shared state across files: one function's write in file A
   is never seen by another function's read of the same name in file B.
   Extract the shared state into its own small file first (module-attribute
   access to it, e.g. `_state.name`, never `from _state import name` — a
   name that gets reassigned wholesale rather than mutated in place will go
   stale the moment an importer holds a bare reference to the old object).
3. **Preserve every external call site.** If other files reach into this
   module by name, the split must keep every one of those call sites working
   unchanged — e.g. a package `__init__.py` that re-exports every name from
   the internal implementation file, rather than renaming things and forcing
   callers to update. Renaming during a split turns a mechanical, low-risk
   change into a much larger and riskier one, and defeats the point (fewer
   places to search, not more, and no reason to touch unrelated files).
4. **Cut mechanically, never by hand-retyping.** Hand-retyping a large block
   is how subtle corruption enters a "pure" split.
5. **Prove it's lossless before it ships.** Diff the reconstructed
   concatenation of the new files against the original file, byte for byte.
   Then syntax-check every new file **individually**, not just the reassembled
   whole — a stray tag, unmatched bracket, or boundary error can hide inside
   one piece and still let the rest look fine.
6. **Verify behaviorally, not just syntactically.** "It imports" or "it
   parses" is not "it works." Restart/reload the real thing and exercise the
   paths that actually touch the split code, including whichever shared-state
   reassignment case is the one genuine risk (a value replaced wholesale in
   one place, read fresh from another — confirm the read sees the update, not
   a stale copy captured before the split).

## Signs you've found real state coupling, not a clean cut

- The same variable name is written in one function and read in a function
  physically far away in the file, with no shared class/object between them.
- A "capture the state at the top" refactor keeps growing because more reads
  and writes keep turning up further down the file.
- If in doubt, grep every definition (`^def \|^class `) against every
  reference to the candidate shared names before deciding the split boundary
  — don't guess the boundary from line count alone.

## Dead code uncovered during a split

- Run the page/program and capture load-time errors **before and after** the
  split. A pre-existing top-level throw in a classic script silently makes
  everything after it in that file dead. Same error before and after means the
  split didn't cause it.
- Code after a top-level throw never ran, but its hoisted `function`
  declarations still exist globally. Grep every such name across all files
  and inline handlers before deleting the region. Delete only when none are
  referenced. Don't "fix" the throw instead: that would run long-dead code and
  change behavior.

---
name: agent-efficiency
description: >-
  Silent, automatic usage discipline for any hands-on engineering work. Use
  whenever Claude Code is coding, implementing, refactoring, debugging, testing,
  verifying, reviewing, or exploring/searching a repository - and whenever a
  decision touches context size, tool calls, spawning subagents or workflows,
  choosing a model for a subtask, or whether to /compact or /clear. Keeps
  credit/token usage low across the session, including when the user mentions
  cost, credits, or usage. Applies without the user naming it; never asks the
  user whether to optimize.
---

# Agent efficiency

Spend tokens where they change the outcome. Scale effort to the task: a one-line fix gets a direct edit and one check; an unfamiliar multi-file bug gets real investigation. **Never trade correctness for savings** - necessary reading, reasoning, testing, and verification always happen.

Most spend comes from **context re-read on every turn**, not from the answer: keep the context small and each turn productive.

Run silently. Don't announce this skill, don't ask permission to be efficient, don't narrate choices you won't take.

## 1. Subagents: only when they pay off

Spawn one only if at least one holds:
- The work is **independent and parallel** (e.g. two unrelated investigations) and doing it inline would be slower.
- It needs a **broad sweep** (many files/naming conventions) where you only need the conclusion, not the file dumps.
- The output would **flood the main context** (long logs, big search results) and a summary is enough.

Do it yourself when: you already know the file or symbol, it's 1-3 targeted searches/reads, or the next step depends on details you'd have to re-read anyway.

When you do spawn:
- One agent per independent question; send parallel ones in one message.
- Brief it fully (it has none of your context): goal, known paths, what's already ruled out, and the **exact return shape** - e.g. "at most 15 lines: file:line + one-sentence finding each; no code dumps."
- Use the narrowest agent type (read-only search -> Explore).
- Don't also run the same search yourself; wait for its result. Don't re-verify what it verified unless the finding is load-bearing and surprising.

## 2. Model per subtask (when selectable)

- Mechanical/lookup (find files, list usages, summarize a log, rename) -> smallest fast model (e.g. haiku).
- Normal implementation/investigation -> mid tier (e.g. sonnet) or inherit.
- Architecture, subtle bugs, security, anything where a wrong answer is costly -> inherit the strongest model.
If unsure, inherit. Cheap models are for tasks whose results are easy to check. The user can switch with `/model`; fast mode speeds up output but doesn't reduce usage.

## 3. Investigation: targeted first

1. Use what's already known: the conversation, CLAUDE.md, the project's skill/file map, `git log`/`git diff`. Start from the file map and open only the owning file; never dump minified or generated files.
2. Search exact names (Grep/Glob) before opening files; read only the relevant range of large files.
3. Widen only when targeted search fails. Stop once you can act.
- Batch independent tool calls in one message.
- Never re-read a file you just read or edited, re-run an unchanged check, or repeat a search with the same inputs.
- Prefer one command that answers the question over several that each answer part.

## 4. Context hygiene

- Keep tool output small: filter (`head`, `grep`, `--short`, `-q`), don't dump whole files or logs.
- Don't paste screenshots or logs back into chat; summarize the one fact that matters.
- Carry forward conclusions, not raw output. Record durable facts in files (docs, memory), not chat.
- Keep replies short; don't restate code or output the user can see.
- Project memory: check what the project already records before investigating. A fact that permanently changes how the project works goes into the rule, skill, script or doc that already owns that topic (one home per fact). Record the fact, not the story of finding it, and state intentional limitations plainly so they aren't re-investigated.

## 5. Changing

- Build on facts from the source of truth (the API, data file, real dimensions, rule file), not memory. Before the first build, be able to say in a few lines: what it is, what it must fit or do, what "done" looks like, what it must not have, and what only the user can decide (ask that once, now). Can't say it: you don't know enough yet.
- Before editing, name the exact files to change, why, and which files must not change. For a multi-file change, sketch the dependency map first.
- Make the smallest change that fully solves the request, reusing existing code; don't rewrite surrounding code or add abstractions nobody asked for. Check first: does this already exist (extend it)? Is it a problem we actually have? Would a new file, layer or option earn its keep today?
- Batch related edits into one pass. Ask a question only when the answer changes what you build. If the user asks why you didn't make the change they already named, that is a go: make it, don't answer with another plan.
- Build once with one approach. Two failed iterations means the facts are wrong, not the tuning: go back to the facts instead of stacking fixes.
- Verify with the cheapest check that proves the change (syntax check -> scripted test -> screenshot), and prefer saved scripts over rebuilding test setups. Check the actual output, not just a zero exit code. Before trusting a "safe" cleanup or refactor, run the old and new code on the same input and compare.
- Don't build, package, deploy, or commit unless asked.

## 5b. Debugging

Find the mechanism before changing anything; a fix without a known cause is a guess. Reproduce it or read the exact error text (never a paraphrase), find the code that produces the symptom, and compare against a working case (the difference is usually the bug). Fix the cause, not the symptom (no fallback that hides it), check whether the same bug exists elsewhere, and record failed attempts per `failure-memory`.

## 6. /compact and /clear (you can suggest, not run)

Say it in one line at a natural break, never mid-task, never as a question that blocks work:
- **/compact** (`/compact <what to keep>`: goal, decisions, edited files, next step) - the session is long, the current task continues, and much earlier context (old logs, exploration, finished sub-steps) is dead weight. Best right after a milestone (tests pass, commit made).
- **/clear** - the task is done and the next request is unrelated, so none of this context helps. Suggest after making sure anything durable is saved (commit if approved, docs/memory updated).
- Neither - the context is still small, or the next step needs the details just gathered.
- `/context` shows what is filling the window. One feature per session works best: the goal, constraints, and done-criteria in one message.

## 7. Adaptive guardrails

- Correct > cheap. If a check is needed to know it works, run it; if a bug's cause is unclear, investigate until it's clear.
- Don't skip reading code you're about to change.
- If efficiency rules conflict with the user's explicit instruction or the project's CLAUDE.md, those win.
- After a substantial task, turn anything done repeatedly into its cheapest permanent form: a script/command if code can do it, a skill if it needs judgment, a doc if it is knowledge. Update the existing one instead of adding a duplicate. Suggestions cost usage too: propose only the cheapest option that solves the real problem, and say the cost before anything expensive.
- Related: `ground-truth` (verify the real artifact), `failure-memory` (dead ends).

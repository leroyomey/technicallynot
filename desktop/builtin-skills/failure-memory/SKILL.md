---
name: failure-memory
description: >-
  Records approaches that failed and the fix that actually worked, so dead ends
  are not retried. Use when an attempt fails, when choosing an approach that
  resembles a past attempt, or when the same error appears again.
---

# Failure memory

**TL;DR:** When something fails, record what was attempted, why it failed, and what actually worked, in a few lines next to the code that caused it. Do not retry a known dead end unless the relevant code, config, or environment changed, and say what changed.

When an approach fails, record:

- what was attempted
- why it failed
- what actually worked

Before trying a similar approach later, check whether we've already established that it doesn't work.

Do not repeatedly retry known failed approaches unless the relevant code has changed.

## Recording a failure

Keep it to a few lines, next to the code or config that caused it. A comment at the surprising line, or a note in the project rule that governs the area, beats a separate document nobody opens.

Record the trigger in words that will be searched later: the exact error text, command, or symbol.

## When to retry anyway

A known failure is not permanent. Retry when the relevant code, dependency, config, or environment has changed since it failed. Say what changed when you do.

## Timebox the chase

Two rounds of investigation without locating the actual cause means the current theory is probably wrong, not that it needs more tuning. Stop, write down what's been ruled out (as a failure record, not silently), lower the task's priority if nothing else is blocked on it, and move on. Making progress elsewhere beats winning an argument with one bug.

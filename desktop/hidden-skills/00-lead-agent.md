---
name: lead-agent
description: Claude Code only. Tells the agent it runs inside Technically Not and how to title sub-agents so Technically Not can show them.
for: claude-code
tnai-hidden: true
---
You are running inside Technically Not, a workspace that shows your work live, including any sub-agents you start. Messages that start with "[TN.ai]" come from the Technically Not composer.
When you start a sub-agent, make the first line of its prompt "Summary: " plus one plain sentence a non-programmer understands (what it does and why); Technically Not shows that line to the user and folds the full prompt below it.
When the user names a sub-agent (e.g. "start a sub-agent called bug reporter"), make the second line "Name: " plus exactly that name; Technically Not shows it as the sub-agent's name instead of picking one. With tnai_delegate, pass it as `name`; with `tnai new`, as `--name "…"`. Leave it out when the user gave no name.

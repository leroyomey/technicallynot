---
name: lead-agent-codex
description: Codex only. The part of lead-agent (00) that is true for Codex: it runs inside Technically Not and names sub-agents through tnai_delegate or `tnai new`. The "Summary:" and "Name:" prompt lines of 00 belong to Claude Code's own sub-agent tool and are left out.
for: codex
tnai-hidden: true
---
You are running inside Technically Not, a workspace that shows your work live, including any sub-agents you start. Messages that start with "[TN.ai]" come from the Technically Not composer.
When the user names a sub-agent (e.g. "start a sub-agent called bug reporter"), give it exactly that name: with tnai_delegate, pass it as `name`; with `tnai new`, as `--name "…"`. Technically Not shows it as the sub-agent's name instead of picking one. Leave it out when the user gave no name.

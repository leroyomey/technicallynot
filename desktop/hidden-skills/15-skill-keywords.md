---
name: skill-keywords
description: Skills are picked by keyword: an agent reads a skill whose name words or keywords appear in its task and whose description fits it (a skill with "ui" in its name for a UI task).
for: every-agent
tnai-hidden: true
---
- Skills are matched by keyword. Before starting a task, compare its words with the names and `keywords:` of the project's skills (`.claude/skills`, `.agents/skills`, `.codex/skills`): read and follow a skill when its name words or keywords appear in the task and its description fits the task, e.g. a skill with "ui" in its name for any task about the UI, interface or styling. A single common word (file, domain, usage) is not enough; every skill you read is paid for again on each later request. When Technically Not lists "Skills that match this prompt" with your prompt, read those first, before you start and not at the end (on Claude Code, Technically Not holds your finish once when one of them was never read); "Skills that may match" only if their description fits. A skill's `paths:` line names the files it owns: before you change one of those files, read that skill.

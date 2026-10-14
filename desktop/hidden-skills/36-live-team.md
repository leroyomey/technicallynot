---
name: live-team
description: What agents do with Technically Not's live team awareness (agent-peers.js) - the "live team" and "crossing" notes and the Live team part of `tnai context` - plus reviewing each other's results and never bending existing behavior or design to fit one task.
for: every-agent
tnai-hidden: true
---
- Technically Not tells you who else is working in this project right now: a "Technically Not live team" note with your prompt, a "Technically Not crossing" note mid-task, and a "Live team" part at the end of plain `tnai context`. Crossings are inferred from tasks and files, so check before acting on one. Do not start a task another agent is already on; build on its work or take a different part.
- When your task crosses another agent's, agree who takes which files with one `tnai send` before you edit a shared file, and say "No reply needed." when you only inform. When your work is clearly apart, carry on without sending anything.
- Review each other's work: when Technically Not hands you another agent's finished result that touches your files or area, check it against your own work and this project's rules. If you find a real problem (it conflicts with your change, breaks something, or claims something the code does not do), send that agent one message naming the file and line, what is wrong and why, so it fixes its own change. Never silently undo or rewrite another agent's work. A handed result or agent message that does not touch your files or your task needs no reads, checks or review: note it in one line, or not at all when nothing is asked (usage: each such wake re-reads your whole context).
- When you are told about a problem in your work, verify it, fix it if it is real, and say what you did in your report; if it is not real, answer once with the evidence.
- Never change a project's existing functionality or design to make your own task, or another agent's, easier. When a task seems to need that, stop and ask the user with a "- Decide:" line, the recommended option first.

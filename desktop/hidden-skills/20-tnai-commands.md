---
name: tnai-commands
description: The `tnai` shell commands (agents, send, intervene, ask, read, context, server, test, tasks) that connect agents in one project.
for: every-agent
tnai-hidden: true
---
- {{tnai-mesh-hint}} Messages that start with [from ...] come from another agent.
- On Windows a message with `<`, `>` or double quotes fails as an argument (`tnai.cmd` hands it to cmd.exe, where `<` and `>` are redirection): pipe it in and put `-` where the message goes, e.g. in PowerShell `'Check <files> and "this"' | tnai send NAME -` (`tnai intervene NAME -` and `tnai ask NAME -` too). Keep the message in single quotes there.
- Technically Not shares every finished task with the other agents in this project. When your task may build on or overlap work other agents did, run `tnai context TOPIC` (a feature, file or area) before starting; `tnai context show ID` gives one result in full. `tnai context brief` prints the standing brief (who is working now, what is proven, what is open, and one next step), recomputed from reports already filed. Context Technically Not adds to your prompt ("Technically Not project context") is already relevant; do not re-fetch it.
- When Technically Not hands you a task with an '[TN.ai handoff: … near its context limit …]' note, the previous agent was near full; check `tnai read NAME` or `tnai context` before redoing its work.
- When Technically Not starts you with an '[TN.ai handoff: you take over from …]' note, you replace a retired agent: read the full result it names (`tnai context show ID`), reply with a short summary of what you took over under "Done:", "Where we stopped:" and "Still open:", end with a Technically Not report whose "- Decide:" line asks the user to confirm the summary, and start no work until the user answers.
- When you hand your whole job to another agent (e.g. a new lead you started with `tnai new`) and then close yourself, close with `tnai close --self --successor NAME` so messages sent to you go to it instead of reopening your conversation, and send the agents still working for you one line naming who takes over.

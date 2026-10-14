---
name: idea-score
description: When the user shares an idea or asks if one is good, the agent rates its fit for this project as a percentage with short reasons; Technically Not shows the "(fit NN%)" of report Ideas as a badge in Project context.
for: every-agent
tnai-hidden: true
---
- When the user shares an idea or asks whether an idea is good or worth doing, rate how well it fits THIS project before anything else: start your answer with the line "Idea fit: NN%" (0–100), then 3–5 short reasons, each judged against this project, then a one-line verdict (do it, do it later, change it, or skip it).
- Judge the idea against: the project's goals and notes (`tnai context note list`, its docs and README), the value to its users, the effort and risk compared with that value, and any conflict with locked decisions the user made. Name the conflict when there is one.
- Check what exists before you propose, so that the user is not sent into a dead end: when you come up with ideas for something to build or sell (a product, an extension, a tool, a feature meant to be new), search for existing versions of each one before you show the list, with short searches of two to four words (a long exact description finds nothing and looks like a gap). Next to each idea say what already exists, by name, and roughly how used it is; drop or mark the ideas that are already crowded, and never call an idea "open", "new" or "not popular" from memory. With no search tool, say on the first line that nothing was checked.
- Be honest: don't inflate the score to please the user, don't score from general taste alone, and say what you did not check. Unless the user also asked you to build it, rate it and stop; don't start the work.

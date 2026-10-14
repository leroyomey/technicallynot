---
name: durable-data-design
description: >-
  Two data-shape defaults that avoid bugs which only appear later: derive an
  entity's identity from a value intrinsic to the data, never from where or
  how it was scanned; and size a cap/limit for future growth, with a failure
  mode that degrades partially rather than looking like an unrelated error.
  Use when adding an id/key for something, or adding a size/length cap to a
  read or buffer.
---

# Durable data design

**TL;DR:** An id must come from the data itself, never from scan position or
which read produced it. A cap/limit must be sized for where the data is
going, not where it is today, and its failure must look like truncation, not
like a different, unrelated problem.

## Identity must be intrinsic to the data

A bug class: something is given an id derived from its position within
whatever was scanned to find it (a line index within a tail-read blob, an
array index, an offset). This works exactly as long as there is only one
reader, one scan range, one order. It breaks the moment a second reader scans
the same underlying data differently — a different start point, a different
range, a different order — and computes a *different* id for the *same*
logical entity. Two readers now disagree about what one thing is called.

**The fix:** use a value that is part of the entity itself and does not
depend on how it was found — a UUID already embedded in the record, a
content hash, a primary key from the source system. Never a position, index,
or offset computed from this particular read.

Before adding an id/key to something, ask: if a second, differently-scoped
piece of code needed to compute this same id for the same entity, would it
get the same answer? If the answer depends on matching scan ranges, the id is
not durable.

## Caps and limits need headroom, and a partial failure mode

A size cap on a read or buffer ("read the last N bytes", "cap at N KB") is
easy to set once against the current size of real data and forget. Two ways
this goes wrong later:

1. **The cap gets crossed as data grows**, silently working fine for months
   and then failing exactly when the data finally exceeds it — a bug that is
   invisible in every test written against today's data size.
2. **Crossing the cap for a single structured record (e.g. one JSON object)
   can fail *entirely*, not partially.** A truncated read that cuts a JSON
   document mid-structure fails to parse as a whole, which can look
   indistinguishable from a completely different failure state (e.g. "not
   logged in" instead of "the read was truncated") — actively misleading
   about what's actually wrong.

**The fix:** size the cap for where the data is realistically going, not its
current size, and audit these against growth rather than against the file you
happen to be looking at today. Where possible, prefer a failure mode that
degrades gracefully (missing the oldest entries, a visibly truncated result)
over one that fails a structured parse entirely and gets misread as a
different bug.

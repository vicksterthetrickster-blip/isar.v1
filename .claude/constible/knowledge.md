# Constible Code: knowledge base

What Constible Code learned before judging Isar. The main source is Lauren Tan's talk at AI Engineer
Code Summit 2026 (11 Nov 2026), "All Code Is Slop (Except Mine)". It is often summarised as
"review proof, not code". Other talks and write-ups back it up.

## Core idea: review proof, not code (Lauren Tan)

AI agents copy whatever patterns they find in a codebase. A messy repo produces more mess, and a clean
repo produces cleaner work. So you don't trust the agent, and you don't read every line it writes.
You build layers that **stop bad code from getting in** and **prove the good code works**.

Her "inverse pyramid of trust", from most reliable to least:

1. **Codebase design** (deterministic). Good interfaces, clear architecture, refactoring, folders
   that keep parts separate. Her team bans cross-imports between the server side and the browser side.
2. **Automatic checks** (deterministic). Lint rules, types, compilers, tests. "It's far more
   reproducible when it's in code and it lets you trust it more."
3. **Verification of behaviour.** Agents run the real app (e.g. Chrome DevTools Protocol) and return
   screenshots and videos as evidence. For the riskiest logic: model checking (TLA+), proofs (Lean),
   property-based tests. Her code review "has now really shrunk into looking at verification artifacts".
4. **Written rules last.** Prose rules (agents.md, skills) only cover what needs judgement, because
   prose can't be enforced.

Practices she named:
- **Turn every correction into a check.** "Every time we correct our agents, it turns into one of
  these deterministic checks", and "we never need to catch that during code review again."
- **Ban constructs that agents misuse.** Her example is React's `useEffect` in product code.
  "Anything that requires nuance to use well often leads to slop."
- **Fix the root cause**, not the symptom. Workarounds left in the code teach the next agent to add more.
- **Comments are mostly banned.** They go stale and nothing checks them. Agents used comments to
  justify timer hacks (`setTimeout` and similar) that covered up an architecture problem. Put the
  real fix into a lint error message instead.
- **A feature map**: a written list of what the product does, so people and agents use the same words.
- **Automate the outer loop last**, only after the inner checks are reliable. "Not a silver bullet."

## Supporting views

- **Alex Volkov, "The Z/L Continuum"** (AI Engineer World's Fair 2026): decide how much reading a
  change needs **by task**. Authentication, **money movement**, permissions and irreversible data
  changes still need line-by-line human reading. Keep roles separate: "If the builder grades
  itself, review has been hidden rather than eliminated."
- **Ankit Jain, "How to Kill the Code Review"** (World's Fair 2026): be "deterministic where it can be,
  but LLM where you must". Keep an "AI slop register" of recurring review comments and turn each one
  into an automatic check. Derive tests from what was *asked for*, not from the code, so the tests
  don't copy the agent's mistakes.
- **Harry Nicholls, "Review Evidence, Not Code"** (Oct 2026): label every claim Proved / Tested /
  Observed / Judged, each traced to a requirement. The spec itself is the biggest open risk.
- **AIE Code Summit 2025 (Turing Post write-up)**: verify the outcome, not the process ("Is the kettle
  whistling?"). Clean repos give AI a big boost, while messy "brownfield" code gives little or none.
  "Many tasks are much easier to verify than to solve."

## How this applies to Isar

Isar is plain JavaScript with no build step. It has **no linter, no type checking and no automated
tests**, so layers 2 and 3 are almost empty and everything rests on prose (README rules) and human
reading. Isar also handles **money and bank connections**, which Volkov's rule puts in the "read
every line" category. The biggest improvements are adding cheap deterministic checks and protecting
the money and auth paths, ahead of style tidy-ups.

## Sources
- https://ai.engineer/code/2026/talks/lauren-tan (transcript; video https://www.youtube.com/watch?v=ZZ19zhYnDKY)
- https://www.testsprite.com/blog/lauren-tan-all-code-is-slop-verification-lessons (vendor write-up)
- https://ai.engineer/talks/the-z-l-continuum-should-ai-engineers-still-read-code
- https://ai.engineer/talks/how-to-kill-the-code-review
- https://brainflow.substack.com/p/review-evidence-not-code
- https://www.turingpost.com/p/aisoftwarestack

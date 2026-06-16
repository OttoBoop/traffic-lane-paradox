---
name: research-to-table
description: >-
  Research a list of subjects across several dimensions and synthesize the results into a clear,
  source-backed comparison TABLE (plus optional per-subject detail and a ranking). The subjects can
  be anything — people, companies, startups, products, papers, technologies, vendors, options,
  legal/administrative cases, or processes. Use whenever the user wants to evaluate, compare,
  triage, or "make a table/matrix" over many entities by researching each one: e.g. "build a table
  of these N with columns A/B/C", "compare these options on price/risk/fit", "research each of these
  and tell me which is best for X", "who/what here can help with Y". For a single-topic cited prose
  report, prefer the deep-research skill instead; this skill is for MANY subjects → one comparison table.
---

# Research → Table

Turn "research N subjects across M dimensions, then lay it out as a table" into a reliable loop.
This encodes a workflow that has been battle-tested; the **Anti-patterns** at the bottom are real
failures — honor them.

## 0 — Lock the scope first (clarify, don't assume)
Use `AskUserQuestion` for anything genuinely ambiguous. Pin down:
- **Subjects**: the exact list + how to obtain it (pasted text, a URL, a file).
- **Columns / dimensions**: what to research per subject. Make each column **concrete and
  self-descriptive**, and restate them back to the user. (e.g. "what it is", "size/cost/value",
  "fit for <goal>").
- **The lens / goal**: the single question the table must answer (e.g. "which can help Rio?",
  "which is cheapest with lowest risk?"). Every row must speak to it.
- **Missing-data policy**: how to handle unknowns. Default: **always show a best estimate or proxy
  with a confidence label — never a bare "unknown/N/A/not public"**.
- **Output**: destination + format (markdown file / CSV / PDF / chat) + language.

## 1 — Get the subject list (don't quit at a block)
Prefer a clean source. If a site is JS-rendered or returns 403/anti-bot, escalate in order:
(a) ask the user to paste the HTML/list; (b) `WebSearch`; (c) a real-browser fetch or
`curl_cffi` with browser-TLS impersonation; (d) the Wayback Machine. If all fail, ask the user.
Record a **canonical list with a disambiguation seed** per subject (name + one identifier, e.g.
role/company/URL/ID) — essential for common names and homonyms.

## 2 — Research loop: fan-out with FLAT workers
For each subject, launch **one** research sub-agent that fills the columns. Hard rules:
- **Flat only.** Tell each worker it **MUST NOT** use the Agent/Task tool or spawn sub-agents —
  it does its own `WebSearch`/`WebFetch` (cap ~6–10 calls). Nested fan-out causes server
  rate-limit storms; this is the #1 failure mode.
- **Small batches** (~4–6 workers in parallel), not all at once.
- Each worker returns a **compact structured block**: one field per column + **sources** + a
  **confidence** per claim. Search in the subject's native language when relevant.
- **Distinguish documented fact (with source) from plausible inference.**
- For any "size/value/cost" column with no public figure, return a **proxy** (valuation, funding
  raised, revenue, AUM, budget, salary band, assets, headcount) — labelled as a proxy. Never a dead end.

(Workers run in their own context, so only their compact result lands in yours — that's why
fan-out keeps your context clean.)

## 3 — Persist incrementally
Write the output file early as a **scaffold with one numbered slot per subject**; fill each slot as
its worker returns. Keep a **coverage counter (k/N)**. This survives context limits and lets you
resume after interruptions.

## 4 — Review / verification pass
A dedicated pass over the filled rows before finalizing:
- **Independently re-verify the load-bearing claims** — the ones that drive the table's verdict or
  ranking, plus any headline numbers.
- **Disambiguate** homonyms against the seed identifier (right person/company/thing?).
- **Normalize** wording and scales so cells are comparable; keep fact separate from inference.
- **Coverage**: every subject present; every cell filled or explicitly proxied — no blanks.

## 5 — Build the table (this is the deliverable)
- Columns must **directly answer the user's question in plain language**. Do **not** invent abstract
  columns the user didn't ask for.
- Be **constructive**: prefer "how / why this is useful for <goal>" over a dismissive "no". If a
  yes/no verdict is required, always pair it with the reason.
- Always show the **value/proxy + confidence** in size columns; never "unknown" alone.
- **Flag the standouts** (e.g. a ⭐) so the reader can triage at a glance; optionally sort by relevance.
- Put per-subject **detail/dossiers below the table**, and a short **ranking / "top picks for <goal>"**
  synthesis at the end.

## 6 — Document hygiene: the artifact serves the READER
- The final document **opens with the answer** (a one-line intro + the table). No status banners.
- **Keep your own limitations OUT of the document.** Tool blocks, 403s, "couldn't fully verify X" →
  say it in **chat**, not in the artifact. If a fact is weak, lower its **confidence label** silently.
- **Cite sources. Never fabricate** a number or a tie.

## 7 — Export (optional)
Markdown is the source of truth.
- **PDF**: run `scripts/md_table_to_pdf.py INPUT.md OUTPUT.pdf` (landscape A4, Unicode font, no
  browser/network needed — works where headless Chromium can't be installed). Deps:
  `pip install markdown fpdf2`.
- **CSV**: emit the table rows directly (one row per subject; quote cells containing commas).

## Anti-patterns (real failures — avoid)
- ❌ Workers that spawn their own sub-agents → rate-limit storm. **Forbid nesting explicitly.**
- ❌ An abstract column nobody asked for (e.g. "strongest lens") instead of the question asked.
- ❌ "Value: not public" with no proxy. **Always give a size proxy + confidence.**
- ❌ Opening the document by apologizing about access blocks. The reader doesn't care; that's chat.
- ❌ Giving up at a 403. Try search / a real browser / alt sources first.
- ❌ A wall of "no / unlikely" rows. Reframe each as the realistic way the subject *could* contribute.

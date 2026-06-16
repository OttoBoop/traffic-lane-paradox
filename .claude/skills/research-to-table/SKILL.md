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

Turn **"research N subjects across M dimensions, then lay it out as a table"** into a reliable,
repeatable loop. Every rule below was paid for in a real task — see
`references/origin-and-example.md` for the full origin story and a worked example (it shows what
each phase looked like in practice and which mistakes created which rule).

## The flow at a glance
```
0. Scope        → agree on subjects, columns, the lens/goal, output, missing-data policy
1. Get the list → navigate the source normally; escalate only if blocked; build a seed list
2. Fan-out      → one FLAT research worker per subject, in small batches
3. Persist      → write a scaffold with numbered slots; fill as results arrive (k/N)
4. Review       → independently re-verify the load-bearing claims; disambiguate; normalize
5. Table        → columns that answer the question; constructive; always a value/proxy; ⭐ standouts
6. Hygiene      → the artifact opens with the answer; your limitations go in CHAT, not the doc
7. Export       → PDF / CSV on request
```

---

## Phase 0 — Lock the scope (clarify, don't assume)
Use `AskUserQuestion` for anything genuinely ambiguous; otherwise pick a sensible default and say so.
Agree on:
- **Subjects** — the exact list and how to obtain it (pasted text, a URL, a file).
- **Columns / dimensions** — what to research per subject. Make each column **concrete and
  self-descriptive**, then **restate them back** to the user before researching.
- **The lens / goal** — the single question the table must answer ("which can help X?", "cheapest
  with lowest risk?", "which to shortlist?"). Every row must speak to it.
- **Missing-data policy** — default: **always show a best estimate or proxy with a confidence
  label; never a bare "unknown / N/A / not public".**
- **Output** — destination + format (markdown file / CSV / PDF / chat) + language.

> Why: in the origin task, skipping this caused two full rewrites (wrong column, wrong framing).

## Phase 1 — Acquire the subject list (navigate the source like a normal user, then escalate)
1. **Try the normal path first.** Open/read the source the way a visitor would — `WebFetch` the
   page (or the user's link). Catalog/listing/"speakers"/"portfolio"/"vendors" pages usually hold
   the whole roster, sometimes paginated.
2. **If it's plain server-rendered HTML**, extract directly from the repeating *card* pattern: each
   item is typically a **heading (name) + a subtitle (role/category) + a link (profile/detail URL)**.
   Pull `name + subtitle + URL` for every card. Mind pagination ("next/page").
3. **If it's JS-rendered or behind anti-bot (HTTP 403 / Cloudflare / login)**, escalate in order:
   (a) **ask the user to paste the page HTML or the list** — fastest and most reliable; (b)
   `WebSearch` for the roster; (c) a **real browser** (Playwright) or `curl_cffi` with browser-TLS
   impersonation; (d) the **Wayback Machine**. Some sandboxes block browser downloads and even the
   edge IP — if so, fall back to (a).
4. **Build the canonical seed list**: `[ name | identifier ]` per subject, where the identifier is a
   role/company/URL/ID. A **disambiguation seed is non-negotiable** for common names/homonyms.
5. **Sanity-check** the count and odd entries (CMS artifacts, two names merged into one, typos in
   slugs). Note anything to confirm during research.

> Why: don't quit at a 403 — but also don't burn an hour fighting a WAF when a paste solves it.

## Phase 2 — Research loop: fan-out with FLAT workers
For each subject, launch **one** research sub-agent that fills the columns.

**Worker contract (the rules that matter):**
- **Flat only.** State explicitly: the worker **MUST NOT** use the Agent/Task tool or spawn
  sub-agents. It does its own `WebSearch`/`WebFetch`, capped at ~8–10 calls. *Nested fan-out is the
  #1 failure mode — it triggers server-wide rate-limit storms.*
- **Small batches** — ~4–6 workers in parallel, not all N at once.
- **Compact structured output** — one field per column + **sources** + a **confidence** per claim.
  Search in the subject's native language when relevant.
- **Fact vs. inference** — separate documented fact (with source) from plausible inference.
- **Always a proxy** — for any size/value/cost column with no public figure, return a proxy
  (valuation, funding raised, revenue, AUM, budget, salary band, assets, headcount), labelled.

**Reusable worker prompt template:**
```
REGRAS: você NÃO pode usar a ferramenta Agent/Task nem lançar sub-agentes. Faça as buscas você
mesmo com WebSearch/WebFetch (máx ~8–10 chamadas). Se um site bloquear (403/login), não insista —
use snippets e siga. Devolva APENAS o bloco estruturado (sem preâmbulo).

SUJEITO: <nome> — <seed: papel/empresa/URL>
CONTEXTO/LENTE: <o que é a lista e qual a pergunta-objetivo>

Preencha, em <idioma>, com citação inline [n] e fontes no fim:
- <COLUNA "o que é">: descrição curta + por que importa.
- <COLUNA "tamanho/valor">: cifra pública (fonte+data+confiança) OU um PROXY rotulado
  (valuation/captação/receita/AUM/orçamento/faixa salarial/ativos). Nunca "não público" sozinho.
- <COLUNA da LENTE>: ângulo concreto e CONSTRUTIVO de como <sujeito> serve a <objetivo>;
  separe vínculo DOCUMENTADO (fato+fonte) de capacidade plausível.
- FONTES & CONFIANÇA: links (priorize primárias) + confiança geral [Alta/Média/Baixa].
```
(Workers run in their own context, so only the compact result lands in yours — that's why fan-out
keeps your context clean even for large N.)

## Phase 3 — Persist incrementally
Write the output file early as a **scaffold: one numbered slot per subject** (`<!-- SLOT_7 -->`).
Fill each slot as its worker returns, and keep a **coverage counter (k/N)**. This survives context
limits and lets you resume after interruptions — never hold all results only in memory.

## Phase 4 — Review / verification pass
A dedicated pass over the filled rows before finalizing:
- **Independently re-verify the load-bearing claims** — the ones that drive the verdict/ranking,
  plus any headline numbers — against a second source.
- **Disambiguate** homonyms against the seed identifier (right person/company/thing?).
- **Normalize** wording and scales so cells are comparable; keep fact separate from inference.
- **Coverage** — every subject present; every cell filled or explicitly proxied; no blanks.

## Phase 5 — Build the table (the deliverable)
- Columns must **directly answer the user's question, in plain language**. Do **not** invent an
  abstract column the user didn't ask for.
- Be **constructive** — prefer "how / why this is useful for <goal>" over a dismissive "no". If a
  yes/no verdict is required, always pair it with the reason.
- Always show the **value/proxy + confidence** in size columns; never "unknown" alone.
- **Flag the standouts** (e.g. ⭐) so the reader triages at a glance; optionally sort by relevance.
- Put per-subject **detail/dossiers below the table**, and a short **ranking / "top picks for
  <goal>"** synthesis at the end.

## Phase 6 — Document hygiene: the artifact serves the READER
- The final document **opens with the answer** (a one-line intro + the table). No status banners,
  no checklist, no methodology dump up top.
- **Keep your own limitations OUT of the document.** Tool blocks, 403s, "couldn't fully verify X" →
  say it in **chat**, not in the artifact. If a fact is weak, just lower its **confidence label**.
- **Cite sources. Never fabricate** a number or a tie.

## Phase 7 — Export (optional)
Markdown is the source of truth.
- **PDF**: `python scripts/md_table_to_pdf.py INPUT.md OUTPUT.pdf` — landscape A4, Unicode font, no
  browser/network needed (works where headless Chromium can't be installed). Deps:
  `pip install markdown fpdf2`.
- **CSV**: emit the table rows directly (one row per subject; quote cells containing commas).

## Anti-patterns (real failures — avoid)
- ❌ Workers that spawn their own sub-agents → rate-limit storm. **Forbid nesting explicitly.**
- ❌ An abstract column nobody asked for (e.g. "strongest lens") instead of the question asked.
- ❌ "Value: not public" with no proxy. **Always give a size proxy + confidence.**
- ❌ Opening the document by apologizing about access blocks. The reader doesn't care; that's chat.
- ❌ Giving up at a 403 before trying search / a real browser / alt sources.
- ❌ A wall of "no / unlikely" rows. Reframe each as the realistic way the subject *could* contribute.

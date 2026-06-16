# How this skill was born — the origin task & a worked example

This skill is a generalization of one real, messy task. Reading the story is the fastest way to
understand *why* each phase exists, because most rules here are scar tissue from a specific mistake.

## The initial ask
> "I need a table of every *speaker* at an event (here's the site link), saying **why each is
> notable**, their **net worth**, and **whether there's any reason to believe they can help Rio de
> Janeiro**. Relatively deep research per speaker, in a loop, then a review phase." *(translated)*

So: **N subjects** (speakers) × **3 dimensions** (notability, net worth, "can help Rio") → **one
table**, with deep per-subject research and a review pass. That shape — *many subjects, several
dimensions, one table* — is exactly what this skill generalizes (subjects can be anything, not just
people).

## Phase by phase: what actually happened

**Phase 0 — Scope.** We asked 4 clarifying questions (what "help Rio" means, output format, how to
treat net worth, how to get the list). This was *correct* — but we didn't fully nail the **column
design** and **framing**, which cost two rewrites later. Lesson reinforced: restate the columns and
the lens before researching.

**Phase 1 — Get the list (normal navigation, then escalation).** We first tried to **navigate the
site normally** (`WebFetch` on the speakers page). It returned **HTTP 403**, which we *assumed* was
the site's anti-bot — and the roster was **JS-rendered** anyway, so the HTML had no names. Web search
**conflated the event with a different one** ("South Summit Brazil"), so scraped names would have
poisoned everything. The reliable fix: **the user pasted the page HTML**, and we extracted the
canonical list — **33 speakers** — from the repeating Elementor card pattern (`<h3>` = name, an
excerpt block = role, `<a href>` = profile slug), keeping a **seed** (name + role + slug) per speaker
for disambiguation. *(Much later we discovered that 403 was never the site at all — see "Plot twist"
below.)* Lesson: try normal navigation first; when blocked, a user paste beats fighting the block;
always keep a disambiguation seed.

**Phase 2 — Fan-out research.** First attempt: we launched general-purpose workers — but each worker
**spawned its own 5 nested search sub-agents**. ~30+ concurrent agents → a **server-wide rate-limit
storm**; most returned errors, and the parents couldn't synthesize. This was the worst failure of
the task. The fix: **flat workers** — every worker explicitly *forbidden* from spawning sub-agents,
run in **small batches (~5)**, each returning a compact structured dossier (bio, net-worth/proxy,
the Rio lens, sources, confidence). After that, the loop ran clean for all 33. Lesson, now rule #1:
**flat workers, no nesting, small batches.**

**Phase 3 — Persist.** We wrote the markdown file early as a **scaffold with numbered slots**
(`<!-- SLOT_12 -->`) and a coverage line (k/33), filling each slot as workers returned. Context got
long and was summarized mid-task — the file is what made it resumable.

**Phase 4 — Review.** We re-verified the **load-bearing claims** (the documented Brazil ties that
drive the ranking, and big numbers) against independent sources — e.g. *17 funds in Brazil* for the
top VC pick, *South Summit Brazil 2024* for the entrepreneurship pick, *2TM = US$2.1B / SoftBank*
for the wealth proxy.

**Phase 5 — The table (this took three tries).**
- *Draft 1* used an abstract column **"strongest Rio lens"** (jargon we invented). The user, rightly:
  *"that has nothing to do with what I asked."* → **Columns must answer the asked question.**
- *Draft 2* had **"net worth: not public"** in most cells. The user: *"stop with 'not public' —
  show the companies/income that are the source of the wealth; net worth is just one field."*
  → **Always show a proxy** (valuation/funding/revenue/AUM/salary), never a dead end.
- The document also **opened by apologizing about the 403 blocks**. The user: *"the reader wants to
  see who's at the event — your limitations go in the logs, not the document."* → **Document hygiene:
  reader-first; limitations to chat.** Also: *"don't give up on the 403s — search harder, confirm
  sources."* So we did targeted gap-research to put a **real proxy and a constructive angle on every
  row**, and reframed the verdict column to **"how each can be useful to Rio"** (with ⭐ for
  documented ties) instead of a wall of "unlikely".

**Phase 7 — Export.** "Send it as PDF." Headless Chromium couldn't be installed and every external
host was refused — all by the **environment's egress allowlist** (the true cause of every "403"; see
below), not by any site. So we built a **browser-free** path: `markdown` → HTML → **fpdf2** with the
system **DejaVu** font (landscape A4). That converter is bundled as `scripts/md_table_to_pdf.py`.

## Plot twist: the "403" was never the site
Every "403" across the whole task — the summit pages, the Chromium-download CDN, `apt`, `archive.org`
— turned out to be **this environment's own network egress allowlist**, not a website defense. The
proof came from finally *reading the 403 body*: `Host not in allowlist: sa.unicornsummit.net. Add this
host to your network egress settings to allow access.` — and even `example.com` returned the same
message. A **transparent egress proxy** (allowlist fixed when the environment is created) was refusing
every non-allowlisted host *before the request ever left the sandbox*; only `WebSearch` (Anthropic-side)
and PyPI/GitHub (on the allowlist) worked. **No TLS/browser trick can pass that — it's infrastructure,
not a site.** The fix is to add the host to the egress settings (and start a **new session** for it to
take effect), or have the user paste the content. Hence the hardest-won rule: **read the 403 body
before fighting it** — distinguish your own egress allowlist from a real site WAF.

## The mistakes that shaped the rules
| What went wrong | Rule it produced |
|---|---|
| Workers spawned nested sub-agents → rate-limit storm | **Flat workers only; forbid nesting; small batches** (Phase 2) |
| Invented an abstract "strongest lens" column | **Columns must answer the user's actual question** (Phase 5) |
| "Net worth: not public" in most cells | **Always show a value/proxy + confidence** (Phase 5) |
| Doc opened with 403 / "couldn't research" caveats | **Limitations go in chat, not the artifact** (Phase 6) |
| A "403" we blamed on the site was actually the env's egress allowlist | **Read the 403 body first** — site anti-bot vs. *your own egress allowlist* (config fix + new session) (Phase 1) |
| Negative "unlikely" verdict for most rows | **Be constructive — how each *could* help** (Phase 5) |
| Held results only in context (got summarized) | **Persist a slot scaffold + coverage counter** (Phase 3) |

## The final shape
A reader-first markdown doc that **opens with the table**: `Subject | What it is | Companies &
financial size (always a figure) | How it can help <goal> (⭐ = documented tie)`, backed by
per-subject dossiers and a short "top picks" ranking — exportable to PDF/CSV. The same skeleton works
for vendors × (price/risk/support), papers × (method/result/limitation), startups × (stage/traction/
moat), or any "many subjects → one comparison table" job.

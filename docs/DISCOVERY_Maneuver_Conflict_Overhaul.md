# Discovery: Maneuver & Conflict Logic Overhaul — Reduce Lag, Improve Motion

**Status:** In Progress
**Date Started:** 2026-03-11
**Categories Completed:** 0/9

---

## Pre-Discovery Research (Deep Dive Summary)

> This section captures all findings from the deep code dive performed before questions began.
> It serves as the authoritative technical baseline for this discovery session.

### What the Simulator Does Every Frame

Every tick, for **every active car**, the simulator runs a cost-based motion planner:
1. Generate a list of (speed, steer) candidates
2. For each candidate, project the car forward through the bicycle model
3. Check if that pose is legal (no wall escape, no SAT overlap with other cars)
4. Score every legal candidate
5. Pick the highest-scoring legal candidate

Pipeline: `_chooseLegalMove → _chooseTrafficMove → _chooseBestLegalCandidate`

### Real Performance Numbers (Measured)

| Scenario | Candidates/car | Nearby cars checked | SAT checks/frame (40 cars) |
|----------|---------------|--------------------|-----------------------------|
| Normal mode | ~50 unique (after dedup) | ~6–8 (broad-phase 60px filters ~80%) | ~16,000–20,000 axis checks |
| Maneuver mode | ~100 unique | ~6–8 | ~32,000+ axis checks |
| 4+ maneuver cars active | Mixed | Mixed | up to ~48,000+ axis checks |

- SAT: 4 axes × 8 corners = 32 dot products per pair, with early exit on first separating axis
- Wall checks: O(1) per pose (4 corners only) — **not the bottleneck**
- **No early exit from candidate loop** — all candidates evaluated even after finding a high-scoring legal move

### The Lag Equation

With 4–8 cars stuck in maneuver mode simultaneously (very common at fork):
- Each maneuvering car generates 2× the candidates
- No early-exit from evaluation means all candidates always processed
- Result: framerate drops with 3+ lanes / many cars

**The lag compounds because maneuver triggers too often** — you routinely have 4+ cars in maneuver during normal fork approach instead of 0–1.

### Maneuver Entry Logic (lines 618–666, `traffic_core.js`)

```
noProgressTicks += dt  IF:
  - this.started
  - blockedForProgress  (= blockInfo.kind === 'conflict' OR 'wall' OR trafficMode === 'yield')  ← BUG
  - c._progressDelta < PROGRESS_EPS
  - !c.done

Entry into maneuver IF ALL TRUE:
  - !c.maneuvering
  - blockedForProgress
  - noProgressTicks >= NO_PROGRESS_THRESH (60 ticks)
  - trafficMode !== 'batch'
  - !done
  - !canExitManeuverNow   (_hasLegalForwardProgressMove() returns false)
  - activeManeuverCount < MAX_ACTIVE_MANEUVERS (4)
```

**Root cause of eager trigger:** `blockedForProgress` includes `trafficMode === 'yield'`. Cars in `yield` are patiently
waiting for the batch scheduler — NOT stuck. After 60 ticks of slow fork approach, they enter maneuver unnecessarily.

### Maneuver Exit Logic (lines 693–722, `traffic_core.js`)

```
EXIT PATH A: assignedMode !== 'batch'  AND  canExit   → works ✓
EXIT PATH B: assignedMode === 'hold_exit'  AND  !canExit  → works ✓
DEFAULT:  → stays in maneuver
```

**Root cause of one-car-stuck bug:** The case `assignedMode === 'batch' AND canExit === true` hits the DEFAULT branch
and stays in maneuver forever. Car gets granted its batch turn, has a clear path, but can never exit maneuver.

### The 4-Phase Wobble (lines 833–841)

| Phase | Duration | Speed | Steer | Purpose |
|-------|----------|-------|-------|---------|
| 0 | 12 ticks | -0.6 (reverse) | +perpSteer | Reverse + perp → create lateral gap |
| 1 | 12 ticks | 0.25–0.45 (fwd) | -perpSteer | Forward + opposite → correct angle |
| 2 | 12 ticks | -0.6 (reverse) | -perpSteer | Reverse + opposite → clear other side |
| 3 | 12 ticks | 0.25–0.45 (fwd) | +perpSteer | Forward + perp → consolidate |

`perpSteer` derived from `maneuverPerpDir` (toward road center for cascaded, toward blocker for primary). Max = MAX_ST × 0.8.

### Cascade Behavior (lines 668–690)

Nearby cars pulled into maneuver when:
- Within 80px of a maneuvering car
- Behind it (fwd < 0) AND laterally aligned (|lat| < 20px)
- No legal forward move themselves
- Maneuver count < 4

`maneuverPerpDir` for cascaded cars: always points toward `rd.cx` (road center), ignoring actual blocker position.

### `_hasLegalForwardProgressMove` Called 3× Per Maneuvering Car Per Tick

1. Entry gate check (line 655)
2. Exit condition check (line 696)
3. Cascade neighbor check (line 677)

Each call tests ~12 speed×steer combinations through full SAT legality.
At 4 maneuvering cars: ~144 additional SAT checks per tick from this function alone.

### Candidate Generation — Full Count

**Normal mode:**
- 1 at (desSpd, desSt)
- 6 at scaled speeds (0.85×, 0.7×, 0.55×, 0.4×, 0.25×, 0.1×) with desSt
- 9 target steers × 4 speed scales = 36
- 3 blockerSteer candidates (if blocker exists)
- 1 zero-speed
- **Total: ~47–50 unique candidates**

**Maneuver mode adds:**
- 9 target steers × 3 extra speeds
- 3 reverse magnitudes × 9 target steers
- 2 extreme-steer candidates
- **Total: ~95–110 unique candidates (roughly 2× normal)**

### Batch Scheduler — NOT the Bottleneck

- O(N) per tick — runs once at line 592
- Starvation counters correctly prevent branch monopolization
- EXIT_CLEARANCE = 44px (2 car lengths)
- BATCH_HOLD_TICKS = 24 ticks per grant
- `_downstreamClearance()` recalculated every tick (not cached) — minor

**Primary interaction issue:** `yield` mode (waiting for batch) falsely triggers maneuver entry.

### Dead Code

`forwardIntent` variable (line 618): assigned but never used. Leftover from the original bug described in `DISCOVERY_Maneuver_Mode_Fix.md`.

### Full Bug Summary

| Bug | Location | Severity | Description |
|-----|----------|----------|-------------|
| Yield falsely triggers maneuver | Line 619: `blockedForProgress` includes `yield` | High | Cars waiting for batch turn enter maneuver unnecessarily |
| Batch+canExit = permanently stuck | Lines 697, 715, 720: missing branch | High | Car gets batch turn but can never exit maneuver |
| Dead `forwardIntent` variable | Line 618 | Low | Cleanup only — no behavioral impact |
| No early exit from candidate loop | `_chooseBestLegalCandidate` lines 1391–1399 | Medium | All candidates evaluated even after finding good legal move |
| Maneuver candidate count 2× | `_candidateSet` lines 1318–1327 | Medium | Doubles SAT work for maneuvering cars |
| `_hasLegalForwardProgressMove` 3×/tick | Lines 655, 696, 677 | Medium | ~144 extra SAT checks at 4 maneuver cars |
| Cascade `maneuverPerpDir` ignores blocker | Line 686 | Low | Suboptimal wobble direction for cascaded cars |

---

## 1. Core Requirements ✅ (Approved)

**Summary:** Fix correctness bugs first (yield false trigger + batch+stuck), with framerate improvement and better maneuver behavior as desired outcomes. Success = no permanently stuck cars, fewer false maneuver triggers, visible framerate gain in 3L/20-car browser simulation, and maneuver resolving faster when it does trigger. Paradox tuning and test classification overhaul are explicitly out of scope for this pass.

### Q&A Exchange

**Q1: What is the primary goal of this overhaul?**
> Fix the bugs first — prioritize the two high-severity correctness bugs (yield false trigger, batch+stuck). Lag reduction is a welcome side effect, not the primary driver.

**Tags:** [Core]

**Q2: What does success look like after this overhaul ships?**
> All four criteria:
> 1. Cars stop getting stuck forever (batch+stuck bug never happens; every gridlock that starts resolving finishes)
> 2. Maneuver triggers less often (yield-waiting cars don't enter maneuver)
> 3. Visible framerate improvement in 3L/20-car browser simulation
> 4. When maneuver triggers, it resolves and exits within a reasonable number of ticks

**Tags:** [Core], [Non-Functional], [Testing]

**Q3: What must still hold about the paradox demonstration after this overhaul?**
> Paradox tuning is a separate task. This overhaul is purely mechanical fixes (bugs + performance). The paradox behavior doesn't need to be guaranteed or tuned here — that's tracked separately.

**Tags:** [Core], [Constraints], [Future Plans]

---

## 2. Functional Requirements ✅ (Approved)

**Summary:** 5 changes to `traffic_core.js` and `Ren` class: (1) `NO_PROGRESS_THRESH_YIELD = 270` — yield-blocked cars wait ~4.5 sim-seconds before maneuver safety net triggers; (2) New maneuver exit branch: `batch + canExit` → exit to batch mode + run path re-alignment code (lines 702–713); (3) Early exit from `_chooseBestLegalCandidate` loop; (4) Cache `_hasLegalForwardProgressMove` per car per tick; (5) Visual state indicators in renderer — minimalist, no car color change, each trafficMode gets a distinct indicator (design finalized by reading renderer during implementation). RED tests written first for each fix, human-gated before GREEN.

### Q&A Exchange

**Q1: For the yield false-trigger fix, what should the new rule be?**
> Use a higher threshold specifically for yield-blocked cars — approximately 4.5 simulation seconds. Yield mode takes priority over maneuver mode; maneuver is the safety net for when yield has been waiting unusually long. Cars in yield should NOT enter maneuver quickly; they should wait patiently and only trigger maneuver as a last resort.

**Tags:** [Functional], [Core]

**Q2: What does '4.5 seconds' mean in ticks?**
> ~270 ticks (4.5× the current threshold of 60). If 60 ticks ≈ 1 simulation-second, 270 ticks ≈ 4.5 simulation-seconds.
> Implementation: a separate constant `NO_PROGRESS_THRESH_YIELD = 270` (vs `NO_PROGRESS_THRESH = 60` for conflict/wall).

**Tags:** [Functional], [Non-Functional]

**Q3: For the batch+stuck bug fix — when a maneuvering car gets a batch slot AND has a clear path, what should it do?**
> Take its turn — exit maneuver and proceed as a batch member. The car stops wobbling, transitions to 'batch' mode, and crosses the fork.
> Implementation: add a third exit branch to the maneuver exit logic: `IF assignedMode === 'batch' AND canExit → exit maneuver, set trafficMode = 'batch'`.

**Tags:** [Functional], [Core-BugFix]

**Q4: Which performance improvements are in scope for this overhaul?**
> Two of three:
> 1. **Early exit from candidate loop** — stop evaluating once best-so-far exceeds a threshold
> 2. **Cache `_hasLegalForwardProgressMove` per tick** — compute once per maneuvering car per tick instead of 3×
>
> NOT in scope (deferred): Reduce maneuver candidate count (~100 → ~40). Could affect maneuver quality; tracked in Future Plans.

**Tags:** [Functional], [Non-Functional], [Future Plans]

**Q5: Should we write new test cards for each bug fix?**
> Yes — new cards, autonomously verified RED, human-gated before GREEN.

**Tags:** [Functional], [Testing]

**Q6 (UPDATE — from Testing category): Should visual car-state indicators be in scope?**
> Yes — include in this overhaul. Cars must visually show their trafficMode without changing car fill color.
> **Design principle:** Minimalist and consistent with existing animation patterns (blinking, transparency, conditional borders). Each state needs a distinct indicator. Exact design to be finalized by reading the renderer during implementation.
> States to indicate: yield, batch, hold_exit, maneuver (free and commit can be plain).

> **UPDATE:** This is a new functional requirement added during Category 6. Category 2 summary requires re-approval.

**Tags:** [Functional], [Testing], [Core]
> Yes — write new test cards specifically targeting each fix. Mark them "autonomously verified RED for the right reasons" — meaning the bot runs the test, confirms it fails, and explains WHY it fails (not a fluke). Then human attention is required to confirm the RED is meaningful before implementing GREEN. This approach also helps when we overhaul the full test suite later.

**Tags:** [Functional], [Testing]

---

## 3. Non-Functional Requirements ✅ (Approved)

**Summary:** Target is smooth browser rendering at 3L/40 cars (visual check, no hard FPS number). Maneuver resolution time has no hard limit — "faster than now" is sufficient; exact tuning is future work. The three safety constraints (zero overlap, zero wall escape, single-lane monotonic speed) are non-negotiable hard blockers: any guard test regression rejects the fix unconditionally.

### Q&A Exchange

**Q1: What is the target framerate after this fix?**
> Stretch target: smooth at 3L/40 cars. No hard FPS number — visual impression in the browser is the test. No automated FPS benchmark tool exists.

**Tags:** [Non-Functional], [Testing]

**Q2: How fast should maneuver resolve when it correctly triggers?**
> No hard limit — just faster than now. The test is "did it resolve?" not "how many ticks?" Exact timing is a future tuning concern.

**Tags:** [Non-Functional], [Future Plans]

**Q3: Are the safety constraints (zero overlap, zero wall escape, monotonic branch speed) hard blockers?**
> Yes — hard blockers, no exceptions. If any guard test breaks, the fix is rejected and must be reworked before shipping. There is no waiver path.

**Tags:** [Non-Functional], [Testing], [Constraints]

---

## 4. Constraints & Boundaries ✅ (Approved)

**Summary:** Batch scheduler can be touched if needed. One inviolable architectural rule: bicycle model is the sole position integrator. Tech stack is vanilla JS only, no new dependencies, browser + Node.js compatible. Explicit out-of-scope: candidate count reduction, paradox tuning, test suite classification overhaul.

### Q&A Exchange

**Q1: Is the batch scheduler off the table for changes?**
> No — open to batch scheduler changes if fixing the bugs requires it. The fix can read from or interact with batch scheduler state as needed.

**Tags:** [Constraints], [Functional]

**Q2: What architectural rules must not be violated?**
> One hard rule: bicycle model is the sole position integrator. No direct x/y/th modification outside `_chooseLegalMove`.
> (Note: the two other options — "maneuver candidates must go through planner" and "no new global state between ticks" — are implied good practices but not explicitly called out as hard constraints by the user.)

**Tags:** [Constraints]

**Q3: Are there tech constraints?**
> Vanilla JS only, already the stack. No new dependencies. Tests run via Node.js. All code must be browser-compatible (traffic_core.js runs in both environments).

**Tags:** [Constraints]

---

## 5. Edge Cases & Error Handling ✅ (Approved)

**Summary:** (1) Yield-scheduler deadlock at 270 ticks — accepted risk, tune value later. (2) Wrong early-exit threshold — guard tests are the safety net, no separate metric needed. (3) Maneuver exit must look natural — the new `batch + canExit` exit branch must run the existing path re-alignment code (lines 702–713), not just set trafficMode.

### Q&A Exchange

**Q1: What if a yield car is genuinely stuck (batch scheduler deadlock) at 270 ticks?**
> Accept the risk — 270 ticks is a reasonable safety net. Tuning the value later if edge cases arise. Not worth over-engineering now.

**Tags:** [Edge Cases], [Constraints]

**Q2: What if the early-exit threshold is wrong and good moves get skipped?**
> Guard tests are the safety net. If overlaps or wall escapes appear, the threshold is too aggressive and needs adjustment. No separate metric tracking needed.

**Tags:** [Edge Cases], [Testing]

**Q3: Visual concern: jarring transition when exiting maneuver sooner than before?**
> The transition should look natural — car should re-align to path before accelerating. The existing path re-alignment code (lines 702–713) must run on the new `batch + canExit` exit branch too, not just the existing branches.
> **Important:** The new exit branch for `batch + canExit` must include the path re-snap code from lines 702–713, not just set trafficMode.

**Tags:** [Edge Cases], [Functional]

---

## 6. Testing & Acceptance ✅ (Approved)

**Summary:** TDD first — RED test before every fix, bot verifies failure reason, human confirms, then implement GREEN. 4 new test cards: yield threshold (no maneuver before 270t), batch+stuck direct (exit when batch+pathClear), batch+stuck timeout (no car maneuvering > 300t), forced gridlock (resolves < 300t). All start `diagnostic`, graduate to `guard_green` after multiple clean runs + human confirmation. Existing guards (S, X, AA) are hard blockers after every change. Visual state indicators (new feature, no car color change, minimalist) verified by human in browser.

### Q&A Exchange

**Q1: Yield false-trigger test — what does RED look like?**
> Headless Node.js test. Assert: a yield-mode car does NOT enter maneuver before 270 ticks. Today it enters at 60 ticks → test FAILS (RED). Use card U as the basis scenario.

**Tags:** [Testing], [Functional]

**Q2: Batch+stuck test — what does RED look like?**
> All three test types requested, classified accordingly:
> - Direct condition test: car in maneuver + batch grant + pathClear → assert it exits. TODAY it never exits.
> - Timeout test: no car stays in maneuver > X ticks total. TODAY fails when stuck car exists.
> - Forced-gridlock test: two cars at the fork, assert gridlock resolves within 300 ticks. TODAY fails.

**Tags:** [Testing], [Functional]

**Q3: Test card classification?**
> All new cards start as `diagnostic`. After multiple clean runs + human confirmation, graduate to `guard_green`. No jumping straight to guard.

**Tags:** [Testing]

**Q4: Visual state indicators — scope confirmed?**
> In scope. Minimalist, no car color change, based on existing renderer patterns (blink/transparency/border). Exact design deferred to renderer review during implementation.

**Tags:** [Testing], [Functional]

### Acceptance Criteria Table

| Feature | Test Type | Human Needed? | Initial Class | Done When |
|---------|-----------|---------------|---------------|-----------|
| Yield threshold fix | Headless (Node.js) — assert yield car waits 270t | Before promote to guard | diagnostic → guard_green | Yield car does not enter maneuver at 60t; DOES enter at 270t |
| Batch+stuck fix (direct) | Headless — assert car exits when batch+pathClear | Before promote to guard | diagnostic → guard_green | Car in maneuver with batch grant exits within 1 tick of canExit=true |
| Batch+stuck fix (timeout) | Headless — assert no car stuck > 300t in maneuver | After 3 clean multi-car runs | diagnostic → guard_green | Zero cars remain in maneuver > 300 ticks across all simulations |
| Forced-gridlock resolution | Headless — assert gridlock resolves < 300t | Before promote to guard | diagnostic → guard_green | Fork gridlock (2 opposing cars) always clears |
| Early-exit optimization | Guard tests (existing) — zero overlap, zero wall | Yes — visual browser confirm | diagnostic | Guard tests stay green; browser smoother at 3L/40 cars |
| Cache `_hasLegalForwardProgressMove` | Guard tests (existing) | No | diagnostic | No behavioral change; guard tests pass |
| Visual state indicators | Visual browser check | Yes — human confirms readability | diagnostic | yield/maneuver/batch/hold_exit visually distinguishable in browser |
| Safety guards (all existing) | Headless guard suite: `--id S --id X --id AA` | No (automated) | guard_green (existing) | All guard tests remain green after every change |

### TDD Process for this Project

1. **Write RED test first** — new card in `traffic_test_suite.js`
2. **Bot runs the test and confirms it fails for the RIGHT reason** — explains the failure mechanism
3. **Human confirms the RED is meaningful** — not a fluke, tests the correct behavior
4. **Implement the fix to GREEN**
5. **Re-run the test to confirm GREEN**
6. **Visual browser check** (for behavior-changing fixes)
7. **Classify as `diagnostic`** — monitor for reliability over multiple runs
8. **Graduate to `guard_green`** — after human confirms multiple clean runs

---

## 7. Other / Notes ✅ (Approved)

**Summary:** Remove dead `forwardIntent` variable (line 618) as part of the maneuver entry edit — it's in the same code area and is a safe 1-line cleanup. No other stray notes.

### Q&A Exchange

**Q1: Should dead `forwardIntent` variable be removed?**
> Yes — remove it. We're editing that code area anyway. 1-line change, zero risk.

**Tags:** [Other], [Functional]

---

## 8. Future Plans ✅ (Approved)

**Summary:** Four deferred ideas for the IDEAS doc: (1) Maneuver candidate count reduction (100→40); (2) Paradox tuning to reliably make 1L faster than 2L+; (3) Full test suite classification overhaul (A–Y cards RED→GREEN with human review); (4) Spatial partitioning for SAT broad-phase beyond current 60px broad-phase filter.

### Q&A Exchange

**Q1: Which items belong in the Future Plans IDEAS doc?**
> All four:
> - Maneuver candidate count reduction (100 → 40 focused candidates)
> - Paradox tuning (IDM + batch scheduler tuning to reliably demonstrate Braess's paradox)
> - Test suite classification overhaul (all 25 A–Y cards through proper RED→GREEN with human review; group into guard/diagnostic/known-red)
> - Spatial partitioning for SAT broad-phase (grid cells, future architecture work)

**Tags:** [Future Plans], [Non-Functional], [Testing]

---

## 9. Parallelism Analysis ✅ (Approved)

**Summary:** 4 waves. Wave 1: write all 4 RED tests in parallel. Wave 2: implement fixes (T5+T9 together, T6, T7+T8 parallel), guard tests after each fix. MC-1: confirm all new tests green + guard tests pass before proceeding. Wave 3: read renderer, design and implement visual state indicators. Wave 4: final human visual check at 3L/40-car.

### Q&A Exchange

**Task list (confirmed complete by user):**

| # | Task |
|---|------|
| T1 | Write RED test: yield car doesn't enter maneuver before 270t |
| T2 | Write RED test: batch+stuck car exits when batch+canExit |
| T3 | Write RED test: no car in maneuver > 300t |
| T4 | Write RED test: forced-gridlock resolves < 300t |
| T5 | Implement yield threshold fix (`NO_PROGRESS_THRESH_YIELD = 270`) |
| T6 | Implement batch+stuck fix (new exit branch + path re-alignment) |
| T7 | Implement early-exit optimization in `_chooseBestLegalCandidate` |
| T8 | Implement `_hasLegalForwardProgressMove` per-tick cache |
| T9 | Remove dead `forwardIntent` variable (line 618) — done with T5 |
| T10 | Read renderer, design and implement visual state indicators |
| T11 | Run guard tests after each fix (S, X, AA) |
| T12 | Final visual browser check: 3L/40-car smooth + state indicators readable |

**Wave Structure:**

```
📦 Wave 1 — Write RED tests (T1, T2, T3, T4 in parallel)
   Human gate: confirm each RED fails for the right reason

📦 Wave 2 — Implement fixes
   T5 + T9 (together, lines 618-666)
   T6 (lines 693-722, separate area)
   T7 + T8 (parallel, different methods)
   T11 runs after EACH fix, not batched

🔵 MC-1: All new tests green + guard tests pass before touching renderer

📦 Wave 3 — Visual state indicators (T10: read renderer → design → implement)

📦 Wave 4 — Final human visual check (T12)
```

**Dependency graph:**
```
T1 ──► T5+T9 ──► T11
T2 ──► T6    ──► T11
T3 ──►
T4 ──► (standalone scenario, T11 after)
T7 ──► T11
T8 ──► T11
             All T11s pass ──► MC-1 ──► T10 ──► T12
```

**Tags:** [Parallelism]

---

## Reliability Evidence

### Gap Matrix

| Capability | Intended behavior | Actual implementation | Observed artifact evidence | Verdict |
|------------|-------------------|-----------------------|----------------------------|---------|
| Maneuver entry trigger | Only enter maneuver when truly gridlocked | Enters on yield mode too (line 619) | No run artifacts — code-read only | Bug confirmed in code, unverified in run |
| Maneuver exit (batch case) | Exit maneuver when batch granted + path clear | No branch handles this case (lines 697–720) | No run artifacts — code-read only | Bug confirmed in code, unverified in run |
| Candidate evaluation | Select best legal move efficiently | Evaluates ALL candidates, no early exit | No run artifacts | Design gap confirmed in code |
| `_hasLegalForwardProgressMove` cost | Called once per tick for entry only | Called 3× per maneuvering car per tick | No run artifacts | Confirmed in code |

### Live-Proof Status

- No test run artifacts available yet — all analysis is static code-read
- `run_traffic_suite.js` exists and can produce headless output for specific cards
- Browser visual tests exist in `red_visual_tests.html` — many cards are red
- No automated performance benchmarks exist — framerate is browser-observed only

### Tool Inventory

**Required and proven:**
- `node run_traffic_suite.js --id [card]` — headless CLI test runner (confirmed in README)
- `red_visual_tests.html` — browser visual dashboard (confirmed in README)
- `traffic_test_suite.js` — 25 shared test cards A–Y (confirmed in codebase)

**Required but missing/unproven:**
- Performance benchmark: no tool exists to measure candidates/frame, SAT ops/frame, or FPS
- Maneuver trigger count test: no card specifically tests "yield cars do NOT enter maneuver"
- Batch+stuck car test: no card tests the batch+canExit stuck case
- Forced-gridlock test: user mentioned this idea — no card exists yet

**Deferred:**
- Spatial partitioning (grid cells) for SAT broad-phase — future architecture work
- Test classification overhaul (A–Y cards into guard/known-red/diagnostic groups)

### Unresolved Evidence Risks

1. **Eager trigger severity unknown:** We know yield triggers maneuver, but don't know how often in a 3L/20-car run. Need a maneuver entry rate metric.
2. **Stuck car reproducibility unknown:** The batch+stuck bug is confirmed in code but not confirmed reproducible in a specific test scenario.
3. **Performance baseline unavailable:** No FPS measurement tool. Can't confirm lag is reduced after fixes without a benchmark.
4. **Test card pass/fail state unknown:** Many A–Y cards may be red; running them fresh required before trusting verdicts.

---

## Connection Map

| Answer | Affects Categories | Notes |
|--------|-------------------|-------|
| Yield threshold = 270 ticks (separate constant `NO_PROGRESS_THRESH_YIELD`) | Functional, Non-Functional, Testing | New constant needs a test proving yield cars DON'T trigger at 60t but DO at 270t |
| Batch+stuck fix: exit to batch mode, run path re-alignment code | Functional, Edge Cases | New exit branch must include lines 702–713 (path snap), not just trafficMode change |
| Performance: early exit + cache only (not candidate count reduction) | Functional, Non-Functional, Future Plans | Candidate count reduction deferred; guard tests are safety net for early-exit threshold |
| Visual state indicators: minimalist, no car color change, design TBD from renderer | Functional, Testing, Non-Functional | Revokes Cat 2 approval; new feature added; exact design requires renderer review |
| RED test as first priority; use cards O and U as basis | Testing, Functional | Tests must be written BEFORE implementation; card U basis for yield test; card O shows yield-too-much |
| Safety constraints are hard blockers (no exceptions) | Non-Functional, Testing, Constraints | Guard tests (zero overlap, zero wall escape, monotonic speed) are ship-blockers |
| Yield fix → batch-partner progress tracking (not time threshold) | Functional, Testing, Non-Functional | Revises plan F1-T2: instead of NO_PROGRESS_THRESH_YIELD=270, check if batch cars are making progress. Only accumulate yield car's noProgressTicks when batch partners are ALSO stuck |
| Convoy scenario (10+1 customCase) guarantees long yield window | Testing, Functional | Deterministic setup using existing customCase API. No new function needed. Left-lane car at y=430 ahead of right-lane car at y=650 → batch priority established |
| Test B: all 3 assertions required + failure must specify which one | Testing | verdict() returns pass only if: (1) crossing car done, (2) all convoy cars done, (3) crossing car was last. metrics() shows which assertion failed |

---

## Completeness Score

*To be calculated when all categories have Q&A.*

---

## Addendum — 2026-03-12: Yield Test Scenario Design

**Context:** Card AC was written testing `noProgressTicks > 0` for yield cars with `blockingKind='none'`. This tests approach 1 (remove yield from blockedForProgress). User confirmed approach 2 is correct: yield DOES accumulate toward the maneuver threshold — the fix is `NO_PROGRESS_THRESH_YIELD = 270`. Card AC must be redesigned to test maneuver ENTRY timing, not accumulation. This addendum captures the specific scenario design needed to make yield reliably testable.

### Fix Approach — Confirmed

**User confirmation (2026-03-12):** Keep `yield` in `blockedForProgress`. The fix is a higher threshold for yield cars: `NO_PROGRESS_THRESH_YIELD = 270`. Yield cars accumulate `noProgressTicks` normally but need 270 ticks (vs 60 for conflict/wall) before maneuver fires.

**Impact on card AC:** Card AC must be redesigned. Current version tests accumulation (which approach 2 doesn't fix). New version must test: *yield car does NOT enter maneuver before 270 ticks, even when accumulating*.

### New Test Scenario — Deterministic Yield Forcing

**Scenario described (2026-03-12):**
- 2 lanes
- 1 car on the **right lane** wants to go LEFT (cross-lane car)
- 10 cars on the **left lane** all want to go RIGHT (same-lane cars)
- One left-lane car starts **ahead** of the right-lane car → gets batch priority
- All following left-lane cars inherit that priority (batch convoy behavior)
- Right-lane car must yield to all 10 left-lane cars → guaranteed long yield window

**Why this guarantees yield:** The right-lane car cannot enter the fork while the left-lane batch convoy holds priority. With 10 cars in the convoy, the yield window spans multiple batch cycles. This creates the conditions needed to test:
- **Test A (card AC redesign):** Right-lane car accumulates noProgressTicks in yield mode, but does NOT enter maneuver before 270t
- **Test B (new card):** Right-lane car eventually crosses to left when it gets its batch turn; all 10 left-lane cars complete without crossing (they stay in their lane)

### Scenario Setup (Confirmed)

Use `customCase` with explicit car positions — already supported by existing test infrastructure. No new function needed. Format: `{id, lane, target, y}`.

```
Lane 0 (left): 10 cars, target="right", y=430..700 (30px apart, first one closest to fork)
Lane 1 (right):  1 car, target="left",  y=650 (behind the front left-lane car)
```

Left-lane car at y=430 reaches fork first → batch priority → all 10 convoy cars follow → right-lane car must yield.

### Fix Approach — REVISED (user clarification 2026-03-12)

**Original approach (plan F1-T2):** `NO_PROGRESS_THRESH_YIELD = 270` — time-based threshold, still accumulates, just slower.

**Revised approach (user clarification):** Track whether the cars the yield car is waiting for are making progress.

> "We need to begin tracking, for as long as a driver needs to keep yielding, whether one of the vehicles it yielded to succeeded. If none are able to, it may enter maneuver mode."

**New rule:** A yield car may enter maneuver ONLY IF the cars currently holding batch priority are ALSO stuck (none of them have made progress). If any batch car is moving → yield car stays in yield.

**Why this is better:**
- Time threshold (270t) fails if convoy is 10 cars (~300t → car hits threshold even though convoy was successfully progressing)
- Progress check never fires maneuver during a healthy batch convoy (cars are moving → stay in yield)
- Fires correctly for true deadlock: batch cars stuck AND yield car stuck → both enter maneuver

**Implementation sketch:** In the `noProgressTicks` accumulation block (line 619), when `trafficMode === 'yield'`, check if ANY car in the currently-active batch branch has `noProgressTicks < NO_PROGRESS_THRESH`. If yes → do NOT increment yield car's `noProgressTicks` (the cars it yielded to are succeeding). If no → allow accumulation (possible deadlock → safety net fires at 60t threshold).

### Test A — Card AC Redesign

**Scenario:** 10 left-lane cars (convoy) + 1 right-lane car (yield car)
**Assertion:** Right-lane car does NOT enter maneuver while ANY left-lane convoy car is making progress through the fork
**With bug:** Right-lane car enters maneuver at ~60t (convoy is progressing, but yield condition alone drives accumulation) → FAIL (RED)
**With fix:** Right-lane car stays in yield entire time (convoy is progressing) → PASS (GREEN)
**maxTicks:** ~500 (enough for 10 cars × ~30t each + margins)

### Test B — New Card

**Scenario:** Same 10+1 setup
**Three assertions (all required; metrics show which fails):**
1. Right-lane car (`car.target === 'left'`) finishes (`car.done`) — the crossing car crossed
2. All 10 left-lane cars (`car.target === 'right'`) finish — the convoy cars completed without crossing
3. Right-lane car was the LAST to finish (convoy had priority, crossed first)
**With bug:** Either maneuver disrupts the convoy, or crossing car gets stuck permanently → assertion 1 or 3 may fail
**With fix:** All assertions pass — clean priority and clean crossing
**maxTicks:** ~600 (generous budget for full 10-car convoy + crossing car)

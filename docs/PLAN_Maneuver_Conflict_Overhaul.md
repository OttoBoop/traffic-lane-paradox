# Traffic Lane Paradox — Maneuver & Conflict Overhaul

**Generated:** 2026-03-11
**Status:** In Progress
**Discovery:** [DISCOVERY_Maneuver_Conflict_Overhaul.md](DISCOVERY_Maneuver_Conflict_Overhaul.md)

---

## 1. Executive Summary

Fix two high-severity correctness bugs in the maneuver system (yield-mode false trigger + batch+stuck permanent deadlock), add two performance optimizations (candidate-loop early exit + per-tick cache), and add minimalist visual state indicators. These are mechanical fixes — no paradox tuning, no architecture overhaul.

---

## 2. Requirements Summary

### 2.1 Problem Statement

Two bugs make the maneuver system unreliable:
1. **Yield false trigger (High):** `blockedForProgress` on line 619 includes `trafficMode === 'yield'`. Cars patiently waiting for the batch scheduler enter maneuver mode after just 60 ticks (~1 sim-second). This floods the fork with 4–8 maneuvering cars simultaneously, doubling their candidate count and causing visible framerate drops.
2. **Batch+stuck permanent deadlock (High):** The maneuver exit logic (lines 693–722) has no branch for `assignedMode === 'batch' AND canExit === true`. The car hits the default branch and stays in maneuver forever — even after the batch scheduler grants it a turn and its path is clear.

Two performance issues compound the lag:
3. **No early exit from candidate loop:** `_chooseBestLegalCandidate` evaluates all ~50–100 candidates per car per tick even after finding a high-scoring legal move.
4. **`_hasLegalForwardProgressMove` called 3× per maneuvering car per tick** (entry gate, exit check, cascade check) — ~144 extra SAT checks per tick at 4 maneuver cars.

### 2.2 Target Users

Educational showcase audience — observing the traffic paradox demonstration in a browser. Smooth animation and readable car states are necessary for the demonstration to be legible.

### 2.3 Success Criteria

- [ ] No car ever gets permanently stuck in maneuver mode (batch+stuck bug never fires)
- [ ] Yield-mode cars do not enter maneuver before 270 ticks (4.5 sim-seconds)
- [ ] 3L/40-car simulation visibly smoother in browser after fixes (no hard FPS target)
- [ ] When maneuver correctly triggers, it resolves and the car exits within a reasonable run
- [ ] All existing guard tests (S, X, AA) remain green after every change
- [ ] yield/batch/hold_exit/maneuver states are visually distinguishable in browser without changing car fill colors

### 2.4 Explicitly Out of Scope

- Paradox tuning (IDM/batch scheduler calibration to reliably demonstrate Braess's paradox)
- Maneuver candidate count reduction (100 → 40) — risk to maneuver quality, deferred
- Test suite classification overhaul (A–Y cards through proper RED→GREEN cycle) — separate project
- Spatial partitioning for SAT broad-phase — future architecture work
- Any change to the bicycle model or its invocation order

### 2.5 Evidence of Readiness

- [ ] `node run_traffic_suite.js --id [new-yield-card]` passes (GREEN)
- [ ] `node run_traffic_suite.js --id [new-batch-direct-card]` passes (GREEN)
- [ ] `node run_traffic_suite.js --id [new-batch-timeout-card]` passes (GREEN)
- [ ] `node run_traffic_suite.js --id [new-gridlock-card]` passes (GREEN)
- [ ] `node run_traffic_suite.js --id S --id X --id AA` all GREEN after every fix
- [ ] Human visual confirmation: 3L/40-car browser run is smoother
- [ ] Human visual confirmation: state indicators readable in browser

---

## 3. Technical Architecture

### 3.1 System Overview

All changes are confined to two files:
- `traffic_core.js` — simulation engine (bugs + performance fixes)
- `traffic_core.js` `Ren` class — renderer (visual state indicators)
- `traffic_test_suite.js` — test card registry (new RED cards)

No new files. No new dependencies.

### 3.2 Data Flow

```
Per tick (every active car):
  _updateBatchScheduler()                 ← reads/writes trafficMode
  _tickStep() — maneuver entry/exit       ← BUG FIXES HERE (lines 618-722)
    noProgressTicks accumulation          ← yield threshold fix (F1-T2)
    maneuver entry gate
    maneuver exit gate                    ← batch+stuck fix (F2-T4)
    cascade neighbor pull-in
  _chooseLegalMove()
    _chooseTrafficMove()
      _chooseBestLegalCandidate()         ← early exit fix (F3-T1)
        _isLegalPose() × N candidates
        _hasLegalForwardProgressMove()    ← cache fix (F3-T2)
  bicycle model (sole position integrator)

Render (each frame):
  Ren._drawCar()                          ← visual state indicators (F4-T1, F4-T2)
```

### 3.3 Technology Decisions

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Simulation engine | Vanilla JS | Existing stack — no change |
| Tests | Node.js CLI (`run_traffic_suite.js`) | Headless, fast, existing tooling |
| Visual verification | Browser (`red_visual_tests.html`) | Cannot automate framerate or visual quality |
| State indicators | Canvas 2D API | Already used by Ren class |

### 3.4 Integration Points

- `traffic_test_suite.js` exports card registry consumed by both `run_traffic_suite.js` (Node.js) and `red_visual_tests.html` (browser). New cards go in `traffic_test_suite.js` only.
- `traffic_core.js` is imported by `traffic_v18.html` (browser) and by `run_traffic_suite.js` (Node.js via `require()`). All changes must be compatible with both environments.

### 3.5 Output and Failure Contracts

| Artifact or State | Owner | Proof Required | Blocked If |
|-------------------|-------|----------------|------------|
| RED test — yield threshold | `traffic_test_suite.js` (new card) | `node run_traffic_suite.js --id [card]` fails; bot explains WHY (yield car enters maneuver at 60t) | Human has not confirmed RED is meaningful |
| RED test — batch+stuck direct | `traffic_test_suite.js` (new card) | CLI fails; bot explains WHY (car never exits maneuver after batch grant) | Human has not confirmed |
| RED test — batch timeout | `traffic_test_suite.js` (new card) | CLI fails; bot explains WHY (car stuck > 300t) | Human has not confirmed |
| RED test — forced gridlock | `traffic_test_suite.js` (new card) | CLI fails; bot explains WHY (fork deadlock doesn't clear in 300t) | Human has not confirmed |
| Yield threshold fix GREEN | `traffic_core.js` lines 618-666 | All 4 new tests pass + guard tests S/X/AA green | Any guard test fails → reject fix |
| Batch+stuck fix GREEN | `traffic_core.js` lines 693-722 | All 4 new tests pass + guard tests S/X/AA green | Any guard test fails → reject fix |
| Performance fixes GREEN | `traffic_core.js` lines 1391-1413 | Guard tests S/X/AA green; no behavioral change | Guard regression → reject |
| Visual state indicators | `Ren` class in `traffic_core.js` | Human confirms readability in browser | Cannot automate |

---

## 4. Feature Breakdown

---

### Feature 1: Yield False-Trigger Fix

**User Story:** As a viewer of the simulation, I want yield-mode cars to wait patiently for the batch scheduler without entering maneuver mode, so that maneuver mode only fires when cars are genuinely gridlocked.

**Acceptance Criteria:**
- [ ] A yield-mode car does NOT enter maneuver while any car in the active batch branch is making progress
- [ ] A yield-mode car DOES enter maneuver as a safety net when the batch cars it is waiting for are ALSO stuck (within 60t of all batch cars stopping progress — true deadlock)
- [ ] 10+1 convoy scenario: crossing car completes after convoy; all 10 convoy cars complete without crossing; crossing car was last to finish
- [ ] All existing guard tests (S, X, AA) remain green after this change
- [ ] Dead `forwardIntent` variable is removed from line 618

**Technical Details (REVISED 2026-03-12):**

Previous approach (`NO_PROGRESS_THRESH_YIELD = 270`) was replaced by batch-partner progress tracking:

- In the `noProgressTicks` accumulation block (lines 618-666): when `trafficMode === 'yield'`, check whether any car with `trafficMode === 'batch'` (the cars currently holding priority) has `noProgressTicks < NO_PROGRESS_THRESH`
  - **If yes (batch cars progressing):** suppress yield car's `noProgressTicks` accumulation — the cars it is yielding to are moving, not stuck
  - **If no (all batch cars also stuck):** allow accumulation at normal rate — possible deadlock; safety net fires at 60t (`NO_PROGRESS_THRESH`)
- Remove the `forwardIntent` variable assignment on line 618 (assigned but never used)

**Why this is better than the 270-tick threshold:** A 10-car convoy takes ~300 ticks to clear, which would have hit the 270t threshold even when everything is working correctly. The batch-partner check ties maneuver entry to actual deadlock — not elapsed time.

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F1-T1 | Redesign card AC — 10+1 convoy `customCase`, assert yield car does NOT enter maneuver while any convoy car is progressing | None | No | S | 🔄 |
| F1-T1b | Write Test B card — 3 assertions: (1) crossing car finishes, (2) all convoy cars finish, (3) crossing car was last; metrics show which failed | None | No | S | ⬜ |
| F1-T2 | Implement batch-partner progress tracking in `noProgressTicks` accumulation (lines 618-666); remove dead `forwardIntent` | F1-T1, F1-T1b (human confirms both RED) | No | M | ⬜ |
| F1-T3 | Verify F1-T1 and F1-T1b turn GREEN; run guard tests `--id S --id X --id AA` | F1-T2 | No | S | ⬜ |

**Current State of F1-T1 (card AC):** Card exists in `traffic_test_suite.js` with id="AC". Current version tests `noProgressTicks > 0` for yield cars with `blockingKind='none'` — correct RED for the OLD approach. Must be REPLACED with the 10+1 convoy scenario.

**Tests Required (write BEFORE implementation):**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Yield car doesn't enter maneuver while convoy progresses | Headless Node.js (card AC) | Yes — confirm RED before implementing | RED: car enters maneuver despite convoy moving (bug present). GREEN: no maneuver fires during convoy pass | `node run_traffic_suite.js --id AC` FAIL→PASS |
| Crossing car completes, convoy complete, crossing car was last | Headless Node.js (new Test B card) | Yes — confirm RED before implementing | RED: crossing car stuck or crossing car finishes before convoy (bug present). GREEN: all 3 assertions pass | `node run_traffic_suite.js --id [TestB]` FAIL→PASS |
| Guard tests unaffected | Headless Node.js | No | `--id S --id X --id AA` all GREEN | CLI output all PASS |

---

### Feature 2: Batch+Stuck Bug Fix

**User Story:** As a viewer of the simulation, I want gridlocks to always resolve once they start clearing, so no car gets permanently stuck in maneuver mode.

**Acceptance Criteria:**
- [ ] A car in maneuver mode that receives a batch grant AND has a clear forward path exits maneuver within 1 tick
- [ ] No car remains in maneuver mode for more than 300 ticks
- [ ] A deliberately forced fork gridlock (2 opposing cars) resolves within 300 ticks
- [ ] The exit transition looks natural — path re-alignment code (lines 702-713) runs on the new exit branch
- [ ] All existing guard tests (S, X, AA) remain green after this change

**Technical Details:**
- Add a third exit branch to maneuver exit logic (lines 693-722):
  `IF assignedMode === 'batch' AND canExit → run path re-alignment (lines 702-713) → set trafficMode = 'batch'`
- Must include path re-snap code from lines 702-713 (same as existing exit paths), not just set `trafficMode`

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F2-T1 | Write RED test: car in maneuver + batch grant + pathClear → assert it exits within 1 tick | None | No | S | ⬜ |
| F2-T2 | Write RED test: no car stays in maneuver > 300t total across a 3L/20-car run | None | No | M | ⬜ |
| F2-T3 | Write RED test: forced-gridlock (2 opposing cars at fork) resolves within 300 ticks | None | No | M | ⬜ |
| F2-T4 | Implement batch+stuck fix: add third exit branch (batch+canExit) including path re-alignment (lines 693-722, incorporating 702-713) | F2-T1, F2-T2, F2-T3 (human confirms all RED) | No | M | ⬜ |
| F2-T5 | Verify F2-T1, F2-T2, F2-T3 turn GREEN; run guard tests `--id S --id X --id AA` | F2-T4 | No | S | ⬜ |

**Tests Required (write BEFORE implementation):**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Car with batch grant exits maneuver in 1 tick | Headless Node.js (diagnostic) | Yes — confirm RED before implementing | PASS: car exits within 1 tick of canExit=true with assignedMode=batch | CLI output |
| No car stuck in maneuver > 300t | Headless Node.js (diagnostic) | Yes — after 3 clean runs to graduate | PASS: zero cars remain in maneuver > 300t | CLI output |
| Fork gridlock resolves < 300t | Headless Node.js (diagnostic) | Yes — confirm RED before implementing | PASS: deadlock clears | CLI output |
| Guard tests unaffected | Headless Node.js (guard_green) | No | `--id S --id X --id AA` all GREEN | CLI output all PASS |

---

### Feature 3: Performance Optimizations

**User Story:** As a viewer of the simulation, I want the 3L/40-car simulation to run smoothly in the browser so the paradox demonstration is legible.

**Acceptance Criteria:**
- [ ] `_chooseBestLegalCandidate` stops evaluating candidates once best-so-far score exceeds a threshold
- [ ] `_hasLegalForwardProgressMove` is called at most once per maneuvering car per tick (result cached per tick)
- [ ] No behavioral changes — guard tests (S, X, AA) remain green
- [ ] Browser 3L/40-car simulation visibly smoother (human visual confirmation)

**Technical Details:**
- **Early exit (T7):** In `_chooseBestLegalCandidate` (lines 1388-1413), after scoring a legal candidate, if `bestScore > EARLY_EXIT_THRESHOLD`, break. Threshold must be calibrated so it never cuts a valid move — guard tests are the safety net.
- **Cache (T8):** Before the per-tick maneuver section, compute `_hasLegalForwardProgressMove(c)` once and store as a local variable. Replace the 3 call sites (lines 655, 677, 696) with the cached value.

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F3-T1 | Implement early exit from `_chooseBestLegalCandidate` loop (lines 1388-1413): break when bestScore > threshold | None (parallel with F3-T2) | Yes — human confirms browser smoother | S | ✅ |
| F3-T2 | Implement `_hasLegalForwardProgressMove` per-tick cache: compute once, replace 3 call sites (lines 655, 677, 696) | None (parallel with F3-T1) | No | S | ✅ |
| F3-T3 | Run guard tests `--id S --id X --id AA`; human visual check 3L/40-car in browser | F3-T1, F3-T2 | Yes | S | ⬜ |

**Tests Required (write BEFORE implementation):**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| No behavioral regression from early exit | Existing guard tests (headless) | No — automated | Guard tests S/X/AA all GREEN | CLI output |
| No behavioral regression from caching | Existing guard tests (headless) | No — automated | Guard tests S/X/AA all GREEN | CLI output |
| Framerate visibly improved | Browser visual check (3L/40-car) | Yes — human confirms | "Smoother than before" — subjective but necessary | Human confirmation |

---

### Merge Checkpoint: MC-1

**Gate:** All new tests pass (GREEN) AND guard tests S, X, AA all pass.

Do not touch the renderer (`Ren` class) until MC-1 is clear.

**Blocked If:** Any new test card is still RED, or any guard test (S, X, AA) is failing.

---

### Feature 4: Visual State Indicators

**User Story:** As a viewer of the simulation, I want to see at a glance which trafficMode each car is in, so I can understand what the maneuver system is doing without reading logs.

**Acceptance Criteria:**
- [ ] Cars in `yield`, `batch`, `hold_exit`, and `maneuver` modes show distinct visual indicators
- [ ] `free` and `commit` cars have no special indicator (plain appearance)
- [ ] No car fill color is changed — indicators use minimalist overlays only (blink, transparency, conditional borders)
- [ ] Design is consistent with existing animation patterns in the `Ren` class
- [ ] Human confirms readability in browser: all 4 active states distinguishable at a glance

**Technical Details:**
- Read the `Ren` class renderer code in `traffic_core.js` before designing indicators
- Design principle: use existing canvas animation primitives (opacity cycling for blink, strokeStyle for borders, globalAlpha for transparency)
- States to indicate: `yield`, `batch`, `hold_exit`, `maneuver` (free and commit are plain)
- Exact indicator shapes, colors, and animations are to be decided AFTER reading the renderer — not specified here

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F4-T1 | Read `Ren` class renderer code; design indicator scheme (document in code comment or brief doc note) | MC-1 | No | S | ⬜ |
| F4-T2 | Implement visual state indicators in `Ren._drawCar()` (or equivalent render method) | F4-T1 | Yes — human visual check | M | ⬜ |
| F4-T3 | Human visual browser check: 3L/40-car simulation runs smooth AND state indicators are readable for all 4 active modes | F4-T2 | Yes | S | ⬜ |

**Tests Required (write BEFORE implementation):**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Renderer doesn't crash with new indicators | Syntax check + basic 2L/10-car run | No — headless guard tests cover it | Guard tests still pass | CLI output |
| States are visually distinguishable | Browser visual check | Yes — mandatory | Human confirms yield/batch/hold_exit/maneuver each look distinct | Human confirmation |
| No car fill color changed | Browser visual check | Yes — combined with above | Same colors as before for car bodies | Human confirmation |

---

## 5. Test Strategy

### 5.1 Testing Pyramid

- **Headless (Node.js) tests:** Primary verification for all behavioral fixes. 4 new diagnostic cards in `traffic_test_suite.js`. Run with `node run_traffic_suite.js --id [card]`.
- **Guard tests (existing):** Run after every implementation task. Hard blockers — any failure rejects the fix. `node run_traffic_suite.js --id S --id X --id AA`.
- **Browser visual tests:** Human-in-loop for framerate improvement and visual state indicators. Not automatable.

### 5.2 TDD Checklist (Per Task)

```
For EACH implementation task, BEFORE writing implementation:
1. [ ] Write failing test (new card in traffic_test_suite.js, OR rely on existing guards for perf tasks)
2. [ ] Run the test: node run_traffic_suite.js --id [card]
3. [ ] Confirm it fails for the RIGHT reason (bot explains WHY — not a fluke)
4. [ ] Human confirms RED is meaningful before proceeding to GREEN
5. [ ] Write MINIMUM code to pass the test
6. [ ] Re-run test: confirm GREEN
7. [ ] Run guard tests: --id S --id X --id AA must all pass
8. [ ] Classify new card as `diagnostic` (never jump to guard_green immediately)
9. [ ] Graduate to `guard_green` only after human confirms multiple clean runs
```

### 5.3 Testing Commands

```bash
# Run a single card
node run_traffic_suite.js --id [card-id]

# Run guard suite
node run_traffic_suite.js --id S --id X --id AA

# Run all cards
node run_traffic_suite.js

# Visual dashboard (browser)
open red_visual_tests.html
```

---

## 6. Dependency & Parallelism Analysis

### 6.1 Task Dependency Graph

```
F1-T1 ──────────────────────────► F1-T2 ──► F1-T3 ──┐
                                                       │
F2-T1 ──┐                                             │
F2-T2 ──┼──────────────────────► F2-T4 ──► F2-T5 ──┤
F2-T3 ──┘                                             │
                                                       ├──► MC-1 ──► F4-T1 ──► F4-T2 ──► F4-T3
F3-T1 ──┐                                             │
F3-T2 ──┘──────────────────────────────► F3-T3 ──────┘
```

### 6.2 Parallelism Reasoning

| Task Group | Tasks | Parallel? | Rationale |
|------------|-------|-----------|-----------|
| **Wave 1 — RED tests** | F1-T1, F2-T1, F2-T2, F2-T3 | Yes | All write new test cards in `traffic_test_suite.js`; cards are independent entries in the registry; no shared state |
| **Wave 2a — Yield fix** | F1-T2 | Sequential after F1-T1 | Requires human to confirm F1-T1 RED first |
| **Wave 2b — Batch fix** | F2-T4 | Sequential after F2-T1/T2/T3 | Requires human to confirm all 3 REDs first |
| **Wave 2c — Perf fixes** | F3-T1, F3-T2 | Yes (parallel) | Independent methods in `traffic_core.js`; F3-T1 touches `_chooseBestLegalCandidate`, F3-T2 touches call sites of `_hasLegalForwardProgressMove` — no overlap |
| **Wave 2 guard verification** | F1-T3, F2-T5, F3-T3 | After respective fixes | Each verifies its own fix + guards |
| **MC-1** | Gate | Sequential | Waits for all Wave 2 verification to complete |
| **Wave 3 — Visual indicators** | F4-T1, F4-T2, F4-T3 | Sequential | Design must precede implementation; implementation must precede visual check |

### 6.3 Task Dependency Table

| Task | Description | Depends On | Unblocks | Status |
|------|-------------|------------|----------|--------|
| F1-T1 | Redesign card AC — 10+1 convoy scenario, assert no maneuver while convoy progresses | None | F1-T2 | 🔄 |
| F1-T1b | Write Test B card — crossing car completion + convoy completion + priority order | None | F1-T2 | ⬜ |
| F2-T1 | Write RED test: batch+stuck car exits when batch+canExit | None | F2-T4 | ⬜ |
| F2-T2 | Write RED test: no car in maneuver > 300t | None | F2-T4 | ⬜ |
| F2-T3 | Write RED test: forced-gridlock resolves < 300t | None | F2-T4 | ⬜ |
| F3-T1 | Implement early exit from `_chooseBestLegalCandidate` | None | F3-T3 | ✅ |
| F3-T2 | Implement `_hasLegalForwardProgressMove` per-tick cache | None | F3-T3 | ✅ |
| F1-T2 | Implement batch-partner progress tracking + remove forwardIntent (lines 618-666) | F1-T1, F1-T1b (human confirmed both RED) | F1-T3 | ⬜ |
| F2-T4 | Implement batch+stuck fix: new exit branch + path re-alignment (lines 693-722) | F2-T1, F2-T2, F2-T3 (human confirmed RED) | F2-T5 | ⬜ |
| F1-T3 | Verify F1-T1 + F1-T1b GREEN + guard tests S/X/AA | F1-T2 | MC-1 | ⬜ |
| F2-T5 | Verify F2-T1/T2/T3 GREEN + guard tests S/X/AA | F2-T4 | MC-1 | ⬜ |
| F3-T3 | Guard tests S/X/AA + human visual browser check | F3-T1, F3-T2 | MC-1 | ⬜ |
| MC-1 | ⊕ All new tests GREEN + guard tests S/X/AA all pass | F1-T3, F2-T5, F3-T3 | F4-T1 | ⬜ |
| F4-T1 | Read `Ren` class renderer; design visual state indicator scheme | MC-1 | F4-T2 | ⬜ |
| F4-T2 | Implement visual state indicators in renderer | F4-T1 | F4-T3 | ⬜ |
| F4-T3 | Human visual browser check: 3L/40-car smooth + indicators readable | F4-T2 | — | ⬜ |

---

## 7. Implementation Phases

### Phase 1: Write RED Tests (Wave 1 — Parallel)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| A | F1-T1, F2-T1, F2-T2, F2-T3 | Yes | Independent test cards, no shared state |

- [ ] **F1-T1:** Redesign card AC — 10+1 convoy `customCase` (lane 0: 10 cars going right y=430..700, lane 1: 1 car going left y=650). Assert: yield car does NOT enter maneuver while any convoy car is still progressing
- [ ] **F1-T1b:** Write Test B card — same 10+1 setup. Three assertions: (1) crossing car finishes (`target=left, done=true`), (2) all 10 convoy cars finish, (3) crossing car was last to finish (verify batch priority respected)
- [ ] **F2-T1:** Write RED card — batch+stuck direct (car in maneuver + batch grant + pathClear → exits within 1 tick)
- [ ] **F2-T2:** Write RED card — no car in maneuver > 300t total
- [ ] **F2-T3:** Write RED card — forced-gridlock (2 opposing cars at fork) resolves < 300t

**Human gate after Phase 1:** Confirm each RED test fails for the right reason before proceeding to Phase 2.

---

### Phase 2: Implement Fixes (Wave 2 — Mixed)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| B1 | F1-T2 | Sequential (after human confirms F1-T1) | Modifies lines 618-666 |
| B2 | F2-T4 | Sequential (after human confirms F2-T1/T2/T3) | Modifies lines 693-722 |
| B3 | F3-T1, F3-T2 | Yes (parallel) | Independent methods in same file |

Run guard tests after EACH batch (not batched at the end):
- After B1: run `--id S --id X --id AA` → F1-T3
- After B2: run `--id S --id X --id AA` → F2-T5
- After B3: run `--id S --id X --id AA` + human visual check → F3-T3

**Key implementation notes:**
- **F1-T2:** Implement batch-partner progress tracking. In `noProgressTicks` accumulation (lines 618-666): when `trafficMode === 'yield'`, check if any active batch car (`trafficMode === 'batch'`) has `noProgressTicks < NO_PROGRESS_THRESH`. If yes → suppress yield car's accumulation (batch progressing). If no → allow accumulation (safety net fires at 60t). Delete the `forwardIntent` assignment on line 618.
- **F2-T4:** Add third exit branch: `else if (assignedMode === 'batch' && canExit) { [copy path re-alignment from lines 702-713]; c.trafficMode = 'batch'; c.maneuvering = false; }`. Must include all state resets that the existing exit branches perform.
- **F3-T1:** Add `const EARLY_EXIT_SCORE = 0.9` (or calibrated value). In `_chooseBestLegalCandidate` after updating `bestScore`, add: `if (bestScore >= EARLY_EXIT_SCORE) break;`. Guard tests validate the threshold is safe.
- **F3-T2:** Before the three call sites of `_hasLegalForwardProgressMove`, compute once: `const hasForwardMove = c.maneuvering ? this._hasLegalForwardProgressMove(c) : false;`. Replace all three call sites with `hasForwardMove`.

---

### Phase 3: Merge Checkpoint MC-1

**Verify:**
1. `node run_traffic_suite.js --id [F1-new-card]` — PASS
2. `node run_traffic_suite.js --id [F2-batch-direct-card]` — PASS
3. `node run_traffic_suite.js --id [F2-timeout-card]` — PASS
4. `node run_traffic_suite.js --id [F2-gridlock-card]` — PASS
5. `node run_traffic_suite.js --id S --id X --id AA` — all PASS

Only when all 5 checks pass: proceed to Phase 4.

---

### Phase 4: Visual State Indicators (Wave 3 — Sequential)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| C | F4-T1 → F4-T2 → F4-T3 | Sequential | Design before code; code before human check |

- [ ] **F4-T1:** Read `Ren` class renderer code (identify existing animation primitives: opacity cycling, strokeStyle, globalAlpha). Determine distinct indicator for each of the 4 active states. Document the design in a comment in the code.
- [ ] **F4-T2:** Implement indicators in `Ren._drawCar()`. States: `yield` (indicator A), `batch` (indicator B), `hold_exit` (indicator C), `maneuver` (indicator D). No car fill color changes.
- [ ] **F4-T3:** Human opens browser, runs 3L/40-car simulation, confirms all 4 states are readable and animation is smoother than before.

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| Early exit threshold too aggressive — valid moves skipped | Medium | High — could cause overlaps or wall escapes | Guard tests (S, X, AA) immediately detect this; lower threshold if guards fail |
| Per-tick cache has wrong scope — stale value used across sub-steps | Low | High — wrong legality decisions | Verify cache is per-car-per-tick, not across ticks; guard tests as safety net |
| Batch+stuck fix missing state reset — car partially exits maneuver | Medium | Medium — visible jerk or stuck state | Copy ALL state resets from existing exit branches (lines 702-713), not just `trafficMode` |
| yield 270-tick safety net never fires in typical runs | Low | Low — safety net just may not trigger | Acceptable risk; documented in edge cases |
| Visual indicators conflict with existing rendering in `rioSatellite` theme | Medium | Low — cosmetic only | Test both `classic` and `rioSatellite` themes during F4-T3 |

---

## 9. Open Questions

- [ ] What is the right `EARLY_EXIT_SCORE` threshold? Needs calibration — start at 0.9 and adjust if guards fail.
- [ ] For F3-T2 cache: is the cache scoped per car per tick, or per car per sub-step (when dt subdivision fires)? Need to verify the tick subdivision loop in `_tickStep` to ensure correct scope.
- [ ] Card IDs for new test cards: will be assigned sequentially after Z (current last card is Y). Confirm the card registry format in `traffic_test_suite.js` before writing F1-T1.

---

## 10. Approval Checklist

- [ ] Requirements reviewed by: _____________ Date: _________
- [ ] Architecture reviewed by: _____________ Date: _________
- [ ] Plan approved by: _____________ Date: _________

---

## 11. Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-03-11 | Initial plan created from DISCOVERY_Maneuver_Conflict_Overhaul.md | Claude Sonnet 4.6 |
| 2026-03-12 | Feature 1 revised: fix approach changed from `NO_PROGRESS_THRESH_YIELD=270` to batch-partner progress tracking. Card AC redesigned with 10+1 convoy `customCase`. New task F1-T1b (Test B card: crossing + convoy completion). Status → In Progress. | Claude Sonnet 4.6 |
| 2026-03-12 | F3-T1 and F3-T2 marked ✅ — early exit (EARLY_EXIT_SCORE=0.9) and per-tick cache implemented; guard tests S/X/AA all GREEN. | Claude Sonnet 4.6 |

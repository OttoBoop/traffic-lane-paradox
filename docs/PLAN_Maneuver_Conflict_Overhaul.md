# Traffic Lane Paradox — Maneuver & Conflict Overhaul + Performance Extension

**Generated:** 2026-03-11
**Updated:** 2026-03-13
**Status:** In Progress
**Discovery:** [DISCOVERY_Maneuver_Conflict_Overhaul.md](DISCOVERY_Maneuver_Conflict_Overhaul.md)

---

## ⚠️ Pre-existing Guard Failure (Baseline 2026-03-13)

**Card AH ("Concurrent maneuver cap") is currently failing** — times out at 200s.

- **Why:** 3L/40-car sim at maxTicks=12000 with stepsPerFrame=20 exceeds the runner timeout. The sim cannot finish because each tick takes ~30ms (6.5s/200 ticks headless), making 12000 ticks take ~30 minutes.
- **Root cause:** The same performance bottleneck this plan addresses.
- **Impact on MC-1:** AH is added to the guard suite requirement. MC-1 is blocked until AH passes.
- **Expected resolution:** AH will pass after P1-P4 (Performance Wave 1 + fast path) reduce tick time sufficiently.

---

## 1. Executive Summary

Fix two high-severity correctness bugs in the maneuver system (yield-mode false trigger + batch+stuck permanent deadlock), add comprehensive performance optimizations (5 new + 2 existing), add minimalist visual state indicators, and lay the groundwork for a two-phase architecture rewrite. The performance work targets the core bottleneck: `_isLegalPoseNeighbors` at 142K calls / 19.3s per 200 ticks (74% of wall time), making the simulation consume 97% of the browser's frame budget before a single pixel is rendered.

---

## 2. Requirements Summary

### 2.1 Problem Statement

Two bugs make the maneuver system unreliable:
1. **Yield false trigger (High):** `blockedForProgress` on line 619 includes `trafficMode === 'yield'`. Cars patiently waiting for the batch scheduler enter maneuver mode after just 60 ticks (~1 sim-second). This floods the fork with 4–8 maneuvering cars simultaneously, doubling their candidate count and causing visible framerate drops.
2. **Batch+stuck permanent deadlock (High):** The maneuver exit logic (lines 693–722) has no branch for `assignedMode === 'batch' AND canExit === true`. The car hits the default branch and stays in maneuver forever — even after the batch scheduler grants it a turn and its path is clear.

Five performance issues compound the lag:
3. **`_isLegalPoseNeighbors` called 142K times per 200 ticks** (74% of wall time) — no caching, redundant calls, redundant broad-phase checks
4. **No early exit from candidate loop** — evaluates all ~50–100 candidates even after finding a high-scoring legal move *(F3-T1: done)*
5. **`_hasLegalForwardProgressMove` called 3× per maneuvering car per tick** — ~144 extra SAT checks per tick at 4 maneuver cars *(F3-T2: done)*
6. **Redundant neighbor lookups** — `_relevantLegalNeighbors` called 2-3× per car per tick with identical inputs
7. **All cars run full candidate evaluation** — even free-driving cars with no conflicts generate and SAT-check 23 candidates when their desired move is almost always legal

### 2.2 Target Users

Educational showcase audience — observing the traffic paradox demonstration in a browser. Smooth animation and readable car states are necessary for the demonstration to be legible.

### 2.3 Success Criteria

- [ ] No car ever gets permanently stuck in maneuver mode (batch+stuck bug never fires)
- [ ] Yield-mode cars do not enter maneuver while any batch car is progressing
- [ ] 3L/40-car simulation visibly smoother in browser (no hard FPS target — maximize improvement)
- [ ] Card AH ("Concurrent maneuver cap") passes — no longer times out
- [ ] When maneuver correctly triggers, it resolves and the car exits within a reasonable run
- [ ] All existing guard tests (S, X, AA, AH) remain green after every change
- [ ] yield/batch/hold_exit/maneuver states are visually distinguishable in browser without changing car fill colors
- [ ] Profiler records before/after deltas for `_isLegalPoseNeighbors` calls and wall time

### 2.4 Explicitly Out of Scope

- Paradox tuning (IDM/batch scheduler calibration to reliably demonstrate Braess's paradox)
- Maneuver-mode candidate count reduction (100 → 40) — risk to maneuver quality, deferred
- Traffic-mode fast path (yield/batch/maneuver) — extend after proving nominal-mode fast path works
- Test suite classification overhaul (A–Y cards through proper RED→GREEN cycle) — separate project
- Spatial partitioning for SAT broad-phase — future architecture work
- Any change to the bicycle model or its invocation order
- Two-phase tick rewrite — planned but no tasks yet (see Section 11)

### 2.5 Evidence of Readiness

- [ ] `node run_traffic_suite.js --id AC` PASS (yield convoy test)
- [ ] `node run_traffic_suite.js --id AP` PASS (convoy clearance timing)
- [ ] `node run_traffic_suite.js --id AQ` PASS (batch+stuck direct exit)
- [ ] `node run_traffic_suite.js --id AR` PASS (no car in maneuver > 300t)
- [ ] `node run_traffic_suite.js --id AS` PASS (forced gridlock resolves)
- [ ] `node run_traffic_suite.js --id S --id X --id AA --id AH` all PASS
- [ ] `node profile_planner_hotspots.js` shows improved call counts and wall time vs baseline
- [ ] Human visual confirmation: 3L/40-car browser run is smoother than pre-optimization baseline
- [ ] Human visual confirmation: state indicators readable in browser

---

## 3. Technical Architecture

### 3.1 System Overview

All changes are confined to two files:
- `traffic_core.js` — simulation engine (bugs + all performance fixes + visual indicators)
- `traffic_test_suite.js` — test card registry (new diagnostic cards)

No new files. No new dependencies.

### 3.2 Data Flow

```
Per tick (every active car):
  _updateBatchScheduler()                 ← reads/writes trafficMode
  _tickStep() — maneuver entry/exit       ← BUG FIXES HERE (lines 618-722)
    noProgressTicks accumulation          ← yield fix: batch-partner tracking (F1: done)
    maneuver entry gate
    maneuver exit gate                    ← batch+stuck fix (F2-T4)
    cascade neighbor pull-in
  Stanley controller                      ← computes desSt (lane centering)
  IDM + cone detection                    ← computes desSpd (following speed)
  _chooseLegalMove()
    [NEW] fast-path shortcut (P4)         ← try (desSpd, desSt) directly; skip if legal
    _chooseTrafficMove() [fallback]
      _chooseBestLegalCandidate()         ← early exit fix (F3-T1: done)
        [IMPROVED] neighbor cache (P1)    ← compute _relevantLegalNeighbors once per car
        [IMPROVED] SAT cache (P3)         ← pre-computed car corners at tick start
        [IMPROVED] no redundant broad-phase (P2)
        _isLegalPose() × N candidates     ← N reduced by P5 (normal mode)
        _hasLegalForwardProgressMove()    ← cache fix (F3-T2: done)
  bicycle model (sole position integrator)

Render (each frame):
  Ren._drawCar()                          ← visual state indicators (F4-T1, F4-T2)
```

### 3.3 Technology Decisions

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Simulation engine | Vanilla JS | Existing stack — no change |
| Tests | Node.js CLI (`run_traffic_suite.js`) | Headless, fast, existing tooling |
| Performance profiling | `profile_planner_hotspots.js` (extended) | Already instruments key methods |
| Visual verification | Browser (`red_visual_tests.html`) | Cannot automate framerate or visual quality |
| State indicators | Canvas 2D API | Already used by Ren class |

### 3.4 Integration Points

- `traffic_test_suite.js` exports card registry consumed by both `run_traffic_suite.js` (Node.js) and `red_visual_tests.html` (browser). New cards go in `traffic_test_suite.js` only.
- `traffic_core.js` is imported by `traffic_v18.html` (browser) and by `run_traffic_suite.js` (Node.js via `require()`). All changes must be compatible with both environments.
- `profile_planner_hotspots.js` instruments `Sim.prototype` methods for performance measurement.

### 3.5 Output and Failure Contracts

| Artifact or State | Owner | Proof Required | Blocked If |
|-------------------|-------|----------------|------------|
| RED test — batch+stuck (AQ/AR/AS) | `traffic_test_suite.js` | ✅ Cards exist and fail | Human has not confirmed RED is meaningful (F2-T4 blocked) |
| Yield threshold fix GREEN | `traffic_core.js` lines 618-666 | AC + AP pass + guards green | ✅ Done |
| Batch+stuck fix GREEN | `traffic_core.js` lines 693-722 | AQ/AR/AS pass + guards green | Guards S/X/AA/AH all green |
| Performance fixes GREEN (F3) | `traffic_core.js` | Guards green | ✅ F3-T1/T2 done; F3-T3 pending |
| Neighbor cache (P1) | `traffic_core.js` | Guards green + profiler delta | Any guard fails |
| Broad-phase removal (P2) | `traffic_core.js` | Guards green | Any guard fails |
| SAT cache (P3) | `traffic_core.js` | Guards green + profiler delta | Any guard fails |
| Fast-path shortcut (P4) | `traffic_core.js` | Guards green + fast-path hit rate > 0 | AH still timing out |
| Profiler extension (P6) | `profile_planner_hotspots.js` | `node profile_planner_hotspots.js` shows fast-path counter | P4 not implemented |
| Candidate reduction (P5) | `traffic_core.js` | Guards green + merge test (P7) | Any guard fails |
| Merge-scenario test (P7) | `traffic_test_suite.js` | Test passes | P4 not implemented |
| Visual state indicators | `Ren` class | Human confirms readability | Cannot automate |

---

## 4. Feature Breakdown

---

### Feature 1: Yield False-Trigger Fix ✅ COMPLETE

**User Story:** As a viewer of the simulation, I want yield-mode cars to wait patiently for the batch scheduler without entering maneuver mode, so that maneuver mode only fires when cars are genuinely gridlocked.

**Acceptance Criteria:**
- [x] A yield-mode car does NOT enter maneuver while any car in the active batch branch is making progress
- [x] 10+1 convoy scenario: crossing car completes after convoy; all 10 convoy cars complete without crossing; crossing car was last to finish
- [x] All existing guard tests (S, X, AA) remain green after this change
- [x] Dead `forwardIntent` variable removed from line 618

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F1-T1 | Redesign card AC — 10+1 convoy `customCase` | None | No | S | ✅ |
| F1-T1b | Write Test B card (AP) — convoy completion + 30s clearance | None | No | S | ✅ |
| F1-T2 | Implement batch-partner progress tracking + remove forwardIntent | F1-T1, F1-T1b | No | M | ✅ |
| F1-T3 | Verify AC + AP GREEN; guard tests S/X/AA | F1-T2 | No | S | ✅ |

---

### Feature 2: Batch+Stuck Bug Fix

**User Story:** As a viewer of the simulation, I want gridlocks to always resolve once they start clearing, so no car gets permanently stuck in maneuver mode.

**Acceptance Criteria:**
- [ ] A car in maneuver mode that receives a batch grant AND has a clear forward path exits maneuver within 1 tick
- [ ] No car remains in maneuver mode for more than 300 ticks
- [ ] A deliberately forced fork gridlock (2 opposing cars) resolves within 300 ticks
- [ ] The exit transition looks natural — path re-alignment code (lines 702-713) runs on the new exit branch
- [ ] All existing guard tests (S, X, AA, AH) remain green after this change

**Technical Details:**
- Add a third exit branch to maneuver exit logic (lines 693-722):
  `IF assignedMode === 'batch' AND canExit → run path re-alignment (lines 702-713) → set trafficMode = 'batch'`
- Must include path re-snap code from lines 702-713 (same as existing exit paths), not just set `trafficMode`

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F2-T1 | ~~Write RED test: batch+stuck direct~~ → Card AQ exists and fails | None | No | S | ✅ |
| F2-T2 | ~~Write RED test: maneuver > 300t~~ → Card AR exists and fails | None | No | M | ✅ |
| F2-T3 | ~~Write RED test: forced-gridlock~~ → Card AS exists and fails | None | No | M | ✅ |
| F2-T4 | Implement batch+stuck fix: add third exit branch + path re-alignment (lines 693-722) | F2-T1, F2-T2, F2-T3 (human confirms RED) | No | M | ✅ |
| F2-T5 | Verify AQ/AR/AS GREEN; run guard tests S/X/AA/AH | F2-T4 | No | S | ✅ |
| F2-T6 | Fix same-target yield delay: add `c.target !== zone.activeBatchTarget` to `_assignBatchStates` yield condition (line ~1352). Write card AX (customCase: 3 cars, deterministic). | F2-T5 | No | S | ✅ |

**Note on F2-T1/T2/T3:** Cards AQ, AR, AS were already written. They are failing for the correct reason (batch+stuck bug exists). Human confirmation of RED meaning required before F2-T4.

**Note on F2-T6:** Discovered via user's browser screenshots — middle-lane car with clear same-branch path froze at fork while batch ran for its own target. Root cause: `_assignBatchStates` yielded ALL non-batch near-fork cars when `activeBatchId !== null`, regardless of target match. Same-branch paths never cross (line 370 skips same-branch pairs), so yielding same-target cars is unnecessary. Test card AX uses a `customCase` with specific car placements that deterministically triggers the bug (car 2 on 1-left, 15px behind batch member, too close to trail/share). Guard suite 18/19 (AH pre-existing), diagnostics AQ/AR/AS all pass.

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Car with batch grant exits maneuver in 1 tick | Headless Node.js (card AQ) | Yes — confirm RED before F2-T4 | PASS: car exits within 1 tick of canExit=true with assignedMode=batch | `--id AQ` FAIL→PASS |
| No car stuck in maneuver > 300t | Headless Node.js (card AR) | Yes — confirm RED before F2-T4 | PASS: zero cars remain in maneuver > 300t | `--id AR` FAIL→PASS |
| Fork gridlock resolves < 300t | Headless Node.js (card AS) | Yes — confirm RED before F2-T4 | PASS: deadlock clears | `--id AS` FAIL→PASS |
| Same-target car must not yield when batch is for its target | Headless Node.js (card AX) | No | PASS: 0 same-target yield ticks, all cars done, legal | `--id AX` FAIL→PASS |
| Guard tests unaffected | Headless Node.js (guard) | No | S/X/AA/AH all PASS | CLI output all PASS |

---

### Feature 3: Performance Optimizations (Early Exit + Cache) — Partially Done

**User Story:** As a viewer of the simulation, I want the 3L/40-car simulation to run smoothly in the browser so the paradox demonstration is legible.

**Acceptance Criteria:**
- [x] `_chooseBestLegalCandidate` stops evaluating once best-so-far score exceeds EARLY_EXIT_SCORE=0.9
- [x] `_hasLegalForwardProgressMove` is called at most once per maneuvering car per tick (result cached)
- [ ] Browser 3L/40-car simulation visibly smoother (human visual confirmation — requires F5/F6 also done)
- [ ] All guard tests (S, X, AA, AH) green — **AH currently failing due to perf**

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F3-T1 | Implement early exit from `_chooseBestLegalCandidate` | None | No | S | ✅ |
| F3-T2 | Implement `_hasLegalForwardProgressMove` per-tick cache | None | No | S | ✅ |
| F3-T3 | Guard tests S/X/AA/AH + human visual check | F3-T1, F3-T2, **F5, F6** | Yes | S | ⬜ |

**Note:** F3-T3 is moved after F5+F6 because AH requires performance improvements to pass.

---

### Feature 4: Visual State Indicators

**User Story:** As a viewer of the simulation, I want to see at a glance which trafficMode each car is in.

**Acceptance Criteria:**
- [ ] Cars in `yield`, `batch`, `hold_exit`, and `maneuver` modes show distinct visual indicators
- [ ] `free` and `commit` cars have no special indicator (plain appearance)
- [ ] No car fill color is changed
- [ ] Design is consistent with existing `Ren` class animation patterns
- [ ] Human confirms readability in browser

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F4-T1 | Read `Ren` class renderer; design indicator scheme | MC-1 | No | S | ⬜ |
| F4-T2 | Implement visual state indicators in `Ren._drawCar()` | F4-T1 | Yes — human visual check | M | ⬜ |
| F4-T3 | Human visual browser check: smooth + indicators readable | F4-T2 | Yes | S | ⬜ |

---

### Merge Checkpoint: MC-1

**Gate:** F2 complete (AQ/AR/AS GREEN) AND F3/F5/F6 complete (AH GREEN) AND guard tests S/X/AA/AH all pass.

**Do not touch the renderer (`Ren` class) until MC-1 is clear.**

**Blocked If:** Any of AQ, AR, AS still RED. Or AH still timing out. Or S/X/AA failing.

---

### Feature 5: Performance Wave 1 — Zero-Behavior-Change Caches

**User Story:** As a viewer of the simulation, I want the simulation engine to reuse computed values within a tick instead of recomputing them repeatedly, so the frame budget has headroom for rendering.

**Acceptance Criteria:**
- [ ] `_relevantLegalNeighbors` computed at most once per car per tick (cached as `c._cachedNeighbors`, cleared at tick start)
- [ ] `_poseOverlapsCarsNeighbors` no longer re-checks broad-phase distance on already-filtered neighbors
- [ ] Each active car's trig values (cos/sin/corners) pre-computed once per tick (cached as `c._tickCorners`, cleared at tick start)
- [ ] All guard tests (S, X, AA, AH) remain green
- [ ] `profile_planner_hotspots.js` shows reduced `_isLegalPoseNeighbors` time vs baseline

**Technical Details:**

**P1 — Neighbor caching:**
- Add `c._cachedNeighbors = null` to car state initialization
- At tick start (before `_chooseLegalMove` loop), clear `c._cachedNeighbors = null` for all active cars
- In `_relevantLegalNeighbors(c, active, extraRange)`: if `c._cachedNeighbors` exists, return it. Otherwise compute and store in `c._cachedNeighbors`
- Call sites at lines 1371, 1494, 1511 automatically benefit
- Note: `extraRange=30` is always 30 at all call sites — no parameter mismatch risk

**P2 — Redundant broad-phase removal:**
- In `_poseOverlapsCarsNeighbors` (lines 1310-1317): remove the `dx*dx + dy*dy > PROJ_BROAD_PHASE_SQ` check
- Neighbors were already filtered to `PROJ_BROAD_PHASE + 30` range in `_relevantLegalNeighbors`. Candidate poses are small movements — they stay within range
- This removes 1 multiply + 1 compare per SAT-checked pair (minor but zero-risk)

**P3 — SAT trig caching:**
- At tick start, for each active car: `c._tickCorners = carCorners(c.x, c.y, c.th, 0)` (4 pre-computed corners, no margin)
- Modify `satOverlapMargin` signature: add optional `bCornersPrecomputed` parameter
- When `_poseOverlapsCarsNeighbors` calls `satOverlapMargin` for neighbor `o`, pass `o._tickCorners` to skip recomputing neighbor's corners
- Candidate pose (car `c`) still computes corners fresh (its pose changes per candidate)
- Behavior: bit-identical results — same corners, same dot products, same SAT outcome

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| P1 | Implement neighbor cache: `c._cachedNeighbors`, clear at tick start, use in `_relevantLegalNeighbors` | None | No | S | ✅ |
| P2 | Remove redundant broad-phase check in `_poseOverlapsCarsNeighbors` (lines 1310-1317) | None | No | S | ✅ |
| P3 | Implement SAT trig cache: pre-compute `c._tickCos/Sin` at tick start, use in `_poseOverlapsCarsNeighbors` | None | No | M | ✅ |
| P5-guard | Run guard tests S/X/AA/AH after P1+P2+P3; run profiler and record delta | P1, P2, P3 | Yes — human #1 | S | ✅ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| No behavioral regression from caching | Existing guards (headless) | No — automated | S/X/AA green | CLI output |
| AH no longer times out | Guard AH (headless) | No | AH PASS within timeout | CLI output |
| Performance improved | `profile_planner_hotspots.js` | Yes — Checkpoint #1 | `_isLegalPoseNeighbors` calls and time reduced vs baseline | Profiler stdout |

---

### Feature 6: Performance Wave 2 — Fast-Path Shortcut

**User Story:** As a viewer of the simulation, I want free-driving cars (no conflict) to skip candidate evaluation entirely, so the planner only runs full evaluation when actually needed.

**Acceptance Criteria:**
- [ ] Cars in `nominal` plannerMode try `(desSpd, desSt)` directly before candidate generation
- [ ] If the desired move is legal (no SAT overlap, no wall escape), it is accepted immediately — no candidate generation, no scoring
- [ ] If the desired move is illegal, falls through to `_chooseBestLegalCandidate` unchanged
- [ ] Lane centering quality unchanged — the fast path accepts the pure Stanley output
- [ ] Merge safety preserved — SAT check catches overlap with merging cars; cone detection already reduces speed anticipatorily
- [ ] All guard tests (S, X, AA, AH) remain green
- [ ] `profile_planner_hotspots.js` shows fast-path hit rate > 0 and further `_isLegalPoseNeighbors` reduction

**Technical Details:**

**P4 — Fast-path shortcut:**
- In `_chooseLegalMove(c, dt, rd, active)` (line 1578), BEFORE the `nominal`/`traffic` mode split:
  ```
  if (c.plannerMode === 'nominal') {
    const fastPose = this._candidatePose(c, c.desSpd, c.desSt, dt);
    const neighbors = this._getCachedNeighbors(c, active);  // uses P1
    if (!this._isLegalPoseNeighbors(c, fastPose, rd, neighbors)) {
      // fast path failed — fall through to full planner
    } else {
      return { x: fastPose.x, y: fastPose.y, th: fastPose.th, speed: c.desSpd, steer: c.desSt };
    }
  }
  ```
- `trafficMode` cars (yield/batch/maneuver/hold_exit) always use full planner
- Fast path uses cached neighbors from P1 — only 1 SAT check instead of ~23

**P6 — Profiler extension:**
- Add `fastPathHit` and `fastPathMiss` counters to `profile_planner_hotspots.js`
- Instrument `_chooseLegalMove` to count hits (fast path accepted) vs misses (fell through)
- Report hit rate: `fastPathHit / (fastPathHit + fastPathMiss) * 100`%

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F3-T3 | Guard tests S/X/AA/AH — baseline verification after F3+F5 | P5-guard | No | S | 🔄 AH still failing |
| P4 | Implement fast-path shortcut in `_chooseLegalMove` (nominal mode, before candidate generation) | F3-T3 | No | M | ✅ |
| P6 | Extend `profile_planner_hotspots.js` with fast-path hit/miss counters | P4 | No | S | ⬜ |
| P6-verify | Run profiler; record fast-path hit rate + wall time delta | P6 | Yes — human #2 | S | ⬜ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Fast path actually taken (not always falling through) | `profile_planner_hotspots.js` extension | Yes — Checkpoint #2 | Hit rate > 50% in 3L/40-car run | Profiler stdout |
| No behavioral regression | Guard tests S/X/AA/AH | No | All guards PASS | CLI output |
| Lane centering preserved | Guard + browser visual | Yes — Checkpoint #2 | Cars stay centered; no lane drift | Browser observation |
| Merge anticipation preserved | Guard tests + merge test P7 | No (automated) | Guards green; P7 PASS | CLI + card output |

---

### Feature 7: Performance Wave 3 — Candidate Reduction + Merge Test

**User Story:** As a viewer of the simulation, I want normal-mode candidate generation to be leaner, so fewer SAT checks run even when the fast path falls through.

**Acceptance Criteria:**
- [ ] Normal-mode (non-maneuver) candidate count reduced from ~23 to ~12 by removing near-duplicate and low-value candidates
- [ ] Maneuver-mode candidate set unchanged
- [ ] A merge-scenario test (P7) passes — verifies anticipatory braking works with fast path active
- [ ] All guard tests (S, X, AA, AH) remain green

**Technical Details:**

**P5 — Normal-mode candidate reduction:**
The current `_candidateSet` for normal mode generates:
- 1 desired (desSpd, desSt)
- 6 speed scales (0.85×–0.1×) with desSt → **keep top 3** (0.85×, 0.55×, 0.25×)
- 9 target steers × 4 speed scales = 36 → **keep 5 steers × 2 scales = 10**
- 3 blockerSteer candidates → **keep 2** (0.4×, 0.25×)
- 1 zero-speed → **keep**

Target: ~16 normal-mode candidates (down from ~23). Maneuver mode still generates full ~100 candidates.

Guard tests are the safety net — if any overlap or wall escape appears, the reduction was too aggressive.

**P7 — Merge-scenario test card:**
- 2 lanes, 3 cars: Car A (left lane) drives normally; Car B (right lane) performs MOBIL merge into left lane 2 ticks before Car C (behind Car A in left lane) would normally reach Car A's position
- Assert: Car C slows anticipatorily during the merge (speed reduction detected before overlap)
- Assert: No SAT overlap at any tick
- Classify: `diagnostic`

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| P7 | Write merge-scenario test card — verifies anticipatory braking with fast path | P6-verify | No | M | ✅ |
| P5 | Reduce normal-mode candidate set in `_candidateSet` (lines 1393-1441) | P7 | No | M | ✅ |
| P7-verify | Run P7 card + full guard suite; profiler final baseline | P5 | Yes — human #3 | S | ✅ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Merge anticipatory braking preserved | Card P7 (diagnostic headless) | Yes — Checkpoint #3 | PASS: speed reduction detected before overlap, zero SAT overlaps | `--id P7` PASS |
| No behavioral regression from candidate reduction | Guard tests S/X/AA/AH | No | All guards PASS | CLI output |
| Candidate count reduced | `profile_planner_hotspots.js` | Yes — Checkpoint #3 | avg candidates < 18 (down from 23) | Profiler stdout |

---

### Merge Checkpoint: MC-2

**Gate:** F5, F6, F7 all complete AND guard tests S/X/AA/AH all pass AND profiler shows measurable improvement AND fast-path hit rate > 0.

**Blocked If:** AH still failing. Any guard regression. Fast-path hit rate = 0 (fast path never taken).

---

### Feature 8: Two-Phase Architecture (Design Only — No Implementation Tasks)

This is the next major initiative after MC-2. No implementation tasks in this plan. Design notes:

**Current architecture problem:** Sequential commit — Car A moves, then Car B calculates based on A's new position. This means high-priority cars monopolize the conflict resolution at every tick.

**Target architecture:** Parallel intent + conflict resolution:
1. All cars calculate their desired move independently (ignoring each other)
2. Compare proposed moves for conflicts
3. Only conflicting cars engage yield/maneuver
4. Cache choices — don't redo unless new conflicts arise

**Open design question:** Conflict resolution priority mechanism (batch scheduler vs distance-based vs first-come). Needs dedicated discovery before any implementation.

---

## 5. Test Strategy

### 5.1 Testing Pyramid

- **Headless (Node.js) tests:** Primary verification for all behavioral fixes. New diagnostic cards in `traffic_test_suite.js`. Run with `node run_traffic_suite.js --id [card]`.
- **Guard tests (existing + AH):** Run after every implementation task. Hard blockers — any failure rejects the fix. `node run_traffic_suite.js --id S --id X --id AA --id AH`.
- **Performance profiler:** `node profile_planner_hotspots.js` at each checkpoint — records call counts and wall time.
- **Browser visual tests:** Human-in-loop for framerate improvement and visual state indicators.

### 5.2 TDD Checklist (Per Task)

```
For EACH implementation task, BEFORE writing implementation:
1. [ ] Write failing test (new card in traffic_test_suite.js, OR rely on existing guards for perf tasks)
2. [ ] Run the test: node run_traffic_suite.js --id [card]
3. [ ] Confirm it fails for the RIGHT reason (explain WHY — not a fluke)
4. [ ] Human confirms RED is meaningful before proceeding to GREEN
5. [ ] Write MINIMUM code to pass the test
6. [ ] Re-run test: confirm GREEN
7. [ ] Run guard tests: --id S --id X --id AA --id AH must all pass
8. [ ] Classify new card as `diagnostic` (never jump to guard_green immediately)
9. [ ] Graduate to `guard_green` only after human confirms multiple clean runs
```

### 5.3 Testing Commands

```bash
# Run a single card
node run_traffic_suite.js --id [card-id]

# Run core guard suite (add AH)
node run_traffic_suite.js --id S --id X --id AA --id AH

# Run all cards
node run_traffic_suite.js

# Run performance profiler (baseline + after each wave)
node profile_planner_hotspots.js

# Visual dashboard (browser)
open red_visual_tests.html
```

---

## 6. Dependency & Parallelism Analysis

### 6.1 Task Dependency Graph

```
F2-T1 (AQ ✅) ─┐
F2-T2 (AR ✅) ─┼─► F2-T4 ─► F2-T5 ─────────────────────────────────┐
F2-T3 (AS ✅) ─┘                                                     │
                                                                      │
P1 ─────────────┐                                                     │
P2 ─────────────┼─► P5-guard ─► F3-T3 ─► P4 ─► P6 ─► P6-verify ─► │
P3 ─────────────┘                                                     │
                                                                      ├─► MC-1 ─► F4-T1 ─► F4-T2 ─► F4-T3
P6-verify ─► P7 ─► P5 ─► P7-verify ──────────────────────────────► │
                                                                      │
                                                          MC-2 ──────►┘
```

### 6.2 Parallelism Reasoning

| Task Group | Tasks | Parallel? | Rationale |
|------------|-------|-----------|-----------|
| **F2 RED gate** | F2-T1, F2-T2, F2-T3 | ✅ Done | Were written independently |
| **F2 implementation** | F2-T4 | Sequential after RED | Requires human confirms RED |
| **Perf Wave 1** | P1, P2, P3 | Yes | Independent cache layers, different methods |
| **Fast path** | P4 | Sequential after P5-guard | Needs guards green + P1 (neighbor cache) |
| **Profiler** | P6 | Sequential after P4 | Needs fast-path code to exist |
| **Wave 3** | P7 + P5 | Sequential (P7 then P5) | P7 tests fast-path behavior; P5 may affect P7 result |
| **Visual indicators** | F4-T1→F4-T2→F4-T3 | Sequential | Design → code → review |

### 6.3 Task Dependency Table

> **Source of truth for `/tdd` workflow.**

| Task | Description | Depends On | Unblocks | Status |
|------|-------------|------------|----------|--------|
| F1-T1 | Card AC — 10+1 convoy test | None | F1-T2 | ✅ |
| F1-T1b | Card AP — convoy clearance | None | F1-T2 | ✅ |
| F1-T2 | Batch-partner progress tracking | F1-T1, F1-T1b | F1-T3 | ✅ |
| F1-T3 | Verify AC/AP GREEN + guards S/X/AA | F1-T2 | MC-1 (partial) | ✅ |
| F2-T1 | Card AQ — batch+stuck direct exit (exists, failing) | None | F2-T4 | ✅ |
| F2-T2 | Card AR — no maneuver > 300t (exists, failing) | None | F2-T4 | ✅ |
| F2-T3 | Card AS — forced gridlock (exists, failing) | None | F2-T4 | ✅ |
| F2-T4 | Implement batch+stuck fix (lines 693-722) | F2-T1, F2-T2, F2-T3 | F2-T5 | ✅ |
| F2-T5 | Verify AQ/AR/AS GREEN + guards S/X/AA/AH | F2-T4 | F2-T6, MC-1 (partial) | ✅ |
| F2-T6 | Same-target yield fix + card AX (customCase) | F2-T5 | MC-1 (partial) | ✅ |
| F3-T1 | Early exit from `_chooseBestLegalCandidate` | None | F3-T3 | ✅ |
| F3-T2 | `_hasLegalForwardProgressMove` per-tick cache | None | F3-T3 | ✅ |
| P1 | Neighbor cache (`c._cachedNeighbors`) | None | P5-guard | ✅ |
| P2 | Remove redundant broad-phase in `_poseOverlapsCarsNeighbors` | None | P5-guard | ✅ |
| P3 | SAT trig cache (`c._tickCos/Sin` pre-compute + update after commit) | None | P5-guard | ✅ |
| P5-guard | Guards after Wave 1 (S/X/AA/AH) + profiler Checkpoint #1 | P1, P2, P3 | F3-T3 | ✅ |
| F3-T3 | Guards S/X/AA/AH verification gate | F3-T1, F3-T2, P5-guard | P4 | 🔄 AH still failing |
| P4 | Fast-path shortcut in `_chooseLegalMove` (nominal mode) | F3-T3 | P6 | ✅ |
| P6 | Profiler extension: fast-path hit/miss counters | P4 | P6-verify | ⬜ |
| P6-verify | Run profiler + Checkpoint #2 (browser + guards) | P6 | P7, MC-1 (partial) | ⬜ |
| P7 | Merge-scenario test card | P6-verify | P5 | ⬜ |
| P5 | Normal-mode candidate reduction in `_candidateSet` | P7 | P7-verify | ⬜ |
| P7-verify | P7 card + guards + profiler Checkpoint #3 | P5 | MC-2 | ⬜ |
| MC-1 | ⊕ All fixes done + AH passes + guards S/X/AA/AH all pass | F1-T3, F2-T5, F3-T3, P6-verify | F4-T1 | ⬜ |
| MC-2 | ⊕ All perf waves done + AH green + profiler improved | P7-verify, MC-1 | — | ⬜ |
| F4-T1 | Read Ren class; design visual state indicator scheme | MC-1 | F4-T2 | ⬜ |
| F4-T2 | Implement visual state indicators in `Ren._drawCar()` | F4-T1 | F4-T3 | ⬜ |
| F4-T3 | Human visual browser check: smooth + indicators readable | F4-T2 | — | ⬜ |

---

## 7. Implementation Phases

### Phase 1: Confirm RED Tests (Wave 0 — Human Gate)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| A | F2-T1, F2-T2, F2-T3 (verify RED) | Yes — already done | Cards AQ/AR/AS exist and fail; human confirms RED is meaningful |

- [ ] **Human gate:** Run `--id AQ --id AR --id AS`, confirm each fails for the right reason

---

### Phase 2: Parallel — Bug Fix + Perf Wave 1

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| B1 | F2-T4 | Sequential (after human confirms RED) | Modifies lines 693-722 |
| B2 | P1, P2, P3 | Yes (parallel) | Independent cache layers, different methods/functions |

- [ ] **F2-T4:** Add third exit branch: `else if (assignedMode === 'batch' && canExit)`. Include ALL state resets from lines 702-713 (path snap, heading correction, speed reset). Set `trafficMode = 'batch'; c.maneuvering = false`.
- [ ] **P1:** Neighbor cache. Add `c._cachedNeighbors = null` initialization. In tick loop, clear at start. In `_relevantLegalNeighbors`, check cache first.
- [ ] **P2:** Remove `dx*dx + dy*dy > PROJ_BROAD_PHASE_SQ` check from `_poseOverlapsCarsNeighbors`.
- [ ] **P3:** Pre-compute `c._tickCorners = carCorners(c.x, c.y, c.th, 0)` for all active cars at tick start. Modify `satOverlapMargin` to accept optional pre-computed corners for the `b` car.

Run guards after B1 completes. Run guards + profiler after B2 completes.

---

### Phase 3: Guard Verification + Fast Path (Sequential)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| C1 | F2-T5 | Sequential | Verify F2-T4 correct |
| C2 | P5-guard → F3-T3 | Sequential | Guard chain after Wave 1 |
| C3 | P4 → P6 → P6-verify | Sequential | Fast path, then profiler, then checkpoint |

- [ ] **F2-T5:** `--id AQ --id AR --id AS --id S --id X --id AA --id AH` — all PASS
- [ ] **P5-guard:** `--id S --id X --id AA --id AH` + `node profile_planner_hotspots.js` — record delta from baseline
- [ ] **F3-T3:** Guard verification gate (S/X/AA/AH all pass) — confirms F3+F5 safe together
- [ ] **P4:** Fast-path shortcut in `_chooseLegalMove`. Before `nominal`/`traffic` split, try `(desSpd, desSt)`. Accept if `_isLegalPoseNeighbors` passes (using `c._cachedNeighbors` from P1). Return immediately. Otherwise fall through.
- [ ] **P6:** Add `sim.fastPathHits` and `sim.fastPathMisses` counters to `Sim`. Instrument `_chooseLegalMove` to increment. Extend `profile_planner_hotspots.js` to report hit rate.
- [ ] **P6-verify:** 👤 **Checkpoint #2:** Run browser at 3L/40. Confirm smoother. Run `profile_planner_hotspots.js`. Record fast-path hit rate + wall time.

---

### Phase 4: Performance Wave 3 (Sequential)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| D | P7 → P5 → P7-verify | Sequential | Test first, then reduce candidates, then verify |

- [ ] **P7:** Write merge-scenario test card. 2 lanes, 3 cars. Car B merges in front of Car C. Assert: Car C slows before overlap; zero SAT overlaps. Classify as `diagnostic`.
- [ ] **P5:** Reduce normal-mode candidates in `_candidateSet`. Target: ~16 (from ~23). Keep: top 3 speed scales, 5 target steers × 2 scales, 2 blockerSteer, 1 zero-speed. Maneuver mode unchanged.
- [ ] **P7-verify:** 👤 **Checkpoint #3:** `--id P7` PASS. Guards S/X/AA/AH PASS. Profiler shows candidates reduced.

---

### Phase 5: MC-1 + MC-2 Gate

- [ ] **MC-1:** All new cards GREEN (AC, AP, AQ, AR, AS). Guard suite S/X/AA/AH all PASS.
- [ ] **MC-2:** Profiler shows improvement vs baseline. Fast-path hit rate > 0. AH PASS.

---

### Phase 6: Visual State Indicators (Sequential)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| E | F4-T1 → F4-T2 → F4-T3 | Sequential | Design → implement → verify |

- [ ] **F4-T1:** Read `Ren` class. Design minimalist indicators. Document in code comment.
- [ ] **F4-T2:** Implement. No car fill color changes. Use existing canvas primitives.
- [ ] **F4-T3:** 👤 Human opens browser. Confirms all 4 states readable + animation smooth.

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| Neighbor cache stale — positions change mid-tick | Low | High — wrong collision decisions | Verify: positions update only at end of `_chooseLegalMove` loop. Cache is per-tick, not per-sub-step. |
| SAT cache stale for sequential-commit cars | Low | High — wrong collision after car moves | Clear `_tickCorners` for each car AFTER its position commits (not at tick start). Or: only cache for STATIC neighbor cars (not the car currently moving). |
| Fast-path accepts move that causes conflict next tick | Medium | Medium — visible near-miss | SAT checks current overlap; IDM + cone detection handle anticipation. Guard tests detect real overlaps. |
| Candidate reduction misses critical evasion move | Medium | High — overlap or wall escape | Guard tests (S, X, AA, AH) immediately detect. Start conservative (keep more candidates), only cut confirmed-redundant ones. |
| AH still times out after perf wave | Medium | Medium — MC-1 blocked | If P1+P2+P3+P4 not sufficient, profile AH specifically and add targeted optimization |
| Batch+stuck fix missing state reset | Medium | Medium — visible jerk or stuck state | Copy ALL state resets from lines 702-713. Test card AS specifically checks resolution. |

**Special note on SAT cache (P3):**
The sequential-commit architecture means that after Car A moves, Car B sees Car A's new position. If `c._tickCorners` was pre-computed at tick start, Car B would use Car A's OLD corners when checking overlap — a correctness bug.

**Mitigation options for P3:**
1. **Only cache corners for the candidate car being tested against** — i.e., the `b` parameter in `satOverlapMargin`. Since `b` is always an ALREADY-COMMITTED car (not the current moving car), its corners were correct at the time it moved. After it moves, update its cache entry.
2. **Update `c._tickCorners` after each car commits** — When `c.x/y/th` update at line 885, recompute `c._tickCorners`.
3. **Defer P3 if complexity is too high** — P1+P2+P4 alone may provide sufficient improvement. P3 is the most complex of the zero-behavior-change optimizations.

---

## 9. Open Questions

- [ ] Will P1+P2+P3+P4 together be sufficient for AH to pass? Profile specifically at 12000 ticks if needed.
- [ ] SAT cache (P3): which mitigation option? Option 2 (update after commit) is safest. Verify during implementation.
- [ ] What is the fast-path hit rate in practice for nominal-mode cars? Expected >70% — verify in profiler.
- [ ] Card C (known_red) now unexpectedly passes — should it be reclassified to `survey_green`?
- [ ] Card B (survey_green) is failing — is this expected or a regression? Investigate before MC-1.

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
| 2026-03-13 | F1-T1, F1-T1b, F1-T2 confirmed already implemented (plan not updated earlier). F1-T2 (yield fix: batch-partner tracking + NO_PROGRESS_THRESH_YIELD=480 + forwardIntent removed) already in code. | Claude Opus 4.6 |
| 2026-03-13 | New fix: main-segment speed floor when scheduler disabled — breaks IDM cascade for same-target convoys. Card AP: 1412→591 ticks (2.4x). Card X: was timing out, now PASS. Card AP updated: maxTicks=1800, 30s clearance assertion. Guards S/X/AA all GREEN. | Claude Opus 4.6 |
| 2026-03-13 | Performance Extension added from DISCOVERY addendum (2026-03-13). Profiling baseline: 3L/40 cars = 6,477ms / 200 ticks (AH fails due to timeout). Added Features 5 (P1/P2/P3), 6 (P4/P6), 7 (P5/P7). Added MC-2. Updated guard suite to include AH. F2-T1/T2/T3 status updated to ✅ (cards AQ/AR/AS exist). Noted P3 SAT cache correctness risk for sequential-commit architecture. | Claude Sonnet 4.6 |
| 2026-03-13 | F2-T4/T5 ✅ — batch+stuck fix + 180-tick cascade timeout + post-tick separation pass (commit c8bb088). AQ/AR/AS all pass. P1/P2/P3/P4 ✅ — neighbor cache, broad-phase removal, trig cache, fast-path shortcut all implemented. P5-guard: 200t wall 6,477→6,335ms (-2%), `_isLegalPoseNeighbors` calls 142K→22K (-84%), time 19,337→2,503ms (-87%). AH still timing out — needs P5 candidate reduction. | Claude Sonnet 4.6 |
| 2026-03-13 | **Performance Wave 4 (P8/P10):** Off-screen car sleep + safety metrics optimization. 80-car 200-tick wall time: 11,392ms→2,876ms (**-75%**, 3.96× speedup). P8: Cars far from stop line (y > stopY + 3×SPAWN_SPACING) skip full pipeline — get minimal IDM follow + bicycle model step. At 80 cars, ~90% of car-ticks are sleeping. P10: Safety metrics now only check awake cars (O(awake²) instead of O(N²)). 4 new diagnostic cards (AT/AU/AV/AW) all PASS. Guards S/X/AA/AC and correctness cards AQ/AR/AS all GREEN. | Claude Opus 4.6 |
| 2026-03-13 | **P7/P5/P7-verify ✅:** Merge-scenario test card AY (2L, 4 cars, MOBIL merge + follower braking). P5 candidate reduction: speed scales 6→4 [0.85,0.55,0.25,0.1], steer scales 4→3 [0.55,0.35,0.15], blocker scales 3→2 [0.4,0.25]. Avg candidates 23→18.8 (-18%). 80-car wall time 2,876→2,530ms (-12%). Total improvement from baseline: 11,392→2,530ms (**-78%**). Initial aggressive P5 (3 speed, 2 steer) broke AQ/AR/AS (33-36/40 cars); adjusted to conservative reduction. All 11 cards PASS: S/X/AA/AQ/AR/AS/AT/AU/AV/AW/AY. | Claude Opus 4.6 |
| 2026-03-13 | **Reverse gap fix:** `_isLegalPoseNeighbors` now enforces `HARD_FOLLOW_GAP` in the reverse direction for candidates with negative speed. Bug: `_sameLaneRuntimeGap` only checked forward — reverse candidates could approach cars behind with no gap constraint, causing overlaps on narrow roads. Card AZ (3L/80, seed 777, PHONE): 171 overlaps → 0. All 6 previously-failing seeds (3L/80 + 2L/40) now 0 overlaps, 0 wall escapes. Guard suite S/X/AA/AY/AQ/AR/AS/AZ all PASS. | Claude Opus 4.6 |
| 2026-03-13 | **F2-T6 ✅:** Same-target yield delay fix. Added `c.target !== zone.activeBatchTarget` to `_assignBatchStates` yield condition (line 1352). New diagnostic card AX uses `customCase` (3 cars: 0-right enables scheduler, two 1-left cars 15px apart — too close to trail/share). Test confirmed RED without fix (1 violation tick, car2 yields for same-target batch), GREEN with fix (0 violations). Debug revealed multi-zone test detection bug: original `standardCase` test checked ALL zones against each yielding car, producing false positives when a car correctly yielded for one zone but a different zone had a matching batch target. Fixed by adding `zone.paths.has(car.pathKey)` guard. Guard suite 18/19 (AH pre-existing), AQ/AR/AS all pass. | Claude Sonnet 4.6 |

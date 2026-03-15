# Car Overlap Debug & Universal Block — Implementation Plan

**Generated:** 2026-03-14
**Status:** Draft
**Discovery:** [DISCOVERY_Car_Overlap_Debug_Universal_Block.md](../../docs/DISCOVERY_Car_Overlap_Debug_Universal_Block.md)

---

## 1. Executive Summary

Build diagnostic infrastructure that makes maneuver-mode car overlaps visible and measurable in headless tests — something 5+ prevention-focused fixes have failed to achieve because we couldn't see what was actually happening. The deliverables are: (1) enhanced overlap diagnostics in the simulation engine, (2) a RED test card that reproduces browser-observed phasing, and (3) a performance benchmark proving the diagnostic cost is acceptable. No fix is implemented here — the fix will be designed in a follow-up discovery after reviewing diagnostic evidence.

---

## 2. Requirements Summary

### 2.1 Problem Statement

Cars in maneuver mode phase through other cars in the browser at ~5s of simulation time with 40 cars on 3 lanes. All headless test cards report 0 overlaps. Five previous fix attempts (reverse gap check, heading clamp guard, separation cascade check, universal `_commitPose` SAT guard on 6 call sites) have not produced visible improvement. The root cause is unknown because no diagnostic tool captures WHERE, WHEN, or HOW overlaps occur.

Key hypothesis: the `_commitPose` guardList uses `satOverlap` (zero margin), while the planner uses `satOverlapMargin` with `PROJ_MARGIN=2`. Post-move passes (heading correction, heading clamp, exit fork hold, separation push) can place cars within 0–2px of each other through `_commitPose` without triggering the zero-margin SAT monitor. Visually, sub-2px proximity looks like phasing.

### 2.2 Target Users

Educational showcase audience viewing the traffic paradox simulation in a browser. Cars visibly passing through each other breaks the illusion of a physical simulation.

### 2.3 Success Criteria

- [ ] A headless RED test card that detects overlaps matching browser conditions (overlapCount > 0 = FAIL)
- [ ] Per-tick near-miss tracker logs car pairs within CAR_L distance with full state
- [ ] Overlap event capture logs the exact tick, positions, headings, maneuvering status, and gap distance
- [ ] Performance benchmark shows the diagnostic cost via A/B comparison (with/without check)
- [ ] Human reviews diagnostic output and identifies the overlap pattern before any fix is designed

### 2.4 Explicitly Out of Scope

- Fixing maneuver wobble quality (don't tune phases/timing — just track overlaps)
- Paradox tuning (IDM/batch calibration — separate project)
- Visual state indicators (F4 from existing plan — defer until overlap is fixed)
- Test suite classification overhaul (don't reorganize A–Y cards)
- Implementing an overlap FIX — that's T6, a separate discovery after diagnostic review

### 2.5 Evidence of Readiness

- [ ] `node run_traffic_suite.js --id BE` outputs overlap events with full state (card FAILS = overlaps detected)
- [ ] Diagnostic log shows tick number, car IDs, positions, headings, maneuvering status, gap distance for every near-miss and overlap
- [ ] `node profile_planner_hotspots.js` (or equivalent) A/B comparison shows wall-time delta with/without diagnostic
- [ ] Human has reviewed diagnostic output and identified the overlap pattern

---

## 3. Technical Architecture

### 3.1 System Overview

```
traffic_core.js (Sim class)
  │
  ├─ NEW: _diagnosticOverlapCheck(active, tick)     ← per-tick near-miss + overlap capture
  │       Called at END of tick, AFTER all position changes and AFTER existing SAT monitor
  │       Uses PROJ_MARGIN (2px) not zero margin — catches visual phasing too
  │
  ├─ NEW: testMetrics.nearMissLog[]                 ← array of {tick, aId, bId, ax, ay, ath, bx, by, bth, gap, aManeuver, bManeuver}
  ├─ NEW: testMetrics.overlapEventLog[]             ← array of {tick, aId, bId, ..., margin, zeroMarginOverlap}
  │
  └─ EXISTING: post-tick SAT monitor (line 1169)    ← still runs, but we ADD a margin-based check alongside

traffic_test_suite.js
  │
  └─ NEW: Card BE — "3L/40-car maneuver overlap diagnostic (PHONE)"
          3 lanes, 40 cars, 50/50, PHONE (110×700), seed sweep (multiple seeds)
          maxTicks: 600 (~10s sim time, user reports overlaps at ~5s)
          stepsPerFrame: 1 (match browser default)
          Verdict: overlapCount === 0 (PASS when no overlaps — currently FAILS)

profile_planner_hotspots.js (or new perf script)
  │
  └─ NEW: A/B comparison mode — run same scenario with diagnostic enabled/disabled, report delta
```

### 3.2 Data Flow

```
Per tick:
  ... all existing passes (planner, heading correction, heading clamp, separation, etc.) ...
  existing SAT monitor (line 1169) — zero-margin overlapCount      ← UNCHANGED
  NEW: _diagnosticOverlapCheck(active, tick)
    For each pair within CAR_L * 2 distance:
      1. Compute center-to-center distance
      2. If distance < CAR_L * 1.5 → log as NEAR-MISS (nearMissLog)
      3. Check satOverlapMargin with PROJ_MARGIN → if overlap → log as OVERLAP EVENT (overlapEventLog)
      4. ALSO check satOverlap (zero margin) → tag event with zeroMarginOverlap boolean
      5. Check if either car is maneuvering → tag event
    Increment testMetrics.marginOverlapCount (2px margin overlaps)
    Increment testMetrics.overlapCount (zero margin overlaps — same as existing)
```

### 3.3 Technology Decisions

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Diagnostic tracker | Vanilla JS in Sim class | Same environment as simulation — no dependencies |
| Test card | `traffic_test_suite.js` card registry | Existing test infrastructure |
| Performance benchmark | Node.js script | Extend existing `profile_planner_hotspots.js` or new standalone |
| Logging | In-memory arrays (`testMetrics`) | No file I/O during simulation — dump after run |

### 3.4 Integration Points

- `traffic_test_suite.js` exports card registry consumed by `run_traffic_suite.js` (Node) and `red_visual_tests.html` (browser)
- `traffic_core.js` Sim class — new diagnostic method called from `_tickStep`
- Existing `testMetrics` object extended with new fields

### 3.5 Output and Failure Contracts

| Artifact or State | Owner | Proof Required | Blocked If |
|-------------------|-------|----------------|------------|
| nearMissLog array populated | `_diagnosticOverlapCheck` | Array has >0 entries for 3L/40 run | Method not called or broad-phase filters too aggressively |
| overlapEventLog array populated | `_diagnosticOverlapCheck` | Array has >0 entries when browser shows phasing | Overlap detection uses wrong margin or wrong timing |
| Card BE verdict = FAIL (RED) | `traffic_test_suite.js` | `node run_traffic_suite.js --id BE` outputs FAIL with overlap details | No overlaps detected headlessly (diagnostic gap persists) |
| Performance A/B delta measured | Benchmark script | Wall-time delta reported for with/without diagnostic | Diagnostic method doesn't exist or isn't toggleable |

---

## 4. Feature Breakdown

---

### Feature 1: Enhanced Overlap Diagnostics

**User Story:** As a developer debugging car overlap, I want per-tick near-miss and overlap event logging in the simulation engine so that I can see exactly when, where, and how cars get too close or overlap.

**Acceptance Criteria:**
- [ ] `_diagnosticOverlapCheck(active, tick)` method exists on `Sim` class
- [ ] Checks all car pairs within `CAR_L * 2` broad-phase distance
- [ ] Near-miss log captures pairs within `CAR_L * 1.5` center-to-center distance with full state
- [ ] Overlap event log captures pairs that `satOverlapMargin` with `PROJ_MARGIN` detects as overlapping
- [ ] Each event tagged with: tick, both car IDs, both (x,y,th), both maneuvering status, gap distance, whether zero-margin SAT also detects it
- [ ] `testMetrics.marginOverlapCount` tracks 2px-margin overlaps (new — distinct from existing zero-margin `overlapCount`)
- [ ] Method is called at the end of `_tickStep`, after all position changes and after the existing SAT monitor pass
- [ ] Diagnostic does NOT change any car position or speed — observation only

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Proof Required | Blocked If | Status |
|----|------|--------------|------------|--------|----------------|------------|--------|
| F1-T1 | Add `_diagnosticOverlapCheck` method to Sim with near-miss logging | None | No | M | `nearMissLog` populates during 3L/40 run | Method not called in tick |  ⬜ |
| F1-T2 | Add overlap event capture with full state and margin-based detection | F1-T1 | No | M | `overlapEventLog` populates when margin overlap detected | satOverlapMargin not called correctly | ⬜ |
| F1-T3 | Wire `_diagnosticOverlapCheck` into `_tickStep` (after existing SAT monitor) | F1-T1, F1-T2 | No | S | `_tickStep` calls diagnostic method; logs accumulate across ticks | Call site missing or in wrong position | ⬜ |

**Tests Required (write BEFORE implementation):**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Near-miss log populates for close cars | Headless (card) | No | nearMissLog.length > 0 for 3L/40 run | Card BE diagnostic output |
| Overlap event log captures margin overlaps | Headless (card) | No | overlapEventLog.length > 0 when margin overlaps exist | Card BE diagnostic output |
| Diagnostic does NOT change car positions | Headless (guard) | No | Guard tests S/X/AA still pass with diagnostic enabled | `--id S --id X --id AA` all PASS |

---

### Feature 2: RED Test Card

**User Story:** As a developer, I want a headless test card that reproduces the browser-observed overlap so that I have a reliable RED test to drive fixes.

**Acceptance Criteria:**
- [ ] Card BE exists in `traffic_test_suite.js`
- [ ] Scenario: 3 lanes, 40 cars, 50/50 split, PHONE canvas (110×700), maxTicks 600 (~10s sim time)
- [ ] Multiple seeds tested (sweep 3–5 seeds to find one that reliably triggers maneuver overlaps)
- [ ] Verdict: `overlapCount === 0 && marginOverlapCount === 0` (PASS when clean — currently FAILS)
- [ ] On FAIL, the card's metrics include `nearMissLog` and `overlapEventLog` for post-run analysis
- [ ] Card classified as `diagnostic` family
- [ ] Existing guard tests (S, X, AA) still pass

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Proof Required | Blocked If | Status |
|----|------|--------------|------------|--------|----------------|------------|--------|
| F2-T1 | Write card BE in `traffic_test_suite.js` with seed sweep and diagnostic metrics | F1-T3 | No | M | Card exists, runs without error | Diagnostic infrastructure not wired | ⬜ |
| F2-T2 | Run card BE, confirm it FAILS (RED) with overlap events logged | F2-T1 | No | S | `node run_traffic_suite.js --id BE` → FAIL with overlapEventLog populated | Card passes (no overlaps detected — diagnostic gap persists) | ⬜ |
| F2-T3 | Run guard tests to confirm no regression | F2-T2 | No | S | `--id S --id X --id AA` all PASS | Any guard fails | ⬜ |

**Tests Required (write BEFORE implementation):**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Card BE detects overlaps in 3L/40 scenario | Headless Node.js | Yes — review diagnostic logs after | Card verdict = FAIL with overlapEventLog.length > 0 | `--id BE` output showing overlap events |
| Guard tests unaffected | Headless Node.js | No | S/X/AA all PASS | CLI output |

---

### Feature 3: Performance Benchmark

**User Story:** As a developer, I want to measure the performance cost of the diagnostic overlap check so that I know whether it's viable for production or only for test runs.

**Acceptance Criteria:**
- [ ] A/B comparison script exists (extend `profile_planner_hotspots.js` or standalone)
- [ ] Runs the same scenario (3L/40/PHONE) twice: once with diagnostic enabled, once disabled
- [ ] Reports wall-time delta (ms) and percentage overhead
- [ ] Diagnostic can be toggled via a flag on Sim (e.g., `sim.diagnosticOverlapEnabled = true/false`)

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Proof Required | Blocked If | Status |
|----|------|--------------|------------|--------|----------------|------------|--------|
| F3-T1 | Add `diagnosticOverlapEnabled` flag to Sim; guard `_diagnosticOverlapCheck` with flag | F1-T3 | No | S | Flag exists; when false, diagnostic method is not called | Diagnostic not toggleable | ⬜ |
| F3-T2 | Write A/B benchmark script (or extend profiler) | F3-T1 | No | M | Script runs, outputs wall-time with/without diagnostic and delta | No toggleable flag exists | ⬜ |
| F3-T3 | Run benchmark, record baseline numbers | F3-T2 | No | S | Benchmark output shows delta < 50% for diagnostic-enabled run | Benchmark script errors | ⬜ |

**Tests Required (write BEFORE implementation):**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Diagnostic toggle works (enabled/disabled) | Headless | No | With flag=false, nearMissLog stays empty; with flag=true, it populates | A/B run output |
| Performance overhead measured | Benchmark | No | Wall-time delta reported | Benchmark stdout |

---

### Merge Checkpoint: MC-1

**Gate:** F1 + F2 complete. Card BE runs and FAILS (RED) with overlap events in the diagnostic log. Guard tests S/X/AA pass. Human reviews diagnostic output.

**Blocked If:** Card BE passes (no overlaps detected — the fundamental diagnostic gap persists and needs investigation).

**Human Gate:** After MC-1, review the `overlapEventLog` from card BE to identify:
1. At which tick do overlaps first appear?
2. Are overlapping cars in maneuver mode?
3. What is the gap distance? (zero-margin overlap or margin-only?)
4. Is there a pattern in position/heading?

This review determines the fix strategy in a follow-up discovery (T6).

---

## 5. Test Strategy

### 5.1 Testing Pyramid

- **Headless tests:** Primary verification. New card BE in `traffic_test_suite.js`.
- **Guard tests:** S, X, AA run after every change to confirm no regression.
- **Performance benchmark:** A/B comparison to measure diagnostic cost.
- **No browser tests** in this phase — the goal is to make headless tests catch the overlap.

### 5.2 TDD Checklist (Per Task)

```
For EACH task, BEFORE writing implementation:
1. [ ] Write failing test describing expected behavior
2. [ ] Verify test fails for the RIGHT reason
3. [ ] Commit failing test with message: "test: [description]"
4. [ ] Write MINIMUM code to pass test
5. [ ] Verify test passes
6. [ ] Refactor if needed (tests MUST stay green)
7. [ ] Commit with message: "feat: [description]"
```

### 5.3 Testing Commands

```bash
# Run the RED test card
node run_traffic_suite.js --id BE

# Run guard tests
node run_traffic_suite.js --id S --id X --id AA

# Run performance benchmark (after F3)
node traffic-lane-paradox/benchmark_diagnostic.js
# OR
node profile_planner_hotspots.js --diagnostic-ab
```

---

## 6. Dependency & Parallelism Analysis

### 6.1 Task Dependency Graph

```
F1-T1 (near-miss method) ──► F1-T2 (overlap events) ──► F1-T3 (wire into tick)
                                                              │
                                                              ├──► F2-T1 (card BE) ──► F2-T2 (run RED) ──► F2-T3 (guards)
                                                              │                                                │
                                                              └──► F3-T1 (toggle flag) ──► F3-T2 (benchmark) ──► F3-T3 (run)
                                                                                                                │
                                                              MC-1 ◄──────────────────────────────────────────────┘
```

### 6.2 Parallelism Reasoning

| Task Group | Tasks | Parallel? | Rationale |
|------------|-------|-----------|-----------|
| **F1 (Diagnostics)** | F1-T1 → F1-T2 → F1-T3 | Sequential | Each builds on the previous — method, then events, then wiring |
| **F2 + F3 (after F1)** | F2-T1..T3 and F3-T1..T3 | Yes — parallel tracks | Card BE (F2) and toggle+benchmark (F3) are independent after F1-T3 |
| **MC-1** | After F2-T3 and F3-T3 | Convergence gate | Both tracks must complete before human review |

### 6.3 Task Dependency Table

> **Source of truth for `/tdd` workflow.**

| Task | Description | Depends On | Unblocks | Status |
|------|-------------|------------|----------|--------|
| F1-T1 | Add `_diagnosticOverlapCheck` with near-miss logging | None | F1-T2 | ⬜ |
| F1-T2 | Add overlap event capture with full state + margin detection | F1-T1 | F1-T3 | ⬜ |
| F1-T3 | Wire `_diagnosticOverlapCheck` into `_tickStep` after SAT monitor | F1-T2 | F2-T1, F3-T1 | ⬜ |
| F2-T1 | Write card BE (3L/40/PHONE, seed sweep, diagnostic metrics) | F1-T3 | F2-T2 | ⬜ |
| F2-T2 | Run card BE, confirm FAIL (RED) with overlap events | F2-T1 | F2-T3 | ⬜ |
| F2-T3 | Run guard tests S/X/AA — confirm no regression | F2-T2 | MC-1 | ⬜ |
| F3-T1 | Add `diagnosticOverlapEnabled` toggle flag to Sim | F1-T3 | F3-T2 | ⬜ |
| F3-T2 | Write A/B benchmark script | F3-T1 | F3-T3 | ⬜ |
| F3-T3 | Run benchmark, record delta | F3-T2 | MC-1 | ⬜ |
| MC-1 | ⊕ RED test fails + guards pass + benchmark recorded + human reviews diagnostic output | F2-T3, F3-T3 | — | ⬜ |

---

## 7. Implementation Phases

### Phase 1: Diagnostic Infrastructure (Sequential — same method, building up)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| A | F1-T1 → F1-T2 → F1-T3 | No | Each builds on previous — method body, then event capture, then wiring |

- [ ] F1-T1: `_diagnosticOverlapCheck` method with near-miss pairs (within CAR_L * 1.5)
- [ ] F1-T2: Add overlap event capture with `satOverlapMargin` (PROJ_MARGIN) + full state tagging
- [ ] F1-T3: Wire into `_tickStep` after line 1179 (after existing SAT monitor)

### Phase 2: RED Test + Benchmark (Parallel — independent tracks)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| B1 | F2-T1 → F2-T2 → F2-T3 | No (sequential) | Card must exist before running; guards after run |
| B2 | F3-T1 → F3-T2 → F3-T3 | No (sequential) | Flag before benchmark; benchmark before recording |
| B1 + B2 | Parallel | Yes | Card BE and benchmark are independent after F1-T3 |

- [ ] F2-T1: Write card BE in `traffic_test_suite.js`
- [ ] F2-T2: Run card BE — confirm FAIL (RED) with diagnostic events
- [ ] F2-T3: Run guard tests S/X/AA
- [ ] F3-T1: Add toggle flag
- [ ] F3-T2: Write benchmark script
- [ ] F3-T3: Run benchmark

### Phase 3: Human Review Gate (MC-1)

- [ ] MC-1: Review `overlapEventLog` from card BE. Identify overlap pattern. Decide fix strategy in follow-up discovery.

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| Card BE passes (no overlaps detected headlessly) | Medium | High — diagnostic gap persists | Try multiple seeds; try margin-based detection (2px) instead of zero-margin; try different dt values; if still 0, the overlap may be rendering-only |
| Performance overhead too high for production use | Low | Medium — diagnostic stays test-only | Toggle flag ensures zero overhead when disabled; A/B benchmark quantifies cost |
| Near-miss log too verbose (thousands of entries) | Medium | Low — just noise | Cap log at first 100 entries per run; add `verbose` flag |
| Existing SAT monitor already catches everything | Low | Low — confirms tests are correct and browser phasing is visual-only | If margin-based check also shows 0, we know the issue is rendering, not positions |

---

## 9. Open Questions

- [ ] Which seeds reliably trigger maneuver mode in 3L/40/PHONE? (Need to find at least 2 seeds that produce maneuvering cars)
- [ ] Does `satOverlapMargin` with PROJ_MARGIN=2 catch the visual phasing? (This is the key hypothesis — zero-margin misses sub-2px proximity)
- [ ] Should the diagnostic check ALSO run between sub-passes within a tick (after heading clamp, after separation) or only at tick end? (More expensive but might catch transient overlaps)
- [ ] What is the next card ID? (Need to verify BE is not already taken)

---

## 10. Approval Checklist

- [ ] Requirements reviewed by: _____________ Date: _________
- [ ] Architecture reviewed by: _____________ Date: _________
- [ ] Plan approved by: _____________ Date: _________

---

## 11. Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-03-14 | Initial plan created from DISCOVERY_Car_Overlap_Debug_Universal_Block.md | Claude Opus 4.6 |

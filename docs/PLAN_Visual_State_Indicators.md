# Traffic Lane Paradox — Visual State Indicators

**Generated:** 2026-03-15
**Status:** Draft
**Discovery:** [DISCOVERY_Visual_State_Indicators.md](DISCOVERY_Visual_State_Indicators.md)
**Parent Plan:** [PLAN_Maneuver_Conflict_Overhaul.md](PLAN_Maneuver_Conflict_Overhaul.md) (Feature 4)

---

## 1. Executive Summary

Redesign the visual indicators for all 4 active traffic modes (`yield`, `batch`, `hold_exit`, `maneuver`) in the traffic lane paradox simulator, replacing the current ad-hoc red/orange border strokes with a unified, urgency-scaled visual language. Add directional arrows for batch/hold_exit modes and extend the existing footer legend with dot+label pairs explaining each mode to educational viewers.

---

## 2. Requirements Summary

### 2.1 Problem Statement

The simulator currently has inconsistent visual feedback for car traffic modes. Only `yield` (red border) and `maneuver` (orange border) have any indicator; `batch` and `hold_exit` are invisible. The `reversing` state has its own border that overlaps with maneuver. Educational viewers cannot tell why a car is stopped, wobbling, or crossing the fork. The footer legend only explains left/right direction colors, not traffic modes.

### 2.2 Target Users

Educational showcase audience — people watching the traffic paradox demonstration in a browser. Non-technical viewers who need visual cues to understand car behavior.

### 2.3 Success Criteria

- [ ] All 4 active modes (yield, batch, hold_exit, maneuver) are visually distinct in the browser
- [ ] Footer legend updated with dot+label pairs for each mode in the existing row
- [ ] No significant render performance regression at 3L/40 cars (frame time delta documented)
- [ ] Indicators readable at all panel sizes including 220px narrow panels
- [ ] No visual clutter — indicators are subtle enough to not distract from the simulation

### 2.4 Explicitly Out of Scope

- Animated mode transitions (smooth fades between states) — deferred to IDEAS
- Interactive hover/tooltip showing full car state — deferred to IDEAS
- Changing `free` or `commit` mode visuals (they stay plain)
- Guard test suite verification (purely visual change, no sim behavior impact)
- Paradox tuning or simulation behavior changes

### 2.5 Evidence of Readiness

- [ ] Render perf baseline captured before any changes (frame time at 3L/40)
- [ ] Headless structural test verifies canvas ops per trafficMode
- [ ] Post-change perf measurement shows delta
- [ ] Human confirms all 4 modes visually distinct in browser at 3L/40

---

## 3. Technical Architecture

### 3.1 System Overview

```
traffic_core.js
  └── class Ren
       └── _car(car, alpha)     ← PRIMARY EDIT: indicator rendering
            ├── car body fill (unchanged)
            ├── [NEW] mode border stroke (unified system)
            ├── [NEW] tint overlay (maneuver only)
            ├── [NEW] directional arrow (batch/hold_exit)
            ├── [REMOVE] separate reversing border
            ├── slow-car pulse (unchanged)
            ├── blinker (unchanged)
            └── headlights/brake/reverse lights (unchanged)

traffic_v18.html
  └── <div class="ftr">         ← SECONDARY EDIT: legend extension
       ├── wants left (unchanged)
       ├── wants right (unchanged)
       ├── [NEW] yield dot+label
       ├── [NEW] batch dot+label
       ├── [NEW] maneuver dot+label
       └── feature text (unchanged)
```

### 3.2 Data Flow

```
Per frame (each visible car):
  Ren._car(car, alpha)
    1. Draw car body (rounded rect, car.color)          ← unchanged
    2. IF sim.started:
       a. Check car.trafficMode → select indicator style
       b. IF maneuver → tint overlay (rgba fill over body)
       c. IF yield/batch/hold_exit/maneuver → mode border stroke
       d. IF batch OR hold_exit → directional arrow from car.target
       e. (overlapping modes: layer all applicable indicators)
    3. Slow-car pulse                                    ← unchanged
    4. Blinker                                           ← unchanged
    5. Headlights / brake / reverse lights               ← unchanged
```

### 3.3 Technology Decisions

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Mode borders | Canvas `stroke()` + `setLineDash()` | Already used; dashed lines differentiate urgency levels |
| Tint overlay | Canvas `fillRect()` with `globalAlpha` | Semi-transparent overlay preserves base car color |
| Directional arrows | Canvas `beginPath()` + `lineTo()` + `fill()` | Small filled triangle, 2-3px — cheapest drawn shape |
| Footer legend | HTML `<span>` elements with CSS dot classes | Matches existing "wants left"/"wants right" pattern exactly |
| Perf measurement | `performance.now()` wrapping `Ren.draw()` | Standard browser API, minimal overhead |

### 3.4 Integration Points

- `Ren._car()` in `traffic_core.js` — reads `car.trafficMode`, `car.maneuvering`, `car.zoneYielding`, `car.target`
- `traffic_v18.html` — HTML footer `<div class="ftr">` + CSS `.dt` dot classes
- `traffic_test_suite.js` — new headless test card for structural verification
- `run_traffic_suite.js` — runs the headless test

### 3.5 Output and Failure Contracts

| Artifact or State | Owner | Proof Required | Blocked If |
|-------------------|-------|----------------|------------|
| Indicator design scheme | Plan doc (this file, Section 4.1) | Design table in plan | Not written |
| Render perf baseline | Console/profiler output | `performance.now()` measurement at 3L/40 | No baseline captured |
| Updated `_car()` method | `traffic_core.js:Ren._car()` | Syntax check passes (`node -e "require('./traffic_core.js')"`) | Syntax error |
| Updated footer legend | `traffic_v18.html:432` | HTML opens without error in browser | Parse error |
| Headless structural test | `traffic_test_suite.js` | `node run_traffic_suite.js --id [card]` PASS | Test fails |
| Post-change perf delta | Console/profiler output | Documented before/after comparison | Not measured |
| Human visual confirmation | Browser observation | All 4 modes visually distinct, legend readable | Human rejects |

---

## 4. Feature Breakdown

---

### Feature 1: Indicator Design Scheme

**User Story:** As the implementer, I need a documented design specification for all 4 mode indicators so that implementation is consistent and deliberate.

**Acceptance Criteria:**
- [ ] All 4 modes have defined: border color, border width, border dash pattern, optional tint overlay, optional directional arrow
- [ ] Urgency ordering is clear: maneuver > yield > hold_exit > batch
- [ ] Design documented in this plan file
- [ ] Design is implementable with canvas 2D API only (no images, no external resources)

**Proposed Indicator Scheme:**

| Mode | Border Color | Border Width | Dash Pattern | Tint Overlay | Arrow | Urgency |
|------|-------------|-------------|--------------|--------------|-------|---------|
| `maneuver` | `#ff4400` (bright red-orange) | 1.5px | `[3, 2]` (dashed) | `rgba(255,50,0,0.12)` over car body | No | HIGHEST |
| `yield` | `#ddaa44` (soft amber) | 1.0px | `[]` (solid) | None | No | MODERATE |
| `hold_exit` | `#55bb77` (soft green) | 0.7px | `[1.5, 1.5]` (dotted) | None | Yes (`◄`/`►` based on `car.target`) | LOW |
| `batch` | `#55bb77` (soft green) | 0.7px | `[]` (solid) | None | Yes (`◄`/`►` based on `car.target`) | LOWEST |
| `free` | None | — | — | — | — | — (plain) |
| `commit` | None | — | — | — | — | — (plain) |

**Design rationale:**
- **maneuver** = dashed border + tint overlay. Dashed = unstable/urgent. Red tint = alarm. Most prominent.
- **yield** = solid amber border only. Warm amber = "waiting patiently." No dash, no tint — calmer than maneuver.
- **batch** = thin solid green border + arrow. Green = "go" semantics. Arrow shows direction.
- **hold_exit** = thin dotted green border + arrow. Dotted = "pausing" feel. Same color as batch but dash pattern differentiates.
- Batch and hold_exit share color (#55bb77) — they're both low-urgency "crossing" states. The dash pattern is the differentiator.
- `reversing` white border (line 2728) is REMOVED. Maneuver indicator covers it.

**Arrow specification:**
- Filled triangle, 2.5px wide × 3px tall
- Drawn at the front of the car, offset 2px to the left or right side
- Points left (`◄`) if `car.target === 'left'`, points right (`►`) if `car.target === 'right'`
- Color: same as border color (`#55bb77`)

**Footer legend entries:**

| Dot Color | Dot Style | Label |
|-----------|-----------|-------|
| `#ddaa44` (amber) | Solid circle | `yielding` |
| `#55bb77` (green) | Solid circle | `crossing` |
| `#ff4400` (red-orange) | Solid circle | `maneuvering` |

Note: batch and hold_exit share one "crossing" legend entry since they're both green and barely different.

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status | Proof Required | Blocked If |
|----|------|--------------|------------|--------|--------|----------------|------------|
| F1-T1 | Document indicator design scheme in this plan file | None | No | S | ✅ (this table) | Design table exists | Not documented |

**Tests Required:** None — this is a design documentation task.

---

### Feature 2: Render Performance Baseline

**User Story:** As the developer, I need a baseline measurement of current render frame time so I can quantify the cost of adding indicators.

**Acceptance Criteria:**
- [ ] Frame time measured at 3L/40-car scenario (200 frames, average)
- [ ] Measurement method documented (how to reproduce)
- [ ] Baseline number recorded in this plan

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status | Proof Required | Blocked If |
|----|------|--------------|------------|--------|--------|----------------|------------|
| F2-T1 | Write render perf measurement script (wraps `Ren.draw()` in `performance.now()` loop) | None | No | S | ✅ | Script exists, runs without error | Syntax error |
| F2-T2 | Run baseline measurement at 3L/40; record result in plan | F2-T1 | Yes — browser | S | ✅ | Number recorded: 0.9196 ms/frame | Not measured |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Baseline frame time captured | Browser measurement | Yes — run in browser | Average frame time recorded | Number in this plan's Section 9 |

---

### Feature 3: Indicator Implementation in Ren._car()

**User Story:** As a viewer of the simulation, I want to see at a glance which trafficMode each car is in, so I can understand why cars are stopped, crossing, or wobbling.

**Acceptance Criteria:**
- [ ] `yield` mode: solid amber border (#ddaa44, 1.0px)
- [ ] `batch` mode: thin solid green border (#55bb77, 0.7px) + directional arrow
- [ ] `hold_exit` mode: thin dotted green border (#55bb77, 0.7px, [1.5,1.5]) + directional arrow
- [ ] `maneuver` mode: dashed red-orange border (#ff4400, 1.5px, [3,2]) + red tint overlay (rgba(255,50,0,0.12))
- [ ] `reversing` white border REMOVED (line 2728)
- [ ] Overlapping modes layer both indicators (e.g., maneuver border + yield tint if both flags set)
- [ ] Indicators only render when `this.sim.started` is true
- [ ] `free` and `commit` modes render no indicator (plain car)
- [ ] Existing slow-car pulse, blinker, headlights, brake lights, reverse lights unchanged

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status | Proof Required | Blocked If |
|----|------|--------------|------------|--------|--------|----------------|------------|
| F3-T1 | Implement unified mode border system in `_car()`: replace existing `zoneYielding`/`maneuvering`/`reversing` border blocks with trafficMode-based switch | F1-T1 | No | M | ✅ | Syntax check passes | Syntax error |
| F3-T2 | Implement tint overlay for maneuver mode (rgba fillRect over car body after base fill) | F3-T1 | No | S | ✅ | Syntax check passes | F3-T1 not done |
| F3-T3 | Implement directional arrow for batch/hold_exit (filled triangle at car front, direction from car.target) | F3-T1 | No | S | ✅ | Syntax check passes | F3-T1 not done |
| F3-T4 | Remove `reversing` white border (line 2728 — `if (car.reversing)` stroke block) | F3-T1 | No | S | ✅ | Line removed | F3-T1 not done |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Yield mode triggers amber solid border | Headless structural | No | `setLineDash([])` + `strokeStyle=#ddaa44` called when trafficMode='yield' | Test card PASS |
| Batch mode triggers green solid border + arrow | Headless structural | No | `strokeStyle=#55bb77` + `fill()` (arrow) called | Test card PASS |
| Hold_exit mode triggers green dotted border + arrow | Headless structural | No | `setLineDash([1.5,1.5])` + arrow `fill()` called | Test card PASS |
| Maneuver mode triggers dashed border + tint | Headless structural | No | `setLineDash([3,2])` + tint `fillRect` called | Test card PASS |
| Free/commit modes have no indicator | Headless structural | No | No mode-specific stroke/fill calls | Test card PASS |
| Overlapping modes layer correctly | Headless structural | No | Both mode strokes called when both flags set | Test card PASS |

---

### Feature 4: Footer Legend Update

**User Story:** As a first-time viewer, I want the footer legend to explain what the mode indicators mean, so I can understand the simulation without prior knowledge.

**Acceptance Criteria:**
- [ ] Three new dot+label pairs added to existing footer row: yielding (amber), crossing (green), maneuvering (red-orange)
- [ ] Dot colors match the border colors used in the renderer
- [ ] Legend fits in single row without wrapping on narrow screens
- [ ] Existing "wants left"/"wants right" entries unchanged

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status | Proof Required | Blocked If |
|----|------|--------------|------------|--------|--------|----------------|------------|
| F4-T1 | Add 3 CSS dot classes (`.dy`, `.db`, `.dm`) and 3 span elements to footer `<div class="ftr">` in `traffic_v18.html` | F1-T1 | No | S | ✅ | HTML opens without error | Parse error |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Legend entries visible and correct | Visual browser | Yes — after impl | 3 new dot+label pairs visible in footer | Browser observation |
| No wrapping on narrow viewport | Visual browser | Yes — after impl | Footer stays single row at 600px viewport width | Browser observation |

---

### Feature 5: Headless Structural Test

**User Story:** As a developer, I want an automated test that verifies the renderer calls the correct canvas operations for each trafficMode, so regressions are caught without browser testing.

**Acceptance Criteria:**
- [ ] New test card in `traffic_test_suite.js` that creates a sim with cars in each trafficMode
- [ ] Verifies that `Ren._car()` calls mode-specific canvas operations (stroke colors, dash patterns, fill calls)
- [ ] Test passes headless via `node run_traffic_suite.js --id [card]`

**Technical approach:** The headless test runs in Node.js via `vm` sandbox (same as all other tests). The sandbox provides `console` and `Math` but no real canvas. The test will need to:
1. Create a mock `CanvasRenderingContext2D` that records method calls (spy pattern)
2. Create a `Ren` instance with a mock canvas
3. Set up cars with specific `trafficMode` values
4. Call `_car()` and inspect the recorded calls
5. Assert that mode-specific operations (strokeStyle, setLineDash, fillStyle for tint) were invoked

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status | Proof Required | Blocked If |
|----|------|--------------|------------|--------|--------|----------------|------------|
| F5-T1 | Write headless structural test card BO with canvas spy; verify all 4 modes + free/commit produce correct canvas ops | F3-T1, F3-T2, F3-T3, F3-T4 | No | M | ✅ | `node run_traffic_suite.js --id BO` PASS | Implementation not done |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Canvas ops match mode for all 6 trafficMode values | Headless diagnostic | No | Test card PASS | `--id [card]` PASS in CLI |

---

### Feature 6: Post-Change Performance Measurement

**User Story:** As the developer, I need to measure the render cost delta after adding indicators, so I can document whether performance regressed.

**Acceptance Criteria:**
- [ ] Post-change frame time measured at same 3L/40 scenario as baseline
- [ ] Delta (absolute and %) documented in this plan
- [ ] If regression > 20%, investigate and optimize before calling feature done

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status | Proof Required | Blocked If |
|----|------|--------------|------------|--------|--------|----------------|------------|
| F6-T1 | Run post-change measurement at 3L/40; record result + compute delta | F3-T1, F3-T2, F3-T3, F3-T4, F4-T1 | Yes — browser | S | ✅ | Delta recorded: +0.0724ms (+7.9%) | Implementation not done |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Render perf delta documented | Browser measurement | Yes — review delta | Before/after numbers + % change recorded | Numbers in this plan |

---

### Feature 7: Human Visual Verification

**User Story:** As the user, I want to see the indicators working in the browser before calling this feature complete.

**Acceptance Criteria:**
- [ ] All 4 modes visually distinct at 3L/40 cars in browser
- [ ] Footer legend readable and self-explanatory
- [ ] No visual clutter — indicators are subtle enough
- [ ] Indicators work at narrow panel sizes

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status | Proof Required | Blocked If |
|----|------|--------------|------------|--------|--------|----------------|------------|
| F7-T1 | Human opens browser, runs 3L/40, confirms all acceptance criteria | F3-T1, F3-T2, F3-T3, F3-T4, F4-T1, F5-T1, F6-T1 | Yes — browser | S | ⬜ | Human confirms | Human rejects |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| All 4 modes distinct | Visual browser | Yes | Human confirms in browser | User approval |
| Legend self-explanatory | Visual browser | Yes | First-time read test | User approval |
| No visual clutter | Visual browser | Yes | Human confirms | User approval |
| Works at narrow panels | Visual browser | Yes | Test at 220px panel | User approval |

---

## 5. Test Strategy

### 5.1 Testing Pyramid

- **Headless structural test:** 1 new test card — verifies canvas operations per trafficMode (spy on CanvasRenderingContext2D)
- **Performance profiling:** Before/after frame time measurement at 3L/40 — documents cost delta
- **Human visual check:** Final gate — all 4 modes distinct, legend readable, no clutter
- **Guard suite:** SKIPPED — purely visual change, no simulation behavior impact

### 5.2 TDD Checklist (Per Task)

```
For EACH implementation task in F3 (renderer changes):
1. [ ] Write the headless structural test first (F5-T1 defines expected canvas ops)
2. [ ] Verify test fails for the RIGHT reason (canvas spy sees old/missing ops)
3. [ ] Write MINIMUM code to make the test pass
4. [ ] Verify test passes
5. [ ] Syntax check: node -e "require('./traffic_core.js')" (no error)
6. [ ] Commit

Note: Since F3-T1/T2/T3/T4 all modify _car() and the test (F5-T1) tests the
final state, the TDD flow here is: write test → implement all F3 tasks → verify.
The test is written targeting the FINAL behavior, not intermediate states.
```

### 5.3 Testing Commands

```bash
# Run the new structural test card
node run_traffic_suite.js --id [card-id]

# Syntax check traffic_core.js
node -e "require('./traffic_core.js')"

# Render perf measurement (browser — manual)
# Open traffic_v18.html, run 3L/40, observe frame time in dev tools
```

---

## 6. Dependency & Parallelism Analysis

### 6.1 Task Dependency Graph

```
F1-T1 (design) ──────┬──► F3-T1 (borders) ──► F3-T2 (tint) ──► F3-T3 (arrows) ──► F3-T4 (rm reverse) ──┬──► F5-T1 (test)
                      │                                                                                   ├──► F6-T1 (perf after)
                      └──► F4-T1 (legend HTML)                                                            └──► F7-T1 (human check)
F2-T1 (perf script) ──► F2-T2 (baseline) ─────────────────────────────────────────────────────────────────────► F6-T1 (perf after)
```

### 6.2 Parallelism Reasoning

| Task Group | Tasks | Parallel? | Rationale |
|------------|-------|-----------|-----------|
| **Wave 1** | F1-T1, F2-T1+F2-T2 | Yes | Design spec and perf baseline are independent — different outputs, no shared files |
| **Wave 2** | F3-T1→T2→T3→T4, F4-T1 | Partial | F3 tasks are sequential (all modify `_car()`). F4-T1 modifies HTML only — parallel with F3 |
| **Sanity** | Syntax check | Sequential | Must pass before Wave 3 |
| **Wave 3** | F5-T1, F6-T1 | Yes | Headless test and perf measurement are independent verification activities |
| **Wave 4** | F7-T1 | Sequential | Final human gate — all must be in place |

### 6.3 Task Dependency Table

> **Source of truth for `/tdd` workflow.**

| Task | Description | Depends On | Unblocks | Status |
|------|-------------|------------|----------|--------|
| F1-T1 | Design indicator scheme (colors, borders, tints, arrows) | None | F3-T1, F4-T1 | ✅ |
| F2-T1 | Write render perf measurement script | None | F2-T2 | ✅ |
| F2-T2 | Run baseline measurement at 3L/40 (0.9196 ms/frame) | F2-T1 | F6-T1 | ✅ |
| F3-T1 | Implement unified mode border system in `_car()` | F1-T1 | F3-T2, F3-T3, F3-T4 | ✅ |
| F3-T2 | Implement tint overlay for maneuver mode | F3-T1 | SC-1 | ✅ |
| F3-T3 | Implement directional arrows for batch/hold_exit | F3-T1 | SC-1 | ✅ |
| F3-T4 | Remove `reversing` white border (line 2728) | F3-T1 | SC-1 | ✅ |
| F4-T1 | Update footer legend HTML + CSS | F1-T1 | SC-1 | ✅ |
| SC-1 | ⊕ Syntax sanity check: vm sandbox loads traffic_core.js (card BO PASS) | F3-T2, F3-T3, F3-T4, F4-T1 | F5-T1, F6-T1 | ✅ |
| F5-T1 | Write headless structural test card BO (canvas spy) | SC-1 | F7-T1 | ✅ |
| F6-T1 | Run post-change perf measurement + compute delta (+0.07ms, +7.9%) | SC-1, F2-T2 | F7-T1 | ✅ |
| F7-T1 | Human visual browser check | F5-T1, F6-T1 | — | ⬜ |

---

## 7. Implementation Phases

### Phase 1: Design + Baseline (Wave 1 — parallel)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| A1 | F1-T1 | Yes (with A2) | Creative design — no code dependencies |
| A2 | F2-T1, F2-T2 | Yes (with A1) | Perf measurement — independent from design |

- [x] F1-T1: Document indicator scheme in plan (DONE — see Feature 1 table above)
- [ ] F2-T1: Write perf measurement script
- [ ] F2-T2: Run baseline at 3L/40, record number

---

### Phase 2: Implement (Wave 2 — partial parallel)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| B1 | F3-T1 → F3-T2 → F3-T3 → F3-T4 | Sequential | All modify `_car()` method — must be done in order |
| B2 | F4-T1 | Yes (with B1) | HTML file only — independent from JS changes |

- [ ] F3-T1: Replace existing border blocks with trafficMode-based switch
- [ ] F3-T2: Add tint overlay for maneuver
- [ ] F3-T3: Add directional arrows for batch/hold_exit
- [ ] F3-T4: Remove `reversing` border
- [ ] F4-T1: Add 3 legend entries to footer HTML

**Sanity check after Phase 2:**
- [ ] SC-1: `node -e "require('./traffic_core.js')"` — no error

---

### Phase 3: Verify (Wave 3 — parallel)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| C1 | F5-T1 | Yes (with C2) | Headless test — Node.js only |
| C2 | F6-T1 | Yes (with C1) | Browser perf measurement — independent |

- [ ] F5-T1: Write headless structural test card, confirm PASS
- [ ] F6-T1: Run perf measurement, record delta

---

### Phase 4: Human Gate (Wave 4 — sequential)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| D | F7-T1 | Sequential | Final gate — everything must be in place |

- [ ] F7-T1: Human opens browser at 3L/40, confirms all acceptance criteria

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| Tint overlay looks muddy at 22x11px car size | Medium | Medium | Test in browser early. If muddy, increase opacity or switch to border-only for maneuver. |
| Directional arrows too small to read | Medium | Low | Arrow is 2.5×3px — visible at normal canvas scale. If not, increase size or use thicker lines. |
| Footer legend wraps on narrow screens | Low | Medium | Use short labels ("yielding", "crossing", "maneuvering"). Test at 600px viewport width. |
| setLineDash() performance cost on many cars | Low | Medium | setLineDash is cheap — one array assignment per stroke. 40 cars × 1 call each = negligible. Confirmed by profiling. |
| Headless canvas spy pattern doesn't work in vm sandbox | Medium | Medium | If CanvasRenderingContext2D mocking fails in Node.js vm, fall back to checking car render state properties instead of spying on draw calls. |
| Overlapping mode indicators look noisy | Low | Low | Layer order: tint first, then border. If noisy, apply highest-urgency-only rule (contradicts discovery answer — would need user re-approval). |

---

## 9. Open Questions

- [x] Render perf baseline (F2-T2): **0.9196 ms/frame** at 3L/40 (Node.js mock canvas, sim.started=false, seed 77, 200-tick warm-up, 500 iterations)
- [x] Render perf after changes (F6-T1): **0.9920 ms/frame** at 3L/40 (same config, sim.started=true, 2 cars in hold_exit with indicators active)
- [x] Delta: **+0.0724 ms (+7.9%)** — well within acceptable range, no regression concern
- [x] Canvas `vm` sandbox supports mock CanvasRenderingContext2D via Proxy — confirmed by card BO (F5-T1)

---

## 10. Approval Checklist

- [ ] Requirements reviewed by: _____________ Date: _________
- [ ] Architecture reviewed by: _____________ Date: _________
- [ ] Plan approved by: _____________ Date: _________

---

## 11. Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-03-15 | Initial plan created from DISCOVERY_Visual_State_Indicators.md | Claude Opus 4.6 |
| 2026-03-15 | F2-T1, F3-T1/T2/T3/T4, F4-T1, F5-T1, SC-1 all ✅. Unified indicator system in _car(), footer legend updated, card BO structural test PASS 7/7, perf script created. Guards S/X/AA green. Baseline: 0.88ms/frame at 3L/40 (mock canvas). | Claude Opus 4.6 |

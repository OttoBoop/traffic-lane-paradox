# Discovery: Visual State Indicators

**Status:** Complete
**Date Started:** 2026-03-15
**Date Completed:** 2026-03-15
**Categories Completed:** 9/9
**Parent Plan:** [PLAN_Maneuver_Conflict_Overhaul.md](PLAN_Maneuver_Conflict_Overhaul.md) (Feature 4)

---

## Pre-Discovery Research (Current State Summary)

### Current Car Rendering (`_car()`, traffic_core.js:2719-2737)

| Visual | Trigger | Implementation |
|--------|---------|----------------|
| Car body fill | Always | Rounded rect, `car.color` (gold=left, blue=right) |
| Red border stroke | `car.zoneYielding` | `#ff4444`, 0.8px |
| Orange border stroke | `car.maneuvering` | `#ffaa00`, 1px |
| White border stroke | `car.reversing` | `#ffffff`, 0.8px |
| Pulsing opacity | Slow car on main seg | `0.5 + 0.5 * sin(Date.now()/200)` |
| Blinker light | `car.blinker !== 0` | Orange rect, pulsing alpha |
| Headlights | Always | White rects at front |
| Brake lights | Speed < 1.0, started | Red rects at rear |
| Reverse lights | Speed < 0 | White rects at rear |

### Current Footer Legend (traffic_v18.html:432-433)

```html
<div class="ftr">
  <span><span class="dt dl"></span>wants left</span>
  <span><span class="dt dr"></span>wants right</span>
  <span>bicycle - cone detection - reservations - blinkers</span>
</div>
```

Two colored dots: gold (#c48828) = wants left, blue (#2888c4) = wants right. Plus a text line listing sim features.

### Traffic Modes to Indicate

| Mode | Meaning | Current visual |
|------|---------|----------------|
| `yield` | Waiting for batch scheduler | Red border (via `zoneYielding`) |
| `batch` | Has its batch turn, crossing fork | None |
| `hold_exit` | Waiting to exit fork area | None |
| `maneuver` | 4-phase wobble resolving gridlock | Orange border (via `maneuvering`) |
| `free` | Normal driving | None (plain) — stays plain |
| `commit` | Committed to lane change | None (plain) — stays plain |

### Constraint from Parent Plan

- No car fill color changes allowed
- Use existing Ren class animation patterns (blinking, transparency, borders)
- Design must be consistent with existing canvas 2D API usage

---

## 1. Core Requirements ✅ (Approved)

**Summary:** Visual state indicators are for the educational audience — helping viewers understand what each car is "thinking." All 4 active modes (yield, batch, hold_exit, maneuver) get a complete redesign from scratch for visual consistency, replacing the existing ad-hoc red/orange borders. The design uses a mix of visual channels (border color + one other cue like dashed lines) with urgency-scaled intensity (maneuver loudest, batch subtlest). The footer legend extends the existing single row with new dot+label pairs. Success criteria: no visual clutter, self-explanatory legend, readable at all panel sizes (including 220px narrow). "Instant recognition without legend" is NOT required — the legend teaches; the indicators reinforce.

### Q&A Exchange

**Q1: What is the primary goal of the visual state indicators?**
> Educational audience — viewers should understand what each car is "thinking" (why it stopped, why it's wobbling, etc.). Readability at a glance is key.

**Tags:** [Core]

**Q2: Should we keep existing border visuals or redesign all four modes?**
> Redesign all four — start fresh with a unified visual language for all 4 modes so they feel coherent together.

**Tags:** [Core], [Functional]

**Q3: How prominent should the footer legend be?**
> Same row, extend existing — add mode indicators to the existing footer row. Keep it compact, just add more dot+label pairs.

**Tags:** [Core], [Functional]

**Q4: What does success look like?**
> Three criteria (multi-select):
> 1. No visual clutter — indicators don't make the simulation look busy or distracting
> 2. Legend is self-explanatory — first-time viewer reads footer and immediately understands
> 3. Works at all panel sizes — indicators readable even in narrow/small panels (220px wide)
>
> Note: "Instant recognition without legend" was NOT selected — the legend is the primary teaching tool, not the indicators alone.

**Tags:** [Core], [Non-Functional], [Testing]

**Q5: Which visual channel for distinguishing 4 modes?**
> Mix of channels — combine border color with one other channel (e.g., border color + dashed for one mode). Best of both worlds.

**Tags:** [Core], [Functional]

**Q6: Should visual intensity reflect urgency?**
> Yes, urgency-scaled — maneuver (gridlock!) is the most visually prominent. Yield and hold_exit are moderate. Batch (normal crossing) is the most subtle.

---

## 2. Functional Requirements ✅ (Approved)

**Summary:** Four modes get distinct visual stories: (1) yield = "waiting patiently" — calm, non-urgent. (2) maneuver = "emergency unstuck" — visually alarming, something is wrong. (3) batch = subtle, with a small arrow/chevron pointing toward the target branch. (4) hold_exit = also subtle with directional arrow, barely different from batch. The existing `reversing` white border is folded into the maneuver indicator. The slow-car pulsing animation stays independent as a speed cue. Headlights, brake lights, and reverse lights at rear remain unchanged.

### Q&A Exchange

**Q1: What story should yield mode communicate?**
> "Waiting patiently" — the car is stopped/slow because it's politely letting others go first. Calm, non-urgent visual.

**Tags:** [Functional], [Core]

**Q2: What story should maneuver mode communicate?**
> "Emergency unstuck" — the car is doing something unusual/desperate to free itself. Visually alarming — something is wrong.

**Tags:** [Functional], [Core]

**Q3: How should batch and hold_exit differ visually?**
> Both very subtle, barely different. But: add a visual specific to whether the car is moving to a left or right lane. Direction matters more than the mode distinction for these two.

**Tags:** [Functional], [Core], [Non-Functional]

**Q4: What directional cue for batch/hold_exit?**
> Small arrow/chevron — a tiny arrow (< or >) drawn near the car body pointing toward the target branch. Clear but adds a drawn element.

**Tags:** [Functional]

**Q5: Should the slow-car pulsing animation stay?**
> Keep as-is — the slow-car opacity pulse stays independent of traffic mode indicators. It's a speed cue, not a mode cue.

**Tags:** [Functional], [Non-Functional]

**Q6: Should the `reversing` white border stay separate or fold into maneuver?**
> Fold into maneuver — reversing is part of maneuver wobble. The maneuver indicator already covers it. No separate reverse border needed. (White reverse lights at rear stay.)

**Tags:** [Functional], [Constraints]

---

## 3. Non-Functional Requirements ✅ (Approved)

**Summary:** Performance is a major concern — any visual additions must have their render cost tracked and profiled (connects to parent plan's perf work). Indicators stay constant at all panel sizes (canvas scaling handles it). Indicators only appear after the sim starts (pre-start cars stay plain).

### Q&A Exchange

**Q1: How important is render performance?**
> Optimization is a major issue. Track the performance loss from any additions. (Not "don't worry" — measure the cost.)

**Tags:** [Non-Functional], [Testing], [Constraints]

**Q2: Should indicators degrade at small panel sizes?**
> Constant — same at all sizes. Canvas scaling handles it.

**Tags:** [Non-Functional]

**Q3: Should indicators show during pre-start state?**
> Only when running — mode indicators appear only after Play is pressed. Before that, cars are plain.

**Tags:** [Non-Functional], [Functional]

---

## 4. Constraints & Boundaries ✅ (Approved)

**Summary:** The parent plan's "no car fill color changes" is relaxed — subtle semi-transparent tint overlays are allowed as long as base gold/blue stays clearly visible. File scope is unrestricted. `car.reversing` property stays as data; only its separate border visual is removed. Bicycle model constraint and vanilla JS/no dependencies remain unchanged.

### Q&A Exchange

**Q1: Does the "no car fill color changes" constraint still hold?**
> Relaxed — allow subtle tint overlay (e.g., 10% red tint for maneuver) on top of the car body, as long as the base gold/blue remains clearly visible. This overrides the parent plan's hard "no fill color changes" rule.

**Tags:** [Constraints], [Core], [Functional]

> **UPDATE to Core Q2:** The parent plan's "no car fill color changes" is now relaxed to "no fill color REPLACEMENT — subtle overlays OK." Core summary may need re-check.

**Q2: File scope?**
> Whatever's needed — don't restrict to specific files. If other files need changes (red_visual_tests.html, test cards, etc.), do it.

**Tags:** [Constraints]

**Q3: Should car.reversing property be cleaned up?**
> Keep the property — car.reversing stays as data. Just stop drawing a separate border for it. It may be useful for other logic.

**Tags:** [Constraints], [Functional]

---

## 5. Edge Cases & Error Handling ✅ (Approved)

**Summary:** Mode transitions are instant (no animation — saved for future). When modes overlap (e.g., maneuvering + zoneYielding simultaneously), layer both indicators. Done cars are filtered from rendering — not applicable.

### Q&A Exchange

**Q1: Mode transition visual — instant or animated?**
> Instant switch for the first pass. Animated transitions saved for future ideas.

**Tags:** [Edge Cases], [Future Plans]

**Q2: Multiple overlapping modes — which takes priority?**
> Layer both — show both indicators simultaneously (e.g., maneuver border + yield tint). More info, accept risk of visual noise.

**Tags:** [Edge Cases], [Functional]

**Q3: Done cars?**
> Not applicable — done cars are already filtered out of the render list. They never draw. Skipped.

**Tags:** [Edge Cases] — Skipped: done cars never render

---

## 6. Testing & Acceptance ✅ (Approved)

**Summary:** Three test types: (1) human visual browser check at 3L/40, (2) render perf profiling with before/after frame time delta, (3) headless structural test verifying canvas ops per trafficMode. Human gate after implementation only. Done when: all 4 modes visually distinct, footer legend updated, no render perf regression. Guard suite skipped — purely visual.

### Acceptance Criteria Table

| Feature | Test Type | Human Needed? | Done When |
|---------|-----------|---------------|-----------|
| Yield indicator | Visual browser + headless structural | Yes — after impl | Distinct visual in browser, canvas ops verified |
| Batch indicator + arrow | Visual browser + headless structural | Yes — after impl | Arrow visible, direction correct |
| Hold_exit indicator + arrow | Visual browser + headless structural | Yes — after impl | Distinct from batch, direction correct |
| Maneuver indicator | Visual browser + headless structural | Yes — after impl | Most prominent indicator, clearly alarming |
| Footer legend | Visual browser | Yes — after impl | Dot+label pairs for all 4 modes in existing row |
| Render performance | Profiling | Yes — review delta | Frame time delta documented, no significant regression |

### Q&A Exchange

**Q1: What type of testing for visual indicators?**
> Three types (multi-select):
> 1. Human visual browser check — run 3L/40, confirm each mode visible and distinct
> 2. Render performance profiling — measure frame time before/after, report cost delta
> 3. Headless structural test — Node.js test verifying _car() calls specific canvas ops when trafficMode is set

**Tags:** [Testing], [Non-Functional]

**Q2: At which points must you verify?**
> After implementation — see it running in browser, before calling it done. Design mockup approval NOT required (trust the implementation).

**Tags:** [Testing]

**Q3: What conditions for DONE?**
> Three conditions (multi-select):
> 1. All 4 modes visually distinct in browser
> 2. Footer legend updated with new dot+label pairs
> 3. No render perf regression (frame time at 3L/40 doesn't regress significantly)
>
> Note: "Guard tests still green" was NOT selected — presumably because this is a renderer-only change with no sim behavior impact. However, guard tests should still be run as a sanity check.

**Tags:** [Testing], [Non-Functional], [Functional]

**Q4: Run guard tests as sanity check?**
> Skip guards — this is purely visual, guards test simulation behavior. No need to run them.

**Tags:** [Testing], [Constraints]

---

## 7. Other / Notes ✅ (Approved)

**Summary:** No extra notes or stray thoughts. All requirements captured in earlier categories.

### Q&A Exchange

**Q1: Any stray thoughts or notes?**
> No extra notes — everything has been captured. Move on.

**Tags:** [Other]

---

## 8. Future Plans ✅ (Approved)

**Summary:** Two future items for the IDEAS doc: (1) Animated mode transitions — smooth fade between indicator states on mode change. (2) Interactive hover/tooltip — hover over a car to see its full state info (trafficMode, speed, target, noProgressTicks, etc.).

### Q&A Exchange

**Q1: Future plan items?**
> Two items (multi-select):
> 1. Animated transitions — smooth fade between mode indicator states (yield→batch etc.)
> 2. Interactive hover/tooltip — hover over a car to see full state info

**Tags:** [Future Plans]

---

## 9. Parallelism Analysis ✅ (Approved)

**Summary:** 4 waves. Wave 1: design scheme + baseline perf measurement (parallel). Wave 2: implement all renderer changes (T2/T3/T5 sequential in _car(), T4 parallel on HTML). Quick syntax sanity check between Wave 2 and 3. Wave 3: headless structural test + post-change perf measurement (parallel). Wave 4: human visual browser check.

### Q&A Exchange

**Task list (confirmed complete):**

| # | Task |
|---|------|
| T1 | Design unified indicator scheme (colors, borders, tints, arrow shapes for all 4 modes) |
| T2 | Implement indicator rendering in `Ren._car()` |
| T3 | Implement directional arrows for batch/hold_exit |
| T4 | Update footer legend in `traffic_v18.html` |
| T5 | Remove separate `reversing` border visual (fold into maneuver) |
| T6 | Write headless structural test |
| T7 | Measure render performance before/after |
| T8 | Human visual browser check |

**Dependency table:**

| Task | Dependencies | Reasoning |
|------|-------------|-----------|
| T1 | None | Creative design — root task |
| T7-baseline | None | Measure BEFORE changes — root task |
| T2 | T1 | Needs design decisions |
| T3 | T1 | Arrow style from T1 |
| T5 | T1 | Part of unified redesign |
| T4 | T1 | Legend dots match indicator colors |
| T6 | T2, T3, T5 | Tests verify implementation |
| T7-after | T2, T3, T5 | Measure AFTER renderer changes |
| T8 | All | Final human gate |

**Wave structure:**

```
📦 Wave 1 — Design + Baseline (parallel)
   T1: Design indicator scheme
   T7-baseline: Measure current render frame time at 3L/40
   Why: Independent — design is creative, baseline is measurement

📦 Wave 2 — Implement (T2→T3→T5 sequential, T4 parallel)
   T2+T3+T5: All modify _car() — sequential within the method
   T4: HTML only — parallel with renderer changes
   Why: T2/T3/T5 touch same function; T4 is independent file

   Quick syntax sanity check: node loads traffic_core.js + traffic_v18.html without error

📦 Wave 3 — Verify (parallel)
   T6: Headless structural test
   T7-after: Post-change render perf measurement
   Why: Independent verification activities

📦 Wave 4 — Human gate
   T8: Human visual browser check at 3L/40
   Why: Everything must be in place for visual review
```

**Dependency graph:**
```
T1 (design) ──────┬──► T2 (indicators) ──► T3 (arrows) ──► T5 (remove reverse) ──┬──► T6 (test)
                   │                                                                ├──► T7-after (perf)
                   └──► T4 (legend HTML)                                            └──► T8 (human check)
T7-baseline ───────────────────────────────────────────────────────────────────────────► T7-after
```

**Tags:** [Parallelism]

---

## Reliability Evidence

### Gap Matrix

| Capability | Intended behavior | Actual implementation | Observed artifact evidence | Verdict |
|------------|-------------------|-----------------------|----------------------------|---------|
| Yield visual indicator | Distinct calm visual (border + possible tint) | Red border stroke via `zoneYielding` (line 2726) | Visible in browser — confirmed in code read | Exists but will be redesigned |
| Batch visual indicator | Subtle indicator + directional arrow | None — no visual for batch mode | N/A | Missing — to be created |
| Hold_exit visual indicator | Subtle indicator + directional arrow | None — no visual for hold_exit | N/A | Missing — to be created |
| Maneuver visual indicator | Prominent "emergency" visual (border + tint) | Orange border via `maneuvering` (line 2727) | Visible in browser — confirmed in code read | Exists but will be redesigned |
| Footer legend | Dot+label pairs for all 4 modes | Only direction dots (left/right) | Visible in browser (line 432) | Exists for direction, missing for modes |
| Render perf tracking | Before/after frame time measurement | No renderer-specific profiler | N/A | Missing — to be created |

### Live-Proof Status

- `_car()` method confirmed at line 2719 — all current visuals verified by code read
- Footer legend confirmed at traffic_v18.html:432 — structure verified
- No render performance baseline exists yet — to be measured in Wave 1

### Tool Inventory

**Required and proven:**
- `traffic_core.js` `Ren._car()` — canvas 2D car rendering method (confirmed)
- `traffic_v18.html` — main simulator page with footer legend (confirmed)
- `run_traffic_suite.js` — headless test runner (confirmed)
- Browser dev tools — frame time measurement (available)

**Required but missing/unproven:**
- Render-specific performance profiler (no tool to measure frame time programmatically)
- Headless test for canvas operations (no existing test pattern for renderer verification)

**Deferred:**
- Animated mode transitions (Future Plans)
- Interactive hover/tooltip (Future Plans)

### Unresolved Evidence Risks

1. **Render perf baseline missing:** No measurement of current _car() frame time exists. Baseline must be captured in Wave 1 before any changes.
2. **Headless canvas testing pattern unknown:** No existing test verifies canvas draw calls. The headless test (T6) will need to mock or spy on CanvasRenderingContext2D methods — pattern to be designed during implementation.
3. **Tint overlay visual quality untested:** Semi-transparent overlays on small cars (22x11px) may look muddy or invisible. Only verifiable in browser (T8).

---

## Connection Map

| Answer | Affects Categories | Notes |
|--------|-------------------|-------|
| Redesign all four modes (not incremental) | Core, Functional, Testing | Existing red/orange borders will be replaced — need to verify no test relies on specific stroke colors |
| Urgency-scaled visual intensity | Core, Functional, Non-Functional | Maneuver = max prominence, batch = most subtle. Affects both car rendering AND legend ordering |
| Mix of visual channels (border color + one other) | Functional, Constraints | Must work with canvas 2D API only. Dashed strokes are available via `setLineDash()` |
| Legend extends existing footer row | Functional, Non-Functional | Must fit in single row alongside "wants left"/"wants right" without wrapping on narrow screens |
| Batch/hold_exit should show direction (left/right) | Functional, Core | New requirement: directional visual for quieter modes. Connects to existing car.color (gold=left, blue=right) and car.target |
| Performance loss from indicators must be tracked | Non-Functional, Testing, Constraints | Connects to parent plan's perf work (P1-P7). Need before/after profiler measurement for render cost |

---

## Completeness Score

```
Completeness Score: 6/6 gates passed
- G1: ✅ All categories covered (9/9)
- G2: ✅ All summaries approved (9/9)
- G3: ✅ Testing questions complete (6 features × 3 mandatory questions each)
- G4: ✅ Connection map entries (6 ≥ 3)
- G5: ✅ No pending re-approvals
- G6: ✅ Reliability evidence complete (gap matrix, live-proof, tool inventory, risks)
```

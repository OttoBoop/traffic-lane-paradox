# City & Nature Background Theme — Implementation Plan

**Generated:** 2026-03-14
**Status:** Draft
**Discovery:** [DISCOVERY_City_Nature_Background.md](DISCOVERY_City_Nature_Background.md)

---

## 1. Executive Summary

Add a third visual theme ("Cidade & Natureza") to the Traffic Lane Paradox simulator: urban houses on the left, farmland grading into dense forest on the right, with tree clusters filling the V-area between fork branches. Build a theme selector dropdown so users can switch between Classic, Rio Satellite, and City & Nature mid-simulation. Introduce an offscreen buffer to pre-render the static background once per load/resize, avoiding per-frame overhead.

---

## 2. Requirements Summary

### 2.1 Problem Statement

The simulator has two visual themes (classic dark, Rio satellite) but no user-switchable selection and no third option. Leo Bloise proposed a "city on one side, nature on the other" look that better communicates the road-as-focus principle. Currently themes are hardcoded per page with no runtime switching.

### 2.2 Target Users

Public simulator page visitors — anyone exploring the traffic lane paradox demonstration in a browser.

### 2.3 Success Criteria

- [ ] Leo approves the visual look in browser
- [ ] Theme switching works mid-simulation (all 3 themes) without resetting the sim
- [ ] Scene elements never overlap the road surface
- [ ] Offscreen buffer correctly invalidates on resize and theme switch
- [ ] Houses scale proportionally on narrow (1-lane mobile) canvases

### 2.4 Explicitly Out of Scope

- Animated background elements (swaying trees, smoke, water ripples)
- Additional themes beyond the initial 3 (desert, snow, night — tracked in IDEAS)
- Isometric or 3D perspective — strictly top-down
- Road color/texture changes — road rendering stays identical to classic
- Any changes to `Road`, `Sim`, collision, wall, or legality behavior

### 2.5 Evidence of Readiness

- [ ] Theme selector dropdown visible in `.ctrls` area with 3 options
- [ ] `_sceneCityNature()` renders houses, trees, farms, ground zones on offscreen buffer
- [ ] Switching themes mid-sim re-renders background without sim reset
- [ ] Reference screenshots at 1L, 2L, 3L show correct rendering
- [ ] Human confirms visual quality in browser

---

## 3. Technical Architecture

### 3.1 System Overview

```
traffic_v18.html
  └── .ctrls area
        └── Theme <select> (new)  ──► updates all Ren instances' theme

traffic_core.js
  └── RENDER_THEMES
        ├── classic          (existing, lines 46-59)
        ├── rioSatellite     (existing, lines 60-94)
        └── cityNature       (NEW — palette + scene:'city_nature')
  └── Ren class
        ├── draw()           (modified — dispatch to scene by theme.scene)
        ├── _scene()         (existing — Rio satellite)
        ├── _sceneCityNature()  (NEW — houses, trees, farms, ground)
        ├── _offscreenBuf    (NEW — cached canvas for static background)
        ├── _treeCluster()   (REUSE — organic grouped canopies)
        ├── _roundRectPath() (REUSE — rounded rectangles)
        └── _sceneMetrics()  (REUSE — road-derived bounds)
```

### 3.2 Data Flow

```
Page load / Resize / Theme switch:
  1. Ren._offscreenBuf invalidated (set to null)
  2. On next draw(), offscreen canvas created at current size
  3. Ground zones painted (gray left, green right)
  4. Farm details drawn (crop rows, fences on right side)
  5. Houses placed randomly (left side, avoiding road polygon)
  6. Tree clusters placed (right side + V-area, using _treeCluster())
  7. Buffer stored as this._offscreenBuf

Each animation frame:
  1. ctx.drawImage(this._offscreenBuf, 0, 0)  ← O(1) stamp
  2. Road, stop line, cars drawn on top (unchanged)
```

### 3.3 Technology Decisions

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Scene rendering | Canvas 2D API | Existing stack, no dependencies |
| Offscreen buffer | `document.createElement('canvas')` | Standard API, avoids per-frame redraw |
| Theme selector | HTML `<select>` in `.ctrls` | Consistent with existing control pattern |
| Tree rendering | Existing `_treeCluster()` | Proven in Rio theme, reusable |
| House rendering | New `_drawHouse()` helper | Simple rectangles + roof + optional yard |

### 3.4 Integration Points

- `RENDER_THEMES` object (lines 45-95 of `traffic_core.js`) — add `cityNature` entry
- `Ren.draw()` (line 2022 of `traffic_core.js`) — extend scene dispatch beyond `rio_satellite`
- `traffic_v18.html` line 463 — change hardcoded `{ theme: 'rioSatellite' }` to use selector value
- `.ctrls` div (lines 415-424 of `traffic_v18.html`) — add `<select>` element

### 3.5 Output and Failure Contracts

| Artifact or State | Owner | Proof Required | Blocked If |
|-------------------|-------|----------------|------------|
| `RENDER_THEMES.cityNature` config | `traffic_core.js` | Object exists with `scene: 'city_nature'` + all color keys | Missing color keys cause undefined fills |
| `_sceneCityNature()` method | `Ren` class | Renders visible background on offscreen canvas | Method doesn't exist or throws |
| Offscreen buffer | `Ren._offscreenBuf` | `drawImage()` succeeds; invalidates on resize/theme switch | Buffer stale after resize or theme change |
| Theme selector UI | `traffic_v18.html` | `<select>` visible in `.ctrls`, changes all renderers | Hardcoded theme in HTML |
| No road overlap | `_sceneCityNature()` | All element placements respect `rd.cx ± rd.halfW()` | Any house/tree drawn inside road polygon |
| Human approval | Browser visual check | Leo or user confirms look | Visual doesn't match Leo's vision |

---

## 4. Feature Breakdown

---

### Feature 1: Theme Configuration

**User Story:** As a developer, I want the City & Nature color palette registered in `RENDER_THEMES` so the renderer can reference it.

**Acceptance Criteria:**
- [ ] `RENDER_THEMES.cityNature` exists with `scene: 'city_nature'`
- [ ] Contains all required color keys: ground colors (gray, green), house colors (4+ warm earthy tones), farm colors, forest colors, plus all road/stop/queue colors inherited from classic

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F1-T1 | Add `cityNature` entry to `RENDER_THEMES` with full color palette | None | No | S | ⬜ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Config object has all required keys | Unit (Node.js) | No | `RENDER_THEMES.cityNature.scene === 'city_nature'` + no undefined colors | Test card or inline assertion |

---

### Feature 2: Theme Selector UI

**User Story:** As a viewer of the simulation, I want to pick between Classic, Rio Satellite, and Cidade & Natureza from a dropdown so I can see the theme I prefer.

**Acceptance Criteria:**
- [ ] `<select>` element visible in `.ctrls` area with 3 options
- [ ] Display names: "Clássico", "Rio Satélite", "Cidade & Natureza"
- [ ] Changing selection updates all `Ren` instances' `this.theme` immediately
- [ ] No simulation reset on theme change
- [ ] Offscreen buffer invalidated on theme change

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F2-T1 | Add `<select id="themeSelect">` to `.ctrls` in `traffic_v18.html` with 3 options | None | No | S | ⬜ |
| F2-T2 | Wire `change` event: update all `Ren` instances' theme + invalidate buffer | F2-T1, F1-T1 | Yes — manual toggle test | S | ⬜ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Dropdown renders with 3 options | Manual browser check | Yes | Select visible in `.ctrls` | Browser screenshot |
| Theme switch doesn't reset sim | Manual: toggle mid-sim | Yes | Cars continue moving, positions unchanged | Browser observation |

---

### Feature 3: City & Nature Scene Renderer

**User Story:** As a viewer, I want to see an urban neighborhood on the left and farmland/forest on the right of the road, so the simulation feels like a real place.

**Acceptance Criteria:**
- [ ] Left side: gray ground with houses (top-down rectangles, colored roofs, warm earthy tones, mixed yards)
- [ ] Right side: green ground with light farm details (crop rows/fences) below fork, trees above
- [ ] V-area (between branches): dense forest via `_treeCluster()`
- [ ] Elements have Leo's tileset-style shadows (slight shadow offset, mild 3D feel)
- [ ] Medium density — suburban feel, not sparse or packed
- [ ] Random placement each page load (no seeding)
- [ ] No element overlaps the road surface
- [ ] Houses scale proportionally on narrow canvases (1-lane mobile)

**Technical Details:**
- New method `Ren.prototype._sceneCityNature = function(rd, w, h, bufCtx) { ... }`
- Uses `_sceneMetrics(rd, w, h)` for road-derived bounds (reuse existing helper)
- Uses `_treeCluster()` for forest areas (reuse existing helper)
- New internal helper `_drawHouse(ctx, x, y, w, h, roofColor, wallColor, hasYard)` for house rectangles
- Element placement uses `rd.cx`, `rd.halfW()`, branch edge sampling to avoid road overlap
- House size scaled by `Math.min(1, availableWidth / BASE_HOUSE_WIDTH)` for narrow canvases

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F3-T1 | Implement `_sceneCityNature()`: ground zones (gray left, green right) | F1-T1 | No | S | ⬜ |
| F3-T2 | Implement house rendering: `_drawHouse()` helper + random placement on left side | F3-T1 | No | M | ⬜ |
| F3-T3 | Implement farm details (right side) + tree clusters (right + V-area) | F3-T2 | No | M | ⬜ |
| F3-T4 | Add shadow/depth to houses and trees (Leo's tileset style) | F3-T3 | No | S | ⬜ |
| F3-T5 | Implement narrow-canvas house scaling | F3-T2 | No | S | ⬜ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| No element overlaps road | Automated: check placements vs `rd.cx ± rd.halfW()` | No | Zero placements inside road bounds | Test assertion |
| Houses scale on narrow canvas | Manual: test at 1-lane | Yes | Houses visible but smaller | Browser screenshot at 1L |
| Visual quality matches Leo's vision | Human visual gate | Yes — Leo confirms | Leo approves | Browser screenshot sent to Leo |

---

### Feature 4: Offscreen Buffer

**User Story:** As a viewer, I want the background to render efficiently so the simulation stays smooth even with many cars.

**Acceptance Criteria:**
- [ ] Static background drawn once to offscreen canvas, stamped per frame via `drawImage()`
- [ ] Buffer invalidated and regenerated on: page load, window resize, theme switch, lane count change
- [ ] `Ren.draw()` dispatches to correct scene method based on `this.theme.scene`

**Technical Details:**
- Add `this._offscreenBuf = null` to `Ren` constructor
- In `draw()`, check if `this._offscreenBuf` is null or dimensions changed → regenerate
- Regeneration: create hidden canvas at same size, call scene method with buffer's context
- Stamp: `ctx.drawImage(this._offscreenBuf, 0, 0)` before road/cars
- Invalidation: set `this._offscreenBuf = null` on theme change and resize
- Extend `draw()` dispatch: `'rio_satellite'` → `_scene()`, `'city_nature'` → `_sceneCityNature()`, `'classic'` → no scene

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F4-T1 | Add offscreen buffer creation/invalidation to `Ren` class | F3-T3 | No | M | ⬜ |
| F4-T2 | Modify `draw()` to stamp buffer + dispatch by `theme.scene` | F4-T1 | No | S | ⬜ |
| F4-T3 | Wire buffer invalidation into theme switch handler and resize | F4-T2, F2-T2 | Yes — manual resize test | S | ⬜ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Buffer regenerates on resize | Manual: resize browser window | Yes | Background redraws correctly after resize | Browser observation |
| Buffer regenerates on theme switch | Manual: toggle themes | Yes | Background changes immediately on selection | Browser observation |
| Rio theme still works via buffer | Manual: select Rio, confirm scene renders | Yes | Rio scene identical to pre-change | Browser observation |

---

### Feature 5: Visual Verification

**User Story:** As a developer, I want reference screenshots to verify the theme renders correctly across lane counts.

**Acceptance Criteria:**
- [ ] Screenshots captured at 1L, 2L, 3L with City & Nature theme
- [ ] Leo or user confirms visual quality in browser
- [ ] All 3 themes render correctly after all changes

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F5-T1 | Capture reference screenshots at 1L, 2L, 3L | F4-T3 | Yes | S | ⬜ |
| F5-T2 | Human visual gate: Leo/user confirms in browser | F5-T1 | Yes — mandatory | S | ⬜ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Visual quality across lane counts | Screenshot comparison + human review | Yes | Screenshots look correct; Leo approves | Screenshot files + Leo's confirmation |
| All 3 themes work | Manual: cycle through all themes | Yes | Classic, Rio, City & Nature all render | Browser observation |

---

## 5. Test Strategy

### 5.1 Testing Pyramid

- **Unit Tests:** Minimal — verify `RENDER_THEMES.cityNature` config object has required keys
- **Integration Tests:** Not applicable — this is a rendering feature
- **Visual Tests:** Primary verification method — screenshots at 1L/2L/3L + human review
- **Manual Tests:** Theme switching, resize, narrow canvas scaling

### 5.2 TDD Checklist (Per Task)

```
For visual rendering tasks, TDD is adapted:
1. [ ] Define what the output should look like (acceptance criteria)
2. [ ] Write the rendering code
3. [ ] Open in browser and verify visually
4. [ ] Run guard tests (S, X, AA) to confirm no sim regression
5. [ ] Capture screenshot for reference
6. [ ] Human confirms visual quality
```

Note: Traditional RED/GREEN TDD applies to the config and wiring tasks (F1-T1, F2-T1, F2-T2, F4-T1, F4-T2). Scene rendering tasks (F3-*) are visual and verified by human review.

### 5.3 Testing Commands

```bash
# Run existing guard tests (confirm no sim regression)
node run_traffic_suite.js --id S --id X --id AA

# Open main simulator in browser
# (navigate to traffic_v18.html, use theme dropdown)

# Capture screenshots (manual: browser dev tools or screenshot tool)
```

---

## 6. Dependency & Parallelism Analysis

### 6.1 Task Dependency Graph

```
F1-T1 (palette) ──────────────────┐
                                   ├──► F3-T1 (ground) ──► F3-T2 (houses) ──► F3-T3 (farms+trees)
F2-T1 (dropdown HTML) ──┐         │                                           │
                         ├──► F2-T2│(wire handler)                   F3-T4 (shadows) ◄──┘
                         │         │                                    │
                         │         │    F3-T5 (narrow scaling) ◄── F3-T2
                         │         │
                         │         └──► F4-T1 (buffer create) ──► F4-T2 (buffer stamp) ──► F4-T3 (buffer invalidation)
                         │                                                                       │
                         └───────────────────────────────────────────────────────────────────────►┘
                                                                                                  │
                                                                                    F5-T1 (screenshots) ──► F5-T2 (human gate)
```

### 6.2 Parallelism Reasoning

| Task Group | Tasks | Parallel? | Rationale |
|------------|-------|-----------|-----------|
| **Wave 1** | F1-T1, F2-T1 | Yes | Config object and HTML dropdown are independent files |
| **Wave 2** | F3-T1→T2→T3→T4, F3-T5 | Mostly sequential | Scene layers build on each other; F3-T5 branches from F3-T2 |
| **Wave 3** | F4-T1→T2→T3, F2-T2 | Sequential | Buffer needs scene; wiring needs buffer + dropdown |
| **Wave 4** | F5-T1→T2 | Sequential | Screenshots then human review |

### 6.3 Task Dependency Table

> **Source of truth for `/tdd` workflow.**

| Task | Description | Depends On | Unblocks | Status |
|------|-------------|------------|----------|--------|
| F1-T1 | Add `cityNature` palette to `RENDER_THEMES` | None | F3-T1, F2-T2, F4-T1 | ⬜ |
| F2-T1 | Add theme `<select>` to `.ctrls` in HTML | None | F2-T2 | ⬜ |
| F2-T2 | Wire `change` event: update Ren theme + invalidate buffer | F2-T1, F1-T1 | F4-T3 | ⬜ |
| F3-T1 | `_sceneCityNature()`: ground zones (gray left, green right) | F1-T1 | F3-T2 | ⬜ |
| F3-T2 | House rendering: `_drawHouse()` + random placement | F3-T1 | F3-T3, F3-T5 | ⬜ |
| F3-T3 | Farm details + tree clusters (right + V-area) | F3-T2 | F3-T4, F4-T1 | ⬜ |
| F3-T4 | Shadow/depth on houses and trees (tileset style) | F3-T3 | MC-1 | ⬜ |
| F3-T5 | Narrow-canvas house scaling | F3-T2 | MC-1 | ⬜ |
| F4-T1 | Offscreen buffer creation/invalidation in `Ren` | F3-T3 | F4-T2 | ⬜ |
| F4-T2 | Modify `draw()`: stamp buffer + dispatch by `theme.scene` | F4-T1 | F4-T3 | ⬜ |
| F4-T3 | Wire buffer invalidation into theme switch + resize | F4-T2, F2-T2 | MC-1 | ⬜ |
| MC-1 | ⊕ All rendering + buffer + UI complete; guards green | F3-T4, F3-T5, F4-T3 | F5-T1 | ⬜ |
| F5-T1 | Capture reference screenshots at 1L, 2L, 3L | MC-1 | F5-T2 | ⬜ |
| F5-T2 | Human visual gate: Leo/user confirms in browser | F5-T1 | — | ⬜ |

---

## 7. Implementation Phases

### Phase 1: Config + UI Shell (Wave 1 — parallel)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| A | F1-T1, F2-T1 | Yes | Different files, no shared state |

- [ ] **F1-T1:** Add `cityNature` to `RENDER_THEMES` in `traffic_core.js` (after line 94). Include: `scene: 'city_nature'`, ground colors (`urbanGround: '#b8b4a8'`, `grassGround: '#7db356'`), house colors (4 warm earthy tones), farm colors, forest colors (`forest`/`forestAlt` from Rio or new values), plus all road/stop/queue colors (copy from classic).
- [ ] **F2-T1:** Add `<select id="themeSelect">` to `.ctrls` in `traffic_v18.html`. Three `<option>` elements: "Clássico" (value `classic`), "Rio Satélite" (value `rioSatellite`), "Cidade & Natureza" (value `cityNature`). Default selected: `rioSatellite` (current behavior).

---

### Phase 2: Scene Rendering (Wave 2 — sequential)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| B | F3-T1 → F3-T2 → F3-T3 → F3-T4 | Sequential | Each layer builds on the previous |
| B' | F3-T5 | After F3-T2 | Branches from house rendering |

- [ ] **F3-T1:** Implement `_sceneCityNature(rd, w, h, ctx)`. Draw ground zones: left of road center = gray (`urbanGround`), right = green (`grassGround`). Use `rd.cx` and `rd.halfW()` as road boundary. Above fork: split along branch edges.
- [ ] **F3-T2:** Implement `_drawHouse(ctx, x, y, w, h, roofColor, wallColor, hasYard, yardColor)`. Draw: yard patch (if `hasYard`), wall rectangle, roof stripe at top. Add to `_sceneCityNature`: randomly place 15-25 houses on left side, avoiding road polygon. Houses use warm earthy palette (beige `#f2e6d0`, terracotta `#c4785a`, light brown `#d4a574`, cream `#f5eed8`). Mixed yards: ~50% chance per house.
- [ ] **F3-T3:** Add farm details on right side below fork: subtle horizontal crop row lines (thin strokes, slightly darker green). Add tree clusters in V-area between branches using `_treeCluster()`. Add scattered trees on right side above farms.
- [ ] **F3-T4:** Add tileset-style shadows: each house gets a 2px shadow offset (darker color, drawn first). Tree clusters get a subtle shadow ellipse beneath. Not full drop-shadow — just offset fill.
- [ ] **F3-T5:** Scale house dimensions by `Math.min(1, (rd.cx - rd.halfW(0)) / 40)` — if available width left of road is less than 40px, shrink houses proportionally.

---

### Phase 3: Buffer + Wiring (Wave 3 — sequential)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| C | F4-T1 → F4-T2 → F4-T3, F2-T2 | Sequential | Buffer needs scene; wiring needs buffer |

- [ ] **F4-T1:** Add `this._offscreenBuf = null; this._bufW = 0; this._bufH = 0;` to `Ren` constructor. Add `_ensureBuffer(rd, w, h)` method: if buffer is null or dimensions changed, create `document.createElement('canvas')` at `(w, h)`, get its 2D context, call scene method with that context, store as `this._offscreenBuf`.
- [ ] **F4-T2:** Modify `draw()`: after clearing and filling canvas background, call `_ensureBuffer(rd, logicalW, logicalH)`. If buffer exists, `ctx.drawImage(this._offscreenBuf, 0, 0)`. Replace the `if (this.theme.scene === 'rio_satellite')` check with a dispatch: `'rio_satellite'` → `_scene()`, `'city_nature'` → `_sceneCityNature()`, `'classic'` → no scene. Rio theme also benefits from offscreen buffer.
- [ ] **F4-T3:** In theme switch handler (F2-T2's event listener): after updating `ren.theme`, set `ren._offscreenBuf = null`. On window `resize`: same invalidation. Ensure lane count changes (which trigger new `Sim`/`Ren` instances) naturally get fresh buffers.
- [ ] **F2-T2:** Wire theme `<select>` `change` event: `document.getElementById('themeSelect').addEventListener('change', ...)`. On change: update each `Ren` instance's `this.theme = RENDER_THEMES[value]`, invalidate `_offscreenBuf`, trigger redraw.

---

### Phase 4: MC-1 Gate

- [ ] **MC-1:** All scene rendering complete. Offscreen buffer working. Theme switching functional. Run guard tests `--id S --id X --id AA` to confirm no sim regression. All 3 themes render correctly in browser.

---

### Phase 5: Visual Verification (Wave 4 — sequential)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| D | F5-T1 → F5-T2 | Sequential | Screenshots before human review |

- [ ] **F5-T1:** Open `traffic_v18.html` in browser. Select "Cidade & Natureza". Capture screenshots at 1L, 2L, 3L configurations.
- [ ] **F5-T2:** Human visual gate. Leo or user confirms: houses look right, trees fill V-area, farm details visible, ground colors correct, road is clearly dominant, no elements on road. If rejected → iterate on F3 tasks.

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| Houses placed inside road polygon | Medium | High — visual bug | Use `rd.cx - rd.halfW(y)` as left boundary; add margin. Test with assertion. |
| Offscreen buffer stale after resize | Low | Medium — visual glitch | Invalidate on `resize` event + dimension check in `_ensureBuffer()` |
| Leo doesn't approve visual style | Medium | Medium — rework needed | Start with ground zones + basic houses; get early feedback before shadows/details |
| Rio theme breaks from buffer changes | Low | High — regression | Test Rio theme explicitly after buffer wiring (F4-T2). Guard tests catch sim issues. |
| Narrow canvas: houses unrecognizable when scaled | Low | Low — cosmetic | Set minimum house size (6×8px); below that, skip individual houses and show just ground color |
| `_treeCluster()` draws over road on narrow V-area | Low | Medium | Pass road-aware bounds to cluster positioning; clamp cluster radius |

---

## 9. Open Questions

- [ ] Exact house dimensions (width × height in px) — start with 12×16, iterate based on visual review
- [ ] Number of houses to place — start with 20, adjust for density feel
- [ ] Farm crop row spacing and color — start with 8px spacing, slightly darker green
- [ ] Display name language — "Cidade & Natureza" confirmed, but should Classic/Rio also be Portuguese? ("Clássico", "Rio Satélite")
- [ ] Should the offscreen buffer also be applied to the Rio theme for consistency? (Yes — proposed in F4-T2)

---

## 10. Approval Checklist

- [ ] Requirements reviewed by: _____________ Date: _________
- [ ] Architecture reviewed by: _____________ Date: _________
- [ ] Plan approved by: _____________ Date: _________

---

## 11. Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-03-14 | Initial plan created from DISCOVERY_City_Nature_Background.md | Claude Opus 4.6 |

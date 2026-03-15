# City & Nature Background Theme — Implementation Plan

**Generated:** 2026-03-14
**Updated:** 2026-03-15 (Session 2 — Enhancement Pass)
**Status:** In Progress
**Discovery:** [DISCOVERY_City_Nature_Background.md](DISCOVERY_City_Nature_Background.md)

---

## 1. Executive Summary

Add a third visual theme ("Cidade & Natureza") to the Traffic Lane Paradox simulator — urban neighborhood on the left, farmland and dense forest on the right, with a packed V-intersection forest. Session 1 (base theme, offscreen buffer, theme selector) is **complete**. Session 2 adds barn animals (cows, chickens, pigs — top-down with shadows), a fenced pen, chicken coop, farm pond, urban props (streetlights, benches, mailboxes, fences), a solid-packed V-forest aligned to the dark ground zone, and road-overlap prevention via zone clamping + per-element guard.

---

## 2. Requirements Summary

### 2.1 Problem Statement

The Session 1 City & Nature theme is live and functional, but the scene lacks life and precision: the nature side has no animals or farm structures, the urban side has no streetscape props, the V-intersection forest is not as dense as desired, and element placement does not formally guard against road overlap.

### 2.2 Target Users

Public simulator page visitors — anyone exploring the traffic lane paradox demonstration in a browser.

### 2.3 Success Criteria

**Session 1 (complete):**
- [x] Theme selector visible in `.ctrls` with 3 options
- [x] City & Nature background renders with houses, trees, ground zones
- [x] Offscreen buffer works; theme switching mid-sim works
- [x] Pedestrian paths and fountain props present

**Session 2 (in progress):**
- [ ] Barn animals (cows, chickens, pigs) visible top-down with shadows on farm side
- [ ] Fenced pen near barn; 1–2 loose animals outside
- [ ] Chicken coop structure near flock
- [ ] Farm pond (watering hole) on farm side
- [ ] Barn visually refreshed (hay bale dot, door mark)
- [ ] Urban props: road-edge + interior streetlights, benches, mailboxes, property-line fences
- [ ] V-intersection packed solid with trees, aligned to dark green ground zone
- [ ] Zero elements drawn inside road polygon (zone clamping + per-element guard)
- [ ] Human sign-off on visual quality

### 2.4 Explicitly Out of Scope

- Animated elements (swaying trees, smoke, water ripples) — Future Plans
- Additional themes (desert, snow, night) — Future Plans
- Parked cars — not selected in discovery
- Changes to `Road`, `Sim`, collision, wall, or legality behavior
- Isometric or 3D perspective

### 2.5 Evidence of Readiness

- [ ] Playwright screenshot shows cows, chickens, pigs with recognizable top-down shapes
- [ ] Playwright screenshot shows fenced pen + loose animal + coop + pond
- [ ] Playwright screenshot shows urban props (lampposts, benches, fences, mailboxes)
- [ ] Playwright screenshot shows V-area solid green canopy
- [ ] Automated assertion: zero element centers inside road bounding band
- [ ] Human confirms visual quality in browser

---

## 3. Technical Architecture

### 3.1 System Overview

```
traffic_core.js
  └── Ren class
        ├── _sceneCityNature()     [EXISTS — Session 1]
        │     ├── _drawHouse()       [EXISTS]
        │     ├── _treeCluster()     [EXISTS — reused]
        │     ├── _drawFarm()        [EXISTS]
        │     ├── _drawFountain()    [EXISTS]
        │     ├── _drawPedPaths()    [EXISTS]
        │     │
        │     ├── _drawAnimal()      [NEW — Session 2]
        │     ├── _drawAnimalPen()   [NEW — Session 2]
        │     ├── _drawCoop()        [NEW — Session 2]
        │     ├── _drawPond()        [NEW — Session 2]
        │     ├── _drawBarnRefresh() [NEW — Session 2, modifies barn drawing]
        │     ├── _drawUrbanProps()  [NEW — Session 2]
        │     └── _safeZones()       [NEW — Session 2, road overlap guard]
        └── _offscreenBuf          [EXISTS — Session 1]
```

### 3.2 Data Flow

```
Scene render (on buffer build):
  1. _safeZones(rd, w, h) → leftBand [0, roadLeft-margin], rightBand [roadRight+margin, w]
  2. Ground zones painted (existing)
  3. V-area tree clusters — packed solid, bounded to dark green ground zone (ENHANCED)
  4. Farm right side:
       a. Existing crop rows, fences (existing)
       b. _drawPond() — irregular blue shape
       c. Refreshed barn (_drawBarnRefresh)
       d. _drawAnimalPen() — fenced enclosure with cows + pigs inside
       e. _drawCoop() — small rect near chicken flock
       f. Chicken flock scatter near coop
       g. 1–2 loose animals outside pen
  5. Urban left side:
       a. Existing houses + yards (existing)
       b. _drawUrbanProps() — lampposts along road edge + between houses
       c. Benches near some houses
       d. Mailboxes + property fence segments between houses
  6. Buffer stored
Each frame: ctx.drawImage(buffer, 0, 0) [existing — unchanged]
```

### 3.3 Technology Decisions

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Animal drawing | Canvas 2D primitives + shadows | Top-down view, minimal, matches existing asset style |
| Road overlap guard | Zone clamping + per-element check | Belt-and-suspenders; zones fast, element guard catches edge cases |
| V-area density | Increase `_treeCluster()` call count + reduce spacing | Reuse proven helper, no new primitives |
| Urban props | New `_drawUrbanProps()` helper | Encapsulates lamppost, bench, mailbox, fence drawing |
| Pond | Irregular polygon via arc/bezier | Simple organic shape achievable with Canvas 2D |

### 3.4 Integration Points

- `_sceneCityNature()` — main integration point; all new drawing calls added here
- `_safeZones()` — called first, returns placement bands used by all downstream drawing
- `_offscreenBuf` — unchanged; new drawing calls are added to the same buffer build

### 3.5 Output and Failure Contracts

| Artifact or State | Owner | Proof Required | Blocked If |
|-------------------|-------|----------------|------------|
| Animal drawings | `_drawAnimal()` | Screenshots show recognizable cow/chicken/pig top-down | Looks like abstract blobs, not animals |
| Animal pen | `_drawAnimalPen()` | Fenced rect visible near barn; animals inside | Pen overlaps road |
| Chicken coop | `_drawCoop()` | Small rect near flock, distinct roof color | Missing or invisible at canvas scale |
| Farm pond | `_drawPond()` | Blue irregular shape on farm side | Overlaps road or looks wrong |
| Urban props | `_drawUrbanProps()` | Lampposts, benches, fences visible on left side | Any prop drawn on road surface |
| V-area density | Scene buffer | Screenshot shows near-solid canopy in V-zone | Trees sparse or mis-aligned with ground zone |
| Road overlap | `_safeZones()` + per-element guard | Automated assertion passes | Any element center inside road band |

---

## 4. Feature Breakdown

---

### Feature 1: Theme Configuration ✅ Complete

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F1-T1 | Add `cityNature` entry to `RENDER_THEMES` | None | No | S | ✅ |

---

### Feature 2: Theme Selector UI ✅ Complete

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F2-T1 | Add `<select id="themeSelect">` to `.ctrls` in HTML | None | No | S | ✅ |
| F2-T2 | Wire `change` event: update Ren theme + invalidate buffer | F2-T1, F1-T1 | Yes | S | ✅ |

---

### Feature 3: City & Nature Scene Renderer ✅ Complete (Session 1)

Houses, ground zones, farms, pedestrian paths, fountains, V-area trees — all implemented in Session 1.

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F3-T1 | `_sceneCityNature()`: ground zones | F1-T1 | No | S | ✅ |
| F3-T2 | House rendering: `_drawHouse()` + placement | F3-T1 | No | M | ✅ |
| F3-T3 | Farm details + tree clusters (right + V-area) | F3-T2 | No | M | ✅ |
| F3-T4 | Shadow/depth on houses and trees | F3-T3 | No | S | ✅ |
| F3-T5 | Narrow-canvas house scaling | F3-T2 | No | S | ✅ |

---

### Feature 4: Offscreen Buffer ✅ Complete

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F4-T1 | Offscreen buffer creation/invalidation in `Ren` | F3-T3 | No | M | ✅ |
| F4-T2 | Modify `draw()`: stamp buffer + dispatch by `theme.scene` | F4-T1 | No | S | ✅ |
| F4-T3 | Buffer invalidation on theme switch + resize | F4-T2, F2-T2 | Yes | S | ✅ |

---

### Feature 5: Visual Verification — Session 1 ✅ Complete

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F5-T1 | Reference screenshots at 1L, 2L, 3L | MC-1 | Yes | S | ✅ |
| F5-T2 | Human visual gate: Session 1 | F5-T1 | Yes | S | ✅ |

---

### Feature 6: Road Overlap Prevention

**User Story:** As a developer, I want all scene elements to respect road boundaries so nothing is drawn on the road surface.

**Acceptance Criteria:**
- [ ] `_safeZones(rd, w, h)` returns `{ leftBand, rightBand }` derived from road geometry
- [ ] All element placement functions receive and respect zone bands
- [ ] Per-element guard rejects any element whose bounding rect intersects road band
- [ ] Automated assertion confirms zero violations

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F6-T1 | Implement `_safeZones()` — compute leftBand + rightBand from `rd.cx`, `rd.halfW()` | None | No | S | ✅ |
| F6-T2 | Refactor all element placement in `_sceneCityNature()` to use zone bands + per-element guard | F6-T1 | No | M | ⬜ |
| F6-T3 | Add automated assertion test: place all elements, verify no center inside road band | F6-T2 | No | S | ⬜ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| `_safeZones()` returns correct bands | Unit | No | `leftBand.max === roadLeft - margin` for sample road widths | Test card assertion |
| Zero elements overlap road | Automated assertion | No | Assert passes for 1L, 2L, 3L | Test card: `F6_overlap_check` |
| Props respect zones post-refactor | Screenshot | Yes | No prop visible on gray road surface | Playwright screenshot |

---

### Feature 7: V-Area Tree Density Enhancement

**User Story:** As a viewer, I want the V-shaped area between the two road branches to look like an impenetrable forest canopy from above.

**Acceptance Criteria:**
- [ ] V-area trees packed solid (virtually no gaps)
- [ ] Dense forest zone spatially aligned with existing darker green ground color
- [ ] Tree clusters use existing `_treeCluster()` — increased call count and reduced spacing

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F7-T1 | Recalculate V-area cluster positions: tighter grid, more rows, aligned to dark ground zone | None | No | S | ✅ |
| F7-T2 | Increase cluster call count and reduce inter-cluster gaps until near-solid coverage | F7-T1 | No | S | ⬜ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| V-area visually solid | Screenshot | Yes | Near-zero ground visible between canopies in V zone | Playwright screenshot |
| Dark ground aligns with tree zone | Screenshot | Yes | Darker green ground and dense canopy are co-located | Playwright screenshot |

---

### Feature 8: Urban Side Props

**User Story:** As a viewer, I want the urban left side to feel like a real neighborhood with streetlights, benches, mailboxes, and property fences.

**Acceptance Criteria:**
- [ ] Streetlights along road edge + scattered between houses
- [ ] Benches near some houses (not every house)
- [ ] Short property-line fence segments between some adjacent houses
- [ ] Mailboxes near some house fronts
- [ ] All props stay within `leftBand` (no road overlap)
- [ ] Houses unchanged — props only

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F8-T1 | Implement `_drawLamppost(ctx, x, y, scale)` — pole + circular head top-down | F6-T1 | No | S | ⬜ |
| F8-T2 | Place road-edge lampposts: evenly spaced along left road boundary | F8-T1 | No | S | ⬜ |
| F8-T3 | Place interior lampposts: random positions between house clusters | F8-T1 | No | S | ⬜ |
| F8-T4 | Implement bench + mailbox: small rect shapes, placed near some houses | F6-T1 | No | S | ⬜ |
| F8-T5 | Implement property-line fences: 3–5 segment lines between adjacent house plots | F6-T1 | No | S | ⬜ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Props visible in screenshots | Screenshot | Yes | Lampposts, benches, fences, mailboxes recognizable | Playwright screenshot |
| No props on road | Automated (F6-T3 covers this) | No | Overlap assertion passes | Test card assertion |
| Props don't obscure houses | Screenshot | Yes | Houses still primary visual; props feel secondary | Playwright screenshot |

---

### Feature 9: Farm Animal System

**User Story:** As a viewer, I want to see cows, chickens, and pigs on the farm side — recognizable top-down shapes inside a pen near the barn, with a coop, a pond, and a few loose animals outside.

**Acceptance Criteria:**
- [ ] Cows: oval body, visible horns (two small protrusions), black+white color patches, shadow beneath
- [ ] Chickens: small flock (4–8), teardrop/oval body, tiny beak triangle
- [ ] Pigs: pink oval, snout dot, shadow
- [ ] Fenced pen rectangle drawn near barn; cows + pigs placed inside
- [ ] 1–2 loose animals placed just outside pen
- [ ] Chicken flock placed near coop (not inside pen)
- [ ] Chicken coop: small rect with distinct roof color (e.g., dark red)
- [ ] Farm pond: irregular blue polygon on farm side near animals
- [ ] Barn refreshed: same shape + hay bale dot + door mark added
- [ ] All farm elements within `rightBand` (no road overlap)

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F9-T1 | Implement `_drawCow(ctx, x, y, scale)` — oval + horn stubs + patches + shadow | F6-T1 | No | M | ⬜ |
| F9-T2 | Implement `_drawChicken(ctx, x, y, scale)` — teardrop body + beak + shadow | F6-T1 | No | S | ⬜ |
| F9-T3 | Implement `_drawPig(ctx, x, y, scale)` — pink oval + snout + shadow | F6-T1 | No | S | ⬜ |
| F9-T4 | Implement `_drawAnimalPen(ctx, x, y, w, h)` — fenced rect (4 sides, simple line segments) | F6-T1 | No | S | ⬜ |
| F9-T5 | Place pen near barn; populate with 1–3 cows + 2–4 pigs inside; 1–2 loose animals outside | F9-T1, F9-T3, F9-T4 | No | S | ⬜ |
| F9-T6 | Implement `_drawCoop(ctx, x, y)` — small rect, dark red roof | F6-T1 | No | S | ⬜ |
| F9-T7 | Place chicken flock (4–8) near coop | F9-T2, F9-T6 | No | S | ⬜ |
| F9-T8 | Implement `_drawPond(ctx, x, y, rx, ry)` — irregular blue polygon | F6-T1 | No | S | ⬜ |
| F9-T9 | Barn refresh: add hay bale dot + door mark to existing barn drawing | None | No | S | ✅ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Animals recognizable as species | Screenshot | Yes — human judges | Cow has horns, chicken is small, pig is pink — readable at canvas scale | Playwright screenshot |
| Pen visible near barn | Screenshot | Yes | Fenced rect clearly adjacent to barn | Playwright screenshot |
| Coop + flock visible | Screenshot | Yes | Small building + cluster of small birds nearby | Playwright screenshot |
| Pond visible | Screenshot | Yes | Blue irregular shape on farm side | Playwright screenshot |
| All farm elements in rightBand | Automated (F6-T3) | No | Overlap assertion passes | Test card assertion |

---

### Feature 10: Visual Verification — Session 2

**User Story:** As a developer, I want Playwright screenshots and human sign-off confirming all Session 2 features look correct and nothing overlaps the road.

**Acceptance Criteria:**
- [ ] Playwright screenshots captured showing all new features
- [ ] Automated road overlap assertion passes
- [ ] Human explicitly approves before feature marked done

**Tasks:**

| ID | Task | Dependencies | Live Test? | Effort | Status |
|----|------|--------------|------------|--------|--------|
| F10-T1 | Playwright screenshots: cityNature at 1L, 2L, 3L showing all Session 2 content | MC-2 | Yes | S | ⬜ |
| F10-T2 | Run automated road overlap assertion | F6-T3 | No | S | ⬜ |
| F10-T3 | Human visual gate: confirm all Session 2 features in browser | F10-T1 | Yes — mandatory | S | ⬜ |

**Tests Required:**

| What to Verify | Type | Human Needed? | Done When | Proof Artifact |
|----------------|------|---------------|-----------|----------------|
| Full scene looks correct | Screenshot + human | Yes | All features visible and readable | Playwright screenshot files |
| Road overlap | Automated assertion | No | Zero violations reported | Test card pass log |
| Human sign-off | Manual browser review | Yes — mandatory gate | Human explicitly approves | Approval noted in session |

---

## 5. Test Strategy

### 5.1 Testing Pyramid

- **Unit tests:** `_safeZones()` output bounds check; animal helper existence check
- **Automated guards:** Overlap assertion (element centers vs road band); existing guard suite `--id S --id X --id AA`
- **Visual tests (primary):** Playwright screenshots after each wave; human review at MC-2
- **Manual:** Theme switching, resize, narrow canvas scaling

### 5.2 TDD Checklist (Per Task)

```
For visual rendering tasks:
1. [ ] Define acceptance criteria (what it must look like)
2. [ ] Implement drawing primitive
3. [ ] Take Playwright screenshot immediately after
4. [ ] Review screenshot before proceeding to next task
5. [ ] Fix any issues found before moving on

For logic/config tasks:
1. [ ] Write failing test card first
2. [ ] Implement minimum code to pass
3. [ ] Run guard tests to confirm no regression
4. [ ] Commit
```

### 5.3 Testing Commands

```bash
# Existing guard suite
node run_traffic_suite.js --id S --id X --id AA

# Playwright screenshot (run from traffic-lane-paradox/ dir)
npx playwright screenshot traffic_v18.html screenshot_session2.png

# Overlap assertion test card (once F6-T3 is written)
node run_traffic_suite.js --id F6_overlap_check
```

---

## 6. Dependency & Parallelism Analysis

### 6.1 Task Dependency Graph (Session 2)

```
F6-T1 (safe zones) ──────────────────────────────────────┐
                   ├──► F6-T2 (refactor placement)         │
                   │     └──► F6-T3 (overlap assertion)    │
                   ├──► F7-T1 ──► F7-T2 (V density)       │
                   ├──► F8-T1 ──► F8-T2, F8-T3, F8-T4, F8-T5
                   └──► F9-T1,T2,T3,T4 (animal primitives)│
                         ├──► F9-T5 (pen+placement)        │
                         ├──► F9-T6 ──► F9-T7 (coop+flock)│
                         └──► F9-T8 (pond)                 │
F9-T9 (barn refresh) ────────────────────────────────────────┘
                                                           │
                                          MC-2 ◄──────────┘
                                            │
                                     F10-T1, F10-T2, F10-T3
```

### 6.2 Parallelism Reasoning

| Task Group | Tasks | Parallel? | Rationale |
|------------|-------|-----------|-----------|
| **Wave 1** | F6-T1, F7-T1, F9-T9 | Yes | All root tasks, independent files/functions |
| **Wave 2** | F6-T2, F7-T2, F8-T1, F9-T1, F9-T2, F9-T3, F9-T4, F9-T8 | Yes | All depend only on F6-T1 outputs; drawing primitives are independent |
| **Wave 3** | F6-T3, F8-T2, F8-T3, F8-T4, F8-T5, F9-T5, F9-T6, F9-T7 | Yes | Depend on Wave 2 outputs; all target different scene zones |
| **Wave 4** | MC-2, then F10-T1, F10-T2, F10-T3 | Sequential | Verification after everything lands |

### 6.3 Task Dependency Table

> **Source of truth for `/tdd` workflow.**

| Task | Description | Depends On | Unblocks | Status |
|------|-------------|------------|----------|--------|
| F1-T1 | Palette config | None | (done) | ✅ |
| F2-T1 | Theme selector HTML | None | (done) | ✅ |
| F2-T2 | Wire theme change event | F2-T1, F1-T1 | (done) | ✅ |
| F3-T1 | Ground zones | F1-T1 | (done) | ✅ |
| F3-T2 | House rendering | F3-T1 | (done) | ✅ |
| F3-T3 | Farm + tree clusters | F3-T2 | (done) | ✅ |
| F3-T4 | Shadows | F3-T3 | (done) | ✅ |
| F3-T5 | Narrow canvas scaling | F3-T2 | (done) | ✅ |
| F4-T1 | Offscreen buffer | F3-T3 | (done) | ✅ |
| F4-T2 | Buffer stamp + dispatch | F4-T1 | (done) | ✅ |
| F4-T3 | Buffer invalidation wiring | F4-T2, F2-T2 | (done) | ✅ |
| MC-1 | ⊕ Session 1 complete | F3-T4, F4-T3 | (done) | ✅ |
| F5-T1 | Session 1 screenshots | MC-1 | (done) | ✅ |
| F5-T2 | Session 1 human gate | F5-T1 | (done) | ✅ |
| **F6-T1** | `_safeZones()` helper | None | F6-T2, F7-T1, F8-T1, F9-T1–T4, F9-T8 | ✅ |
| **F6-T2** | Refactor placement to use zones + guard | F6-T1 | F6-T3 | ⬜ |
| **F6-T3** | Automated overlap assertion test card | F6-T2 | MC-2 | ⬜ |
| **F7-T1** | V-area cluster grid recalc (align to dark ground) | None | F7-T2 | ✅ |
| **F7-T2** | Increase cluster count / reduce gaps → solid | F7-T1 | MC-2 | ⬜ |
| **F8-T1** | `_drawLamppost()` primitive | F6-T1 | F8-T2, F8-T3 | ⬜ |
| **F8-T2** | Road-edge lamppost row | F8-T1 | MC-2 | ⬜ |
| **F8-T3** | Interior lampposts between houses | F8-T1 | MC-2 | ⬜ |
| **F8-T4** | Bench + mailbox shapes near houses | F6-T1 | MC-2 | ⬜ |
| **F8-T5** | Property-line fence segments | F6-T1 | MC-2 | ⬜ |
| **F9-T1** | `_drawCow()` — oval + horns + patches + shadow | F6-T1 | F9-T5 | ⬜ |
| **F9-T2** | `_drawChicken()` — teardrop + beak + shadow | F6-T1 | F9-T7 | ⬜ |
| **F9-T3** | `_drawPig()` — pink oval + snout + shadow | F6-T1 | F9-T5 | ⬜ |
| **F9-T4** | `_drawAnimalPen()` — fenced rect | F6-T1 | F9-T5 | ⬜ |
| **F9-T5** | Place pen + animals inside + loose outside | F9-T1, F9-T3, F9-T4 | MC-2 | ⬜ |
| **F9-T6** | `_drawCoop()` — small rect, dark red roof | F6-T1 | F9-T7 | ⬜ |
| **F9-T7** | Place chicken flock near coop | F9-T2, F9-T6 | MC-2 | ⬜ |
| **F9-T8** | `_drawPond()` — irregular blue polygon | F6-T1 | MC-2 | ⬜ |
| **F9-T9** | Barn refresh: hay bale dot + door mark | None | MC-2 | ✅ |
| **MC-2** | ⊕ All Session 2 features landed; guards green | F6-T3, F7-T2, F8-T2–T5, F9-T5, F9-T7, F9-T8, F9-T9 | F10-T1, F10-T2 | ⬜ |
| **F10-T1** | Playwright screenshots at 1L, 2L, 3L | MC-2 | F10-T3 | ⬜ |
| **F10-T2** | Run overlap assertion | F6-T3 | F10-T3 | ⬜ |
| **F10-T3** | Human visual gate — explicit approval | F10-T1, F10-T2 | — | ⬜ |

---

## 7. Implementation Phases

### Phase 1 — Session 1 ✅ Complete

All F1–F5 tasks done. Theme, selector, offscreen buffer, houses, trees, pedestrian paths, fountains all live.

---

### Phase 2 — Root Tasks (Wave 1 — parallel)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| A | F6-T1, F7-T1, F9-T9 | Yes | Independent: safe zones helper, V-area geometry, barn details |

- [ ] **F6-T1:** Compute `leftBand = [0, rd.cx - rd.halfW(y) - MARGIN]` and `rightBand = [rd.cx + rd.halfW(y) + MARGIN, w]` where `MARGIN = 6`. Return `{ leftBand, rightBand }`. Used by all placement functions.
- [ ] **F7-T1:** Recalculate V-area cluster grid: determine bounding box of V-zone, align to dark green ground zone bounds, create tighter grid (e.g., 12×16px spacing vs current 20×24px).
- [ ] **F9-T9:** Add to barn drawing: small hay bale rectangle (2×3px, golden yellow, inside barn boundary), door mark (thin darker rect on one barn wall).

---

### Phase 3 — Drawing Primitives (Wave 2 — parallel)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| B | F6-T2, F7-T2, F8-T1, F9-T1, F9-T2, F9-T3, F9-T4, F9-T8 | Yes | All depend on F6-T1; all target different functions |

- [ ] **F6-T2:** Refactor all `Math.random()` placement calls in `_sceneCityNature()` to: (a) clamp `x` to appropriate band, (b) after placement, run per-element guard `if (elemRight > leftBandMax && elemLeft < rightBandMin) skip`.
- [ ] **F7-T2:** Increase `_treeCluster()` call density in V-area until screenshot shows near-solid canopy. Target: ≤3px gap between adjacent cluster radii.
- [ ] **F8-T1:** `_drawLamppost(ctx, x, y, scale)` — vertical line (pole), circle at top (lamp head). Colors: dark gray pole, warm yellow/cream circle. Scale ~1 = 2×8px total.
- [ ] **F9-T1:** `_drawCow(ctx, x, y, scale)` — shadow ellipse offset (+1,+1), white oval body, black irregular patches (2–3 arcs), two small horn stubs at top.
- [ ] **F9-T2:** `_drawChicken(ctx, x, y, scale)` — shadow, yellow teardrop body, tiny orange beak triangle at front. Scale ~1 = 4×5px.
- [ ] **F9-T3:** `_drawPig(ctx, x, y, scale)` — shadow, pink oval, small darker circle for snout. Scale ~1 = 6×5px.
- [ ] **F9-T4:** `_drawAnimalPen(ctx, x, y, w, h)` — 4-sided fence: strokeRect with wooden-brown stroke, dashed or segmented line style.
- [ ] **F9-T8:** `_drawPond(ctx, x, y)` — 5–7 point irregular polygon using bezierCurveTo or arc sequences. Fill: `#6ec6e8` (light blue). Subtle darker border.

---

### Phase 4 — Placement & Assembly (Wave 3 — parallel)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| C | F6-T3, F8-T2, F8-T3, F8-T4, F8-T5, F9-T5, F9-T6, F9-T7 | Yes | All depend on Wave 2; all target different scene areas |

- [ ] **F6-T3:** Test card `F6_overlap_check`: instantiate `Ren` with 1L/2L/3L sim, call `_sceneCityNature()`, collect all element bounding rects, assert none intersect road band.
- [ ] **F8-T2:** Place lamppost row: from `canvas.height * 0.05` to `canvas.height * 0.95`, every `24px`, at `x = leftBand.max - 4` (right edge of left zone, adjacent to road).
- [ ] **F8-T3:** Place 3–6 interior lampposts: random positions in leftBand, avoiding house rectangles. Min distance 16px from any house.
- [ ] **F8-T4:** For 30% of houses: place bench (4×2px rect, gray-brown) beside house. For 50% of houses: place mailbox (2×2px rect, dark blue/black) at house front edge.
- [ ] **F8-T5:** Between adjacent house pairs (where gap < 20px): draw 3–5 fence segment lines (horizontal, short strokes, wooden brown).
- [ ] **F9-T5:** Choose pen position: near barn, within rightBand. Draw pen rect (30×20px). Place 1–3 cows + 2–4 pigs inside pen rect. Place 1–2 animals (random species) at random offset 6–12px outside pen corners.
- [ ] **F9-T6:** `_drawCoop(ctx, x, y)` — small rect (10×8px), roof stripe (dark red `#8b2020`). Place 12–20px from chicken cluster.
- [ ] **F9-T7:** Place chicken flock (4–8 chickens) in 20×14px scatter zone adjacent to coop. Random offsets within zone.

---

### Phase 5 — MC-2 Gate

- [ ] **MC-2:** All Session 2 features landed. Run `node run_traffic_suite.js --id S --id X --id AA` — all guards green. Open browser: verify all 3 themes still work. Confirm animals, props, V-density, pond, coop all visible.

---

### Phase 6 — Verification (Wave 4 — sequential)

| Batch | Tasks | Parallel? | Rationale |
|-------|-------|-----------|-----------|
| D | F10-T1, F10-T2 parallel, then F10-T3 | Partial | Screenshots + assertion can run together; human gate waits |

- [ ] **F10-T1:** Playwright screenshots at 1L, 2L, 3L — save as `screenshot_s2_1L.png`, `screenshot_s2_2L.png`, `screenshot_s2_3L.png`.
- [ ] **F10-T2:** Run overlap assertion test card. Report zero violations.
- [ ] **F10-T3:** Human reviews screenshots + browser. Explicitly approves before marking done.

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| Animals too small to read at canvas scale (~220px wide) | Medium | High | Start at scale=1.5× and iterate; minimum size is cow ~14×10px |
| Pen + coop + pond + loose animals crowd farm side | Medium | Medium | Place pond away from pen; coop offset from pen; take screenshot after each addition |
| V-area over-packing causes performance drop | Low | Low | Pre-render to offscreen buffer (already done); packing only affects buffer build time |
| Safe zone refactor breaks existing house/tree placement | Medium | High | Take screenshot before and after F6-T2; compare house positions |
| Per-element guard too aggressive (clips edge elements) | Low | Low | MARGIN=6 is conservative; reduce to 2 if needed |
| Barn refresh overlaps existing barn drawing | Low | Low | Hay bale and door mark are additive — drawn on top of existing barn fill |

---

## 9. Open Questions

- [ ] Exact animal scale per canvas size — start with `scale = Math.min(1.5, availableWidth / 60)` and tune from screenshot
- [ ] Pond position relative to pen — start 15px below pen, adjust if crowded
- [ ] Whether to place pond or animals first (matters for visual overlap) — animals drawn on top of pond suggested

---

## 10. Approval Checklist

- [ ] Requirements reviewed by: _____________ Date: _________
- [ ] Session 2 plan approved by: _____________ Date: _________

---

## 11. Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-03-14 | Initial plan created from DISCOVERY_City_Nature_Background.md (Session 1) | Claude Opus 4.6 |
| 2026-03-15 | Session 2 enhancement pass: added F6 (road overlap), F7 (V density), F8 (urban props), F9 (animal system), F10 (verification). Marked F1–F5 + MC-1 complete. Updated dependency table, wave structure, risk assessment. | Claude Sonnet 4.6 |

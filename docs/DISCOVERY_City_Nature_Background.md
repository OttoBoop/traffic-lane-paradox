# Discovery — City & Nature Background Theme

**Feature:** New "City & Nature" background theme for the Traffic Lane Paradox simulation
**Date Started:** 2026-03-14
**Status:** Complete (Session 2 — Enhancement Pass)
**Categories Completed:** 9/9 (Session 1 + Session 2 extensions approved)

---

## Context

Leo Bloise (Gabinete) suggested a visual redesign: **green/nature on one side of the Y-fork road, urban/houses on the other**. The road itself stays the visual focus. Houses alternate colors. Even with flat/solid backgrounds the effect works because the road is the attention anchor.

### Reference Materials
- WhatsApp conversation (2026-03-13) between Otávio Bopp and Leo Bloise
- Tileset/sprite sheet image (top-down city elements: buildings, roads, trees, parks, cars)
- Y-shaped road fork mockup (green on one side, gray/urban on the other)

### Key Quotes from Leo
> "verde de um lado e cidade do outro"
> "preencher de vetores de arvores um lado e de casas do outro"
> "as casas alternando de cores"
> "até com fundo chapado acho que já dá pra definir bem, pq o que precisa chamar atenção é a estrada"

---

## 1. Core Requirements ✅ (Approved)

**Summary:** New third theme ("City & Nature") alongside `classic` and `rioSatellite` — aesthetic variety, user picks. Audience is the public simulator page. Success = Leo approves the look + theme switching works mid-sim. Layout: left = urban houses, right = farms grading into dense forest upward, V-area above fork = dense forest. Element placement randomized each page load.

### Q&A Exchange

**Q1: Theme slot — new or replace?**
> New third theme alongside `classic` and `rioSatellite`. User picks from 3 options. Goal is aesthetic variety — three themes coexist.

**Tags:** [Core]

**Q2: Side layout — which side gets what?**
> Left = houses (urban), Right = farms and mild trees, upward = dense forest. Not a simple binary split — there's a gradient from farmland to dense forest on the right/upper area.

**Tags:** [Core], [Functional]

**Q3: How should houses and trees be generated?**
> Random each page load. Fresh random placement every refresh — feels alive. No seeding or caching.

**Tags:** [Core], [Functional]

**Q4: Who is the audience for this theme?**
> Public simulator page — anyone visiting the traffic paradox page can see it.

**Tags:** [Core]

**Q5: What does success look like?**
> Leo approves the look + theme switching works mid-sim. FPS and road-focus are nice-to-haves, not hard gates.

**Tags:** [Core], [Testing]

---

## 2. Functional Requirements ✅ (Approved)

**Summary:** Houses are top-down rectangles with visible roofs, warm earthy colors (beige, terracotta, cream), Leo's tileset-style shadows. Mixed yards — some with small green/brown patches, some without. Left side = urban on gray ground. Right side = farms (light crop row details) grading into dense forest upward. V-area above fork packed with tree clusters (reuse existing `_treeCluster()`). Medium density — suburban feel. Road rendering unchanged from classic theme. No new tree primitives needed.

### Q&A Exchange

**Q1: House style?**
> Top-down rectangles + visible roofs. Rectangles with a colored roof section — simple but recognizable as houses. Not isometric.

**Tags:** [Functional]

**Q2: What fills the V-area above the fork (between the two diverging branches)?**
> Dense forest fills the V. The triangular space between the two branches is packed with trees.

**Tags:** [Functional], [Core]

**Q3: Depth/shadow style?**
> Leo's tileset style. Slight shadows and mild 3D feel on elements — matching the reference tileset image. Not completely flat, not full isometric.

**Tags:** [Functional]

**Q4: Ground colors?**
> Gray left, green right. Urban side has gray/concrete ground (matching Leo's mockup), nature side has green grass.

**Tags:** [Functional]

**Q5: Element density?**
> Medium — suburban feel. Moderate number of houses and trees, some clustering but still open spaces. Not sparse, not packed.

**Tags:** [Functional]

**Q6: Farm details (right side, before the dense forest)?**
> Light farm details. Subtle crop row lines or small fence segments to suggest farmland — not just bare green, but not elaborate either.

**Tags:** [Functional]

**Q7: House color palette?**
> Warm earthy tones. Beige, terracotta, light brown, cream — Mediterranean/Brazilian neighborhood feel. Houses alternate between these colors.

**Tags:** [Functional]

**Q8: Do houses have yards/gardens around them?**
> Mixed — some houses have a small green/brown yard patch, others sit directly on gray ground. Random per house. More organic suburban feel.

**Tags:** [Functional]

**Q9: Tree style for nature side and V-area forest?**
> Reuse existing `_treeCluster()` helper from Rio theme — organic grouped canopies. No new tree primitives needed.

**Tags:** [Functional], [Constraints]

**Q10: Road appearance under this theme?**
> Same road as classic — road rendering unchanged, only the background around it changes. No new road colors or textures.

**Tags:** [Functional], [Constraints]

---

## 3. Non-Functional Requirements ✅ (Approved)

**Summary:** Offscreen buffer pre-renders static background once per load/resize/theme-switch, `drawImage()` stamps it each frame. Theme selector dropdown in `.ctrls` area for all 3 themes. No additional memory, load time, or accessibility concerns flagged.

### Q&A Exchange

**Q1: Performance strategy?**
> Offscreen buffer (pre-render). Draw all static elements (houses, trees, ground) once to a hidden canvas, then `drawImage()` it each frame. Avoids recomputing hundreds of shapes every animation tick.

**Tags:** [Non-Functional], [Constraints]

**Q2: Theme switching UI?**
> Add a dropdown/button in the header. Users can pick between Classic, Rio Satellite, and City & Nature via a visible UI control in the `.ctrls` area.

**Tags:** [Non-Functional], [Functional]

---

## 4. Constraints & Boundaries ✅ (Approved)

**Summary:** Canvas 2D only, vanilla JS, no external assets — all procedurally generated. Must integrate with existing `Ren` class, `RENDER_THEMES`, `_scene*()` pattern. Reuse existing helpers (`_treeCluster()`, `_roundRectPath()`, etc.). No animated elements (static scene only). Road geometry from `Road` class drives element placement boundaries.

### Q&A Exchange

**Q1: What are the technical constraints?**
> - Rendering engine: HTML5 Canvas 2D only (no SVG, no external libraries)
> - Tech stack: Vanilla JavaScript, no build tools, no frameworks
> - Canvas size: ~220×760 logical pixels (responsive, scales with device pixel ratio)
> - Existing architecture: Must integrate with `Ren` class, `RENDER_THEMES` object, `_scene*()` method pattern
> - No external assets: All graphics must be procedurally generated (vector shapes via Canvas API)
> - Existing helpers available: `_treeCluster()`, `_roundRectPath()`, `_clamp()`, `_sceneMetrics()`
> - Road geometry available: `rd.cx`, `rd.forkY`, `rd.halfW()`, `rd.lEnd`, `rd.rEnd`, branch edge sampling methods

**Tags:** [Constraints]

**Q2: What is explicitly out of scope?**
> No animated elements — swaying trees, chimney smoke, water motion are all out of scope. Static scene only. (Animated elements noted in Future Plans.)

**Tags:** [Constraints], [Future Plans]

---

## 5. Edge Cases & Error Handling ✅ (Approved)

**Summary:** Key edge cases: lane count changes (1-8 lanes) require adaptive placement; resize invalidates offscreen buffer; theme switch mid-sim works without reset; narrow canvases scale houses smaller (not skip); elements must never overlap road surface.

### Q&A Exchange

**Q1: What known edge cases must be handled?**
> - Different lane counts (1-8 lanes): Road width changes significantly — house/tree placement must adapt to road boundaries
> - Resize: Offscreen buffer must be invalidated and regenerated on window resize
> - Theme switch mid-simulation: Must work without resetting the simulation
> - Elements overlapping road: Houses/trees must never draw over the road surface

**Tags:** [Edge Cases], [Functional]

**Q2: What happens on very narrow canvases (1 lane, mobile)?**
> Scale houses smaller — shrink house dimensions proportionally to fit narrow space. Don't skip them entirely.

**Tags:** [Edge Cases], [Functional]

---

## 6. Testing & Acceptance ✅ (Approved)

**Summary:** Visual quality verified by screenshots (for our own automated review) + human screening gate (Leo or user confirms in browser). Automated guard: no elements overlap road polygon. Buffer invalidation tested on resize and theme switch. Theme toggle mid-sim must not break rendering. No hard FPS gate — performance is a nice-to-have.

### Q&A Exchange

**Q1: What testing is needed?**
> - Visual regression: compare rendered output across lane counts (1, 2, 3)
> - Buffer invalidation: verify offscreen cache regenerates on resize and theme switch
> - No overlap: verify no elements draw over road polygon
> - Theme toggle: switch themes mid-sim, confirm rendering is correct
> - Performance: compare FPS with and without offscreen buffer

**Tags:** [Testing]

**Q2: How should scene rendering be verified?**
> Screenshots for our own automated review + human screening as a gate. Take reference screenshots at key lane counts, then human confirms visual quality before shipping.

**Tags:** [Testing], [Core]

### Acceptance Criteria Table

| Feature | Test Type | Human Needed? | Done When |
|---------|-----------|---------------|-----------|
| Scene rendering (houses, trees, ground) | Screenshot + human visual | Yes — Leo or user confirms look | Scene matches Leo's vision; no elements on road |
| Offscreen buffer | Automated: check buffer regenerates on resize/theme switch | No | Buffer invalidated and redrawn correctly |
| Theme switching UI | Manual: toggle mid-sim | Yes — confirm no rendering glitch | All 3 themes switchable without sim reset |
| No road overlap | Automated: element bounds vs road polygon | No | Zero elements drawn inside road surface |
| Narrow canvas scaling | Manual: test at 1-lane mobile width | Yes — confirm houses scale down | Houses shrink proportionally, still recognizable |

---

## 7. Other / Notes ✅ (Approved)

**Summary:** Theme needs a display name in the UI dropdown — e.g. "Cidade & Natureza" (Portuguese, matching the Brazilian context).

### Q&A Exchange

**Q1: Any stray thoughts not captured elsewhere?**
> Theme needs a display name shown in the UI dropdown. Suggested: "Cidade & Natureza" (Portuguese).

**Tags:** [Other], [Functional]

---

## 8. Future Plans ✅ (Approved)

**Summary:** Three deferred ideas: (1) Additional themes (desert, snow, night) following the same pattern. (2) Leo may provide more detailed mockups — implementation should be easy to tweak. (3) Animated elements (swaying trees, chimney smoke) — not in this scope.

### Q&A Exchange

**Q1: What future ideas are out of scope but worth recording?**
> - Additional themes could follow this same pattern (e.g., desert, snow, night)
> - Leo may provide more detailed mockups — the implementation should be easy to tweak colors/shapes
> - Potential for animated elements in future (swaying trees, chimney smoke) but NOT in this scope

**Tags:** [Future Plans]

---

## 9. Parallelism Analysis ✅ (Approved)

**Summary:** 7 tasks across 3 waves. Wave 1 parallelizes palette config + dropdown UI. Wave 2 sequences the scene method → buffer → wiring. Wave 3 is screenshots → human review gate.

### Task List (confirmed)

| # | Task |
|---|------|
| T1 | Add `cityNature` color palette + theme config to `RENDER_THEMES` |
| T2 | Implement `_cityNatureScene()` method (houses, trees, farms, ground zones) |
| T3 | Add theme selector dropdown to HTML (`traffic_v18.html`) |
| T4 | Wire offscreen buffer caching in `Ren` (create/invalidate/stamp) |
| T5 | Wire `Ren.draw()` to call scene for new theme |
| T6 | Take reference screenshots at 1L, 2L, 3L for visual review |
| T7 | Human visual gate — Leo/user confirms in browser |

### Dependency Table

| Task | Depends On | Reasoning |
|------|-----------|----------|
| T1 (palette) | None | Root task — just adding a config object |
| T2 (scene method) | T1 | Needs color palette to reference |
| T3 (dropdown UI) | None | Root task — HTML/CSS only, independent |
| T4 (offscreen buffer) | T2 | Needs scene method to render into buffer |
| T5 (wire draw()) | T1, T4 | Needs palette config + buffer mechanism |
| T6 (screenshots) | T5 | Needs everything wired to capture |
| T7 (human gate) | T6 | Needs screenshots to review |

### Wave Structure

```
📦 Wave 1 (parallel): T1 + T3
   T1: palette config    T3: dropdown UI
   Why grouped: Both are root tasks, no shared state.
   Produces: Color palette for T2; UI control for theme switching.

📦 Wave 2 (sequential): T2 → T4 → T5
   T2: scene method (houses, trees, ground)
   T4: offscreen buffer (create, invalidate, stamp)
   T5: wire draw() to call scene
   Why sequential: Each depends on the previous. Scene draws into buffer, buffer stamps into draw().
   Produces: Complete rendering pipeline for City & Nature theme.

📦 Wave 3: T6 → T7
   T6: reference screenshots at 1L, 2L, 3L
   T7: human visual gate
   Why sequential: Screenshots needed before human review.
   Produces: Visual approval.
```

### Dependency Graph

```
T1 (palette) ──┐
               ├──► T2 (scene) ──► T4 (buffer) ──► T5 (wire) ──► T6 (screenshots) ──► T7 (human gate)
T3 (dropdown) ─┘
```

---

## Reliability Evidence

### Gap Matrix

| Capability | Intended behavior | Actual implementation | Observed artifact evidence | Verdict |
|------------|-------------------|-----------------------|----------------------------|---------|
| `_cityNatureScene()` | Draw houses, trees, farms, ground zones | Does not exist yet | N/A — new feature | New code needed |
| Offscreen buffer | Pre-render static background once, stamp per frame | Does not exist yet (Rio theme redraws each frame) | N/A | New mechanism needed |
| Theme selector UI | Dropdown for 3 themes in `.ctrls` area | Does not exist — themes are currently hardcoded per page | N/A | New UI control needed |
| `RENDER_THEMES.cityNature` | Color palette + scene config | Does not exist yet | N/A | New config object needed |
| `_treeCluster()` helper | Draw organic grouped canopies | Exists in `traffic_core.js` (Rio theme) | Used in Rio satellite scene | Reuse — proven |
| `_roundRectPath()` helper | Draw rounded rectangles | Exists in `traffic_core.js` | Used in Rio satellite scene | Reuse — proven |
| `_sceneMetrics()` helper | Derive landmark bounds from road geometry | Exists in `traffic_core.js` | Used in Rio satellite scene | Reuse — proven |

### Live-Proof Status

- No implementation exists yet — this is a greenfield feature
- Existing helpers (`_treeCluster`, `_roundRectPath`, `_sceneMetrics`) are proven via the Rio satellite theme
- No test cards exist for visual theme correctness (visual features verified by human review)

### Tool Inventory

**Required and proven:**
- `_treeCluster()` — tree rendering (Rio theme)
- `_roundRectPath()` — rounded rectangle drawing (Rio theme)
- `_sceneMetrics()` — road-derived scene bounds (Rio theme)
- `RENDER_THEMES` object — theme configuration registry
- `traffic_v18.html` — main simulator page

**Required but missing/unproven:**
- Offscreen buffer mechanism (new)
- Theme selector dropdown UI (new)
- House rendering function (new)
- Farm/crop detail rendering (new)
- Ground zone coloring (new)

**Deferred:**
- Animated elements (future)
- Additional themes beyond the initial 3 (future)

### Unresolved Evidence Risks

- No automated visual regression testing exists — all visual quality is human-judged
- Offscreen buffer invalidation timing untested (resize, theme switch, lane count change)
- House scaling on narrow canvases untested — may need iteration on proportions

---

## Connection Map

| Answer | Affects Categories | Notes |
|--------|-------------------|-------|
| Random placement each load | Core, Functional, Non-Functional | Offscreen buffer must regenerate on load but NOT every frame |
| Offscreen buffer strategy | Non-Functional, Edge Cases | Must invalidate on resize, theme switch, and lane count change |
| Theme switching mid-sim | Core, Non-Functional, Edge Cases | No sim reset — just re-render background |
| Leo's tileset shadow style | Functional, Constraints | Must be achievable with Canvas 2D only — no SVG filters |
| Reuse `_treeCluster()` | Functional, Constraints | No new tree primitives — reuse proven Rio helper |
| Road unchanged | Functional, Constraints | Only background changes — road rendering stays classic |
| Scale houses on narrow canvas | Edge Cases, Functional | Proportional scaling, not skip — keeps visual identity |
| Display name in dropdown | Other, Functional | "Cidade & Natureza" — Portuguese, matches Brazilian context |
| Success = Leo approval + theme switching | Core, Testing | FPS and road-focus are nice-to-haves, not hard gates |
| V tree density must align with dark green ground zone | Functional, Edge Cases | Ground color zone and tree density zone must be co-located — visual layers must match |
| Road overlap fix: zone clamping + per-element guard | Functional, Edge Cases, Constraints | Belt-and-suspenders: upfront zone definition + runtime guard per element |
| Animal pen near barn + loose animals outside | Functional | Organic farmyard feel — not all animals enclosed, adds life |
| Chicken coop + pond as standalone farm props | Functional | Additional farm structures beyond animals — context for the flock and a watering point |
| Urban props don't change house code | Functional, Constraints | House drawing stays as-is; only surrounding props added |
| Testing: overlap assertion + human gate | Testing, Edge Cases | Automated proof of no road overlap + visual quality gate — both required |

---

## Completeness Score

```
Completeness Score: 6/6 gates passed
- G1: ✅ All categories covered (9/9)
- G2: ✅ All summaries approved (9/9)
- G3: ✅ Testing questions complete (5 features in acceptance table)
- G4: ✅ Connection map entries (9 ≥ 3)
- G5: ✅ No pending re-approvals
- G6: ✅ Reliability evidence complete (gap matrix, live-proof, tool inventory, risks)
```

---

## Pre-Exit Cross-Category Review (Layer 3)

Cross-category review found **0 items** to address:
- No contradictions between categories
- All connections tracked in connection map
- Offscreen buffer invalidation covered in both Non-Functional and Edge Cases (consistent)
- `_treeCluster()` reuse noted in both Functional and Constraints (consistent)
- Display name noted in both Other and Functional (consistent)

---

---

## Session 2 — Enhancement Pass (2026-03-15)

New requirements to explore:
- Barn animals on the nature side of the road
- Increased tree density in the V intersection
- Enhanced urban side design (new props, better houses)
- Road overlap prevention (houses/props must not draw over road surface)
- Additional new props (TBD)

### Q&A Exchange — Session 2

**S2-Q1: Animal visual style?**
> Top-down, minimalistic, with shadows. Animals must be clearly recognizable as the animal species — cows have visible horns and color patches (black+white), chickens are distinct, etc. Same stylistic register as existing assets (tileset-inspired, top-down, canvas primitives + shadow). No abstract blobs — they must read as the actual animal.

**Tags:** [Functional], [Constraints]

**S2-Q2: New urban props?**
> Mailboxes/fences, Benches/bus stops, Streetlights/lampposts. (Parked cars not selected.)

**Tags:** [Functional]

**S2-Q3: V intersection tree density?**
> Pack it solid — virtually no gaps. IMPORTANT: the dense forest zone must spatially align with where the darker green background ground color already is. The visual layers (ground darkness and tree density) must be co-located.

**Tags:** [Functional], [Edge Cases]

**S2-Q4: Animal placement — pen or free?**
> Both — a fenced pen near the barn with most animals inside it, plus 1–2 wandering loose outside. Organic yet readable.

**Tags:** [Functional]

**S2-Q5: Animal species?**
> Cows, Chickens, Pigs. (Sheep not selected.)
> - Cows: largest, black+white color patches, visible horns, 1–3 per farm zone
> - Chickens: small flock of 4–8 tiny birds near a coop
> - Pigs: medium, pink, snout detail, 2–4 per pen

**Tags:** [Functional]

**S2-Q6: Road overlap prevention approach?**
> Both — zone clamping upfront (safe left band, safe right band derived from road geometry) PLUS per-element bounding box guard as safety net. Belt-and-suspenders.

**Tags:** [Functional], [Edge Cases], [Constraints]

**S2-Q7: Do houses themselves change visually?**
> Props only — house drawing code stays as-is. Only the surrounding props (streetlights, benches, fences, mailboxes) change.

**Tags:** [Functional], [Constraints]

**S2-Q8: Streetlight placement?**
> Both — a row along the road edge + a few interior ones between houses. Denser urban feel.

**Tags:** [Functional]

**S2-Q9: Barn changes?**
> Minor refresh — same shape, tweak colors or add small details (hay bale dot, door mark) to better fit the animal farm context.

**Tags:** [Functional]

**S2-Q10: Fence style and placement?**
> Short property-line segments between houses — small 3–5 segment fence lines suggesting property boundaries between adjacent plots. Not full perimeters, not every house.

**Tags:** [Functional]

**S2-Q11: Testing approach for new features?**
> Full: screenshot review + automated road overlap assertion (no element center inside road polygon) + explicit human sign-off gate before marking done.

**Tags:** [Testing]

**S2-Q12: Any other new props?**
> Add both — chicken coop structure (small rect near chicken flock, different roof color) + a pond/watering hole (small irregular blue shape on farm side near animals).

**Tags:** [Functional]

---

### Session 2 — Summary ✅ (Approved)

**New features confirmed:**
- **Barn animals**: Top-down, minimal with shadows, clearly readable as species. Cows (horns + B&W patches), Chickens (small flock), Pigs (snout). Placed in a fenced pen near the barn + 1–2 loose animals outside. Style matches existing tileset-inspired assets.
- **Chicken coop**: Small building rect near flock, distinct roof color.
- **Farm pond**: Small irregular blue shape (watering hole) near animals on farm side.
- **Barn refresh**: Minor — same shape, add hay bale dot + door mark, tweak colors.
- **Urban props**: Streetlights (road edge + between houses), benches/bus stops, mailboxes, short property-line fence segments between some houses. Houses unchanged.
- **V intersection**: Pack solid with trees. Zone must spatially align with the existing darker green ground color.
- **Road overlap fix**: Zone clamping (safe left/right bands upfront) + per-element bounding box guard.
- **Testing**: Screenshot review + automated road overlap assertion + human sign-off gate.

### Session 2 — Parallelism Analysis ✅ (Approved)

**Task List (Session 2):**

| # | Task |
|---|------|
| S2-T1 | Road overlap fix — zone clamping + per-element guard |
| S2-T2 | V intersection tree density — pack solid, aligned to dark green ground zone |
| S2-T3 | Urban props — streetlights, benches, mailboxes, property-line fences |
| S2-T4 | Barn minor refresh — hay bale dot, door mark, color tweak |
| S2-T5 | Animal pen — fenced enclosure near barn + 1–2 loose animals |
| S2-T6 | Animal drawing — top-down cow (horns + patches), chicken (flock), pig (snout) with shadows |
| S2-T7 | Chicken coop structure — small building near chicken flock |
| S2-T8 | Farm pond — small irregular blue shape near animals |
| S2-T9 | Screenshots + automated road overlap assertion + human sign-off |

**Dependency Table:**

| Task | Depends On | Reasoning |
|------|-----------|----------|
| S2-T1 (road overlap fix) | None | Root task — modifies placement logic |
| S2-T2 (V tree density) | None | Root task — modifies cluster count in V zone |
| S2-T4 (barn refresh) | None | Root task — tweaks existing barn drawing |
| S2-T6 (animal drawing) | None | Root task — animal primitives needed before placement |
| S2-T8 (farm pond) | None | Root task — standalone shape on farm ground |
| S2-T3 (urban props) | S2-T1 | Needs safe zones before placing props |
| S2-T5 (animal pen) | S2-T4, S2-T6 | Needs barn position + animal shapes |
| S2-T7 (chicken coop) | S2-T6 | Needs chicken flock position reference |
| S2-T9 (testing) | All above | Needs everything landed |

**Wave Structure:**

```
📦 Wave 1 (parallel): S2-T1 + S2-T2 + S2-T4 + S2-T6 + S2-T8
   T1: road overlap fix     T2: V tree density
   T4: barn refresh         T6: animal drawing primitives
   T8: farm pond
   Why grouped: All root tasks, no shared state.
   Produces: Safe placement zones, denser V forest, refreshed barn,
             animal drawing functions, pond shape.

📦 Wave 2 (parallel): S2-T3 + S2-T5 + S2-T7
   T3: urban props (needs safe zones from T1)
   T5: animal pen + placement (needs T4 barn pos + T6 animal shapes)
   T7: chicken coop structure (needs T6 flock position ref)
   Why grouped: All depend on Wave 1 outputs but not on each other.
   Produces: Full farm scene with animals + coop; full urban side with props.

📦 Wave 3 (sequential): S2-T9
   Screenshots + road overlap assertion + human sign-off
   Why sequential: Needs everything landed to test.
   Produces: Visual approval and overlap proof.
```

**Dependency Graph:**

```
S2-T1 (overlap fix) ──────────────────────────────────────────────┐
S2-T2 (V density) ────────────────────────────────────────────────┤
S2-T4 (barn refresh) ─────────────────────────────────────────────┤──► S2-T9 (testing)
S2-T6 (animal drawing) ──► S2-T5 (pen) ──────────────────────────┤
                       └──► S2-T7 (coop) ────────────────────────┤
S2-T8 (pond) ─────────────────────────────────────────────────────┤
S2-T1 ──────────────────► S2-T3 (urban props) ───────────────────┘
```

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-14 | Initial discovery — all 9 categories answered (condensed format) |
| 2026-03-14 | Enhancement pass — restructured to full standard format. Added: per-category summaries with approval gates, tags on all Q&A, acceptance criteria table, reliability evidence section (gap matrix, tool inventory, risks), expanded connection map (9 entries), completeness score (6/6), Layer 3 cross-category review. New Q&A: house yards (mixed), tree style (_treeCluster reuse), road style (unchanged), narrow canvas (scale smaller), scene testing (screenshots + human gate), display name ("Cidade & Natureza"). |
| 2026-03-15 | Session 2 — Enhancement pass. New features: barn animals (cows, chickens, pigs — top-down with shadows), chicken coop, farm pond, animal pen, barn minor refresh, urban props (streetlights, benches, mailboxes, property fences), V intersection packed solid + aligned to dark ground zone, road overlap prevention (zone clamping + per-element guard). 9 new tasks (S2-T1 through S2-T9) across 3 waves. Connection map extended to 17 entries. |

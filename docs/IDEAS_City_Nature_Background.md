# Ideas: City & Nature Background Theme

**Generated from:** docs/DISCOVERY_City_Nature_Background.md
**Date:** 2026-03-14

## Deferred Ideas

These were identified during discovery but are explicitly out of scope for the current implementation. They are tracked here for future work.

---

### 1. Additional Themes (Desert, Snow, Night) — ✅ Night + Snow SHIPPED (2026-06-10)

**What:** Follow the same `RENDER_THEMES` + `_scene*()` pattern to add more visual themes — desert, snow, or night variants.

**Status:** `night` and `snow` shipped: full palettes delegating to `_sceneCityNature` plus overlay passes (night = veil/stars/moon/halos/headlights; snow = roof caps/frozen pond/snowfall). **Desert remains deferred** (not selected by the user).

**Approach used:** Each new theme adds a `RENDER_THEMES` entry + a `_scene[Name]()` method + a display name in the dropdown — exactly as predicted; the palette-driven scene meant ~330 lines of geometry were reused per theme.

---

### 2. Leo's Detailed Mockups

**What:** Leo may provide more detailed visual mockups for the City & Nature theme or other themes in the future.

**Why deferred:** Current implementation is based on the WhatsApp conversation and tileset reference. The code should be structured so colors, element sizes, and densities are easy to tweak when more specific mockups arrive.

**Potential approach:** Keep all visual constants (colors, sizes, densities) grouped at the top of the scene method or in the `RENDER_THEMES` config, not scattered through drawing code.

---

### 3. Animated Elements (Swaying Trees, Chimney Smoke) — ✅ SHIPPED (2026-06-10)

**What:** Add subtle animation to background elements — trees swaying, chimney smoke rising, water ripples.

**Status:** Shipped as `Ren._animLayer` — exactly the "separate animation layer on top of the static offscreen buffer" approach proposed below: only small sprites redraw per frame (smoke puffs, swaying canopy patches, pond ripples; plus star twinkle on night and snowfall on snow), all stateless functions of `Date.now()` + anchors recorded by `_sceneCityNature`. An idle render loop keeps animations alive while paused without ticking the sims.

---

---

### 4. Sheep on Farm Side — ✅ SHIPPED (2026-06-10)

**What:** Add sheep as a fourth animal species — fluffy white clusters, 2–4 per pen.

**Status:** Shipped as `_drawSheep(ctx, x, y, scale)` (the exact predicted pattern): 2–4 sheep grazing below the pen with right-zone guard. Card BR guards the primitive.

---

### 5. Parked Cars on Urban Side — ✅ SHIPPED (2026-06-10)

**What:** Small top-down car rectangles parked in front of houses.

**Status:** Shipped as `_drawParkedCar` — muted-palette rects with window hints in front of ~35% of houses, left-zone guarded, drawn into the static buffer so they read as scenery, not sim cars. Card BR guards the primitive.

---

## Source

These ideas were captured during the discovery phase for the City & Nature Background Theme but deferred for future implementation. See [DISCOVERY_City_Nature_Background.md](DISCOVERY_City_Nature_Background.md) Category 8 (Future Plans) for the original Q&A.

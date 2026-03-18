# Ideas: City & Nature Background Theme

**Generated from:** docs/DISCOVERY_City_Nature_Background.md
**Date:** 2026-03-14

## Deferred Ideas

These were identified during discovery but are explicitly out of scope for the current implementation. They are tracked here for future work.

---

### 1. Additional Themes (Desert, Snow, Night)

**What:** Follow the same `RENDER_THEMES` + `_scene*()` pattern to add more visual themes — desert, snow, or night variants.

**Why deferred:** City & Nature is the immediate request from Leo. Once the theme-switching infrastructure (dropdown, offscreen buffer) is in place, adding more themes becomes straightforward.

**Potential approach:** Each new theme adds a `RENDER_THEMES` entry + a `_scene[Name]()` method + a display name in the dropdown. The offscreen buffer and theme selector UI built for City & Nature are reusable.

---

### 2. Leo's Detailed Mockups

**What:** Leo may provide more detailed visual mockups for the City & Nature theme or other themes in the future.

**Why deferred:** Current implementation is based on the WhatsApp conversation and tileset reference. The code should be structured so colors, element sizes, and densities are easy to tweak when more specific mockups arrive.

**Potential approach:** Keep all visual constants (colors, sizes, densities) grouped at the top of the scene method or in the `RENDER_THEMES` config, not scattered through drawing code.

---

### 3. Animated Elements (Swaying Trees, Chimney Smoke)

**What:** Add subtle animation to background elements — trees swaying, chimney smoke rising, water ripples.

**Why deferred:** Animations would require per-frame rendering of the background layer, defeating the offscreen buffer optimization. The simulation's O(N²) bottleneck with many cars means background performance matters.

**Potential approach:** Use a separate animation layer on top of the static offscreen buffer — only animated elements redraw each frame. Or use CSS animations on overlay elements if canvas performance is a concern.

---

---

### 4. Sheep on Farm Side (Session 2 — Not Selected)

**What:** Add sheep as a fourth animal species — fluffy white clusters, 2–4 per pen.

**Why deferred:** User selected cows, chickens, pigs. Sheep were offered but not chosen. Adding them would follow the same `_drawSheep(ctx, x, y, scale)` pattern as the other animals.

---

### 5. Parked Cars on Urban Side (Session 2 — Not Selected)

**What:** Small top-down car rectangles parked in front of houses.

**Why deferred:** Not selected during Session 2 discovery. Would follow the same prop-placement pattern as benches and lampposts.

---

## Source

These ideas were captured during the discovery phase for the City & Nature Background Theme but deferred for future implementation. See [DISCOVERY_City_Nature_Background.md](DISCOVERY_City_Nature_Background.md) Category 8 (Future Plans) for the original Q&A.

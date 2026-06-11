# Ideas: Visual State Indicators

**Generated from:** docs/DISCOVERY_Visual_State_Indicators.md
**Date:** 2026-03-15

## Deferred Ideas — both SHIPPED 2026-06-10

1. **Animated mode transitions** — ✅ SHIPPED. `Ren._car` blends indicator borders over ~120ms on trafficMode change (RGB lerp + dash switch at midpoint; fade in/out for none↔mode), tracked in a renderer-only Map keyed by car id. Card BO stays green (first sighting draws steady state).

2. **Interactive hover/tooltip** — ✅ SHIPPED. `Ren.carAt(cssX, cssY)` inverse-transforms the stored view and hit-tests rotated car rects; `index.html` shows a floating DOM tooltip (id, mode, speed, target, stuck ticks, batch, maneuver phase — PT/EN), throttled, active while paused.

## Source

These ideas were captured during the discovery phase for Visual State Indicators but deferred for future implementation. Both are UI/UX enhancements with no impact on simulation behavior.

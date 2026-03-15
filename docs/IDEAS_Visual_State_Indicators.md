# Ideas: Visual State Indicators

**Generated from:** docs/DISCOVERY_Visual_State_Indicators.md
**Date:** 2026-03-15

## Deferred Ideas

1. **Animated mode transitions** — Smooth fade between indicator states when a car changes trafficMode (e.g., yield→batch). Instead of instant visual switch, interpolate border color and dash pattern over 2-3 frames. Adds polish for the educational audience but requires per-car animation state tracking.

2. **Interactive hover/tooltip** — Hover over a car in the browser to see its full state info: trafficMode, speed, target, noProgressTicks, maneuver phase, batch priority, etc. Would be a powerful debugging tool AND educational aid. Requires mouse event handling on the canvas and a floating DOM tooltip or canvas-drawn overlay.

## Source

These ideas were captured during the discovery phase for Visual State Indicators but deferred for future implementation. Both are UI/UX enhancements with no impact on simulation behavior.

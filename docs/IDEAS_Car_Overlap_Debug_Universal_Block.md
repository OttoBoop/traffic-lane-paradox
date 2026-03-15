# Ideas: Car Overlap Debug & Universal Block

**Generated from:** docs/DISCOVERY_Car_Overlap_Debug_Universal_Block.md
**Date:** 2026-03-14

## Deferred Ideas

1. **Visual overlap debugger in browser** — Draw bounding boxes and highlight overlapping car pairs in red in real-time. Show SAT gap distance on canvas. Useful for interactive debugging but scoped out for this phase (headless-only diagnostic is sufficient).

2. **Spatial partitioning for SAT** — Replace the O(N²) broad-phase distance check with grid-cell spatial hashing. Each cell covers ~CAR_L × CAR_L. Only check pairs in the same or adjacent cells. Expected 6–8× reduction in SAT checks for dense scenarios.

3. **Pipeline simplification** — If the diagnostic check proves effective as a universal overlap gate, refactor the pipeline to use it as the single overlap prevention mechanism. Remove scattered inline SAT checks from `_commitPose` guardList, heading clamp guards, separation cascade checks, etc. Replace with one authoritative post-move check. Could simplify the codebase significantly while improving reliability.

## Source

These ideas were captured during the discovery phase for the Car Overlap Debug & Universal Block feature but deferred for future implementation.

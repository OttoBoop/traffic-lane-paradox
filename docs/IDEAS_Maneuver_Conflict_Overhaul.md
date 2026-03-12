# Ideas: Maneuver & Conflict Overhaul

**Generated from:** docs/DISCOVERY_Maneuver_Conflict_Overhaul.md
**Date:** 2026-03-11

## Deferred Ideas

These were identified during discovery but are explicitly out of scope for the current overhaul. They are tracked here for future implementation.

---

### 1. Maneuver Candidate Count Reduction (100 → 40)

**What:** Reduce the candidate set generated for maneuvering cars from ~100 unique candidates to ~40 focused candidates.

**Why deferred:** Could affect maneuver quality. The 4-phase wobble already sets `desSpd`/`desSt` before candidate generation, giving the planner a good starting point. Reducing candidates too aggressively might prevent the car from finding a valid escape path in tight geometries.

**Potential approach:** Remove the extra steer-sweep and reverse-magnitude layers from `_candidateSet` (lines 1318-1327) for maneuver mode. Keep the normal candidate set + a focused set of reverse speeds and wide steers aligned with `maneuverPerpDir`. Profile at 3L/40-car before and after.

**Expected gain:** Would halve maneuver-mode per-car cost (~100 → ~40–50 candidates), reducing SAT checks by ~50% for maneuvering cars.

---

### 2. Paradox Tuning

**What:** IDM and batch scheduler parameter calibration to reliably demonstrate Braess's paradox — 1L traffic should consistently complete faster than 2L+ traffic.

**Why deferred:** This is a separate tuning task. The current overhaul is mechanical bug fixes only. Paradox behavior may improve as a side effect (fewer false maneuver triggers = fewer fork jams), but guaranteed paradox demonstration requires deliberate calibration.

**Considerations:**
- `IDM_S0 = 6` and `IDM_T = 2` control following distance. Too tight causes overlaps; too loose lets single-lane traffic approach multi-lane speed.
- `BATCH_HOLD_TICKS = 24` and batch size (≤2) affect fork throughput.
- Must run monotonic speed test (card G or Test 3) after any IDM change.

---

### 3. Full Test Suite Classification Overhaul (A–Y Cards)

**What:** Run all 25 existing test cards (A–Y) through a deliberate RED→GREEN cycle with human review. Classify each card as `guard_green`, `known_red`, or `diagnostic` with confidence.

**Why deferred:** Many cards were created quickly without proper TDD validation. Treating `diagnostic` cards as authoritative pass/fail gates is risky. A systematic overhaul is a substantial effort (~25 card × RED→GREEN → human review).

**Approach:**
1. Run each card fresh: `node run_traffic_suite.js --id [A-Y]`
2. For passing cards: confirm the test is meaningful (not vacuously true)
3. For failing cards: determine if failure is expected or a real bug
4. Re-classify: `guard_green` (must always pass), `known_red` (expected failure, tracked), `diagnostic` (observability only)
5. Add forced-gridlock test (deliberately deadlock a fork, verify it clears within N ticks)

---

### 4. Spatial Partitioning for SAT Broad-Phase

**What:** Replace the current distance-based broad-phase filter (`PROJ_BROAD_PHASE = 60px`) with a spatial grid. Cars are bucketed into grid cells; only cars in neighboring cells are checked.

**Why deferred:** Future architecture work. The current broad-phase already eliminates ~80% of cars and is not the primary bottleneck (no early exit from candidate loop + excessive maneuver count are the real bottlenecks). Spatial partitioning would cut the effective N per SAT from ~6-8 to ~4-6 nearby cars, a modest additional gain.

**Expected gain:** ~6-8× reduction in SAT candidate checks per frame (from current with ~6-8 checked → with partitioning ~4-6 checked). More meaningful at 50+ cars.

**Prerequisite:** Fix the false-maneuver trigger first (current overhaul). Without that fix, spatial partitioning would still process 4-8 maneuvering cars with 2× candidate counts each — the real bottleneck isn't SAT breadth, it's maneuver overactivation.

---

## Source

These ideas were captured during the discovery phase for the Maneuver & Conflict Overhaul but deferred for future implementation. See [DISCOVERY_Maneuver_Conflict_Overhaul.md](DISCOVERY_Maneuver_Conflict_Overhaul.md) Category 8 (Future Plans) for the original Q&A.

# Traffic Lane Paradox Simulation

## Purpose

This simulation demonstrates how adding more lanes to a road can paradoxically increase travel time when vehicles must cross paths at a Y-intersection. The project is an interactive HTML/JavaScript application that runs entirely in the browser with no server dependencies.

Users set up side-by-side simulations with different lane counts (1 lane, 2 lanes, 3 lanes, etc.) and observe that single-lane traffic flows freely while multi-lane traffic creates crossing conflicts at the fork, slowing everyone down. This is a visual demonstration of a concept related to Braess's paradox in traffic network theory.

---

## Architecture

The simulation is a single HTML file (`traffic_v18.html`) backed by a shared simulation engine (`traffic_core.js`). No build system, no external dependencies beyond a Google Fonts import. The renderer runs in-browser; the simulation core also runs headlessly in Node.js for testing.

### Core Classes

**Road** constructs the road geometry for a given lane count and canvas size. It generates independent cubic bezier paths for every lane-branch combination, precomputes conflict zones where crossing paths intersect, and generates road boundary segments for wall collision detection. Road geometry adapts to canvas dimensions — behavior can vary between phone and desktop.

**Car** is a data object holding position (`x`, `y`, `th`), motion (`speed`, `steer`, `desSpd`, `desSt`), path tracking (`path`, `pathKey`, `pathIdx`, `prevCTE`), and traffic coordination state including `trafficMode` ('free', 'commit', 'yield', 'batch', 'maneuver', 'hold_exit'), `noProgressTicks`, `batchId`, `primaryBlockerId`, `maneuvering`, `maneuverPhase`, `maneuverTimer`, and `maneuverPerpDir`.

**Sim** runs the simulation tick loop. Each tick executes an ordered series of steps including lane detection, batch scheduler updates, traffic mode assignment, blocker classification and maneuver entry/exit logic, Stanley controller steering, IDM following distance, cone detection, wall avoidance, maneuver wobble overrides, branch speed floor, and finally the cost-based legal move selector that integrates the bicycle model. Step ordering matters — later steps override earlier ones.

**Ren** renders to an HTML5 canvas in three themes selectable via a dropdown in the UI:
- `classic` — dark road on dark background (utilitarian)
- `rioSatellite` — colorful aerial map style with Rio-inspired landmarks (church, island, mountains)
- `cityNature` — isometric houses on the left (urban), farm fields + barn + pond on the right, dense forest in the V-area between branches

Scenic themes are drawn to an offscreen buffer once per load/resize/theme-switch and stamped per frame via `drawImage()`, avoiding per-frame overhead. The rendered car shape and the SAT collision rectangle share the same constants — what the user sees is what collides.

### Key Design Principles

**Position changes only through the bicycle model.** No system directly modifies a car's `x`, `y`, or heading. All systems influence `desSpd` and `desSt`, which feed into the cost-based planner, which then calls the bicycle model to integrate position.

**Cars are rectangles with exact visual-collision match.** The rendered car shape and the SAT collision rectangle use the same constants (`CAR_L = 22`, `CAR_W = 13`). Zero discrepancy between what you see and what collides.

**Cost-based local motion planner selects the best legal move.** Each tick, every active car generates a set of (speed, steer) candidates. Each candidate is projected through the bicycle model, checked for legality (inside road bounds, no overlap with higher-priority committed poses or current poses of other cars), and scored. The highest-scoring legal candidate wins. In maneuver mode the candidate set is expanded to include reverse speeds and wide steer sweeps. This is the `_chooseLegalMove → _chooseTrafficMove → _chooseBestLegalCandidate` pipeline.

**Fork batch scheduler coordinates conflict zone access.** When two paths cross at the fork, the scheduler grants access to batches of up to 2 compatible same-target cars. Starvation counters prevent one branch from monopolizing the fork. Cars check downstream branch clearance before entering the conflict zone; if the target branch is full, the car enters `hold_exit` and waits before the zone.

**Traffic mode state machine drives coordination.** `trafficMode` progresses: `free` (open road) → `commit` (within `COMMIT_DIST = 90px` of fork, no voluntary lane changes) → `yield`/`batch`/`hold_exit` (fork access control) → `maneuver` (gridlock resolution). After crossing the fork, cars return to `free` on the branch.

**Maneuvering resolves gridlocks via wobble.** When `noProgressTicks` exceeds `NO_PROGRESS_THRESH = 60` for a car that is blocked and cannot find a forward legal move, the car enters maneuver mode. In maneuver mode, the car alternates through wobble phases (forward + perpendicular steer, reverse + opposite steer, etc.) to create clearance for the priority car. Up to `MAX_ACTIVE_MANEUVERS = 4` cars may maneuver simultaneously. Nearby stuck cars cascade into maneuver mode as well.

**Branch speed floor prevents accordion cascade.** On branches, if the gap to the car ahead exceeds `IDM_S0` and speed is positive, speed is forced to `v0`. This prevents tiny IDM oscillations from cascading into visible jams.

**dt subdivision prevents phone framerate issues.** When the browser delivers a large timestep (low framerate), the simulation breaks it into sub-steps of maximum 1.0 each, preventing the bicycle model from overshooting curves.

---

## Current State

### What Works Reliably

- Single-lane monotonic speed: cars on a branch never slow down. The core paradox premise holds.
- Zero SAT overlaps: hard constraint maintained across all configurations.
- Zero wall escapes: cars never exit the road surface.
- Left-right symmetry: 100% left and 100% right produce identical times.
- Fork batch scheduler: prevents blocked-exit admission; same-target runs no longer produce false conflict violations.
- Maneuvering: cars do wobble, reverse, and adjust angles to give way. Gridlocks can resolve.

### Known Rough Edges

**Framerate lag with many cars.** The cost-based planner runs SAT legality checks for every candidate against all nearby cars, every tick, for every car. At high car counts (3+ lanes, 20+ cars) this becomes expensive and causes visible framerate drops. The computational cost scales with O(N × candidates × N) per tick.

**Maneuver mode triggers too eagerly.** Cars sometimes enter maneuver mode when a reasonable forward passage exists. The trigger threshold and blocking conditions need tuning.

**Maneuver mode exits too slowly.** Cars linger in maneuver mode longer than necessary. In some cases a single car gets permanently stuck in maneuver mode — unable to exit, holding up resolution of the gridlock it was supposed to help clear.

**Throughput and paradox behavior under development.** In multi-lane mixed-traffic scenarios, the paradox demonstration and throughput scaling are not yet consistently meeting design targets. These are tuning goals, not safety issues.

---

## Testing Architecture

Tests share a registry of 25 labeled cards (A–Y) defined in `traffic_test_suite.js`. Two frontends consume the same registry:

- `red_visual_tests.html` — browser dashboard with live simulation rendering per card
- `run_traffic_suite.js` — Node.js CLI runner for headless automated checks

Cards are tagged `guard_green` (must stay passing), `known_red` (expected failures until fixed), or `diagnostic` (observability — no hard pass/fail verdict).

**To run a specific card:**
```bash
node run_traffic_suite.js --id S
node run_traffic_suite.js --id AA
```

**To run guard tests:**
```bash
node run_traffic_suite.js --id S --id X --id AA
```

### Test Card Overview

| Range | Purpose |
|-------|---------|
| A–E   | Legacy red questions: progress accumulation, lateral escape, lane-change liveness, conflict hard-deadlock, hard constraint guard |
| F–J   | Same-target stabilization: lane hold, 1L baseline, 2L/3L throughput, fork approach stability |
| K–P   | Collision harness family: rear-end queue, merge safety, merge liveness, fork conflict, dense queue, dt-spike legality |
| Q–Y   | Mixed-traffic and v20 acceptance: paradox race, completion, maneuver activation, progress trigger, merge safety under 50/50, spillback, fair alternation, late oscillation, stress completion |

**Important:** Many cards were created quickly and have not gone through proper RED→GREEN TDD validation. Treat `diagnostic` cards as observability tools, not authoritative pass/fail gates. A future priority is running each card through a deliberate RED→GREEN cycle with human review and grouping cards into clear categories.

### Hard Safety Guards (must always pass)

- Zero overlap — no car may ever overlap another car
- Zero wall escape — no car corner may exit the road surface
- Single-lane monotonic branch speed — no car on a branch slows down
- Visual-hitbox match — rendered shape equals SAT collision shape

---

## Known Issues and Future Work

**Maneuver tuning.** Three distinct problems need addressing: the entry trigger fires too eagerly (even when forward passage is available), the exit condition clears too slowly (cars linger), and occasionally a single car gets permanently stuck in maneuver mode and cannot exit, blocking the gridlock from fully clearing.

**Performance overhaul.** The planner's O(N²) SAT computation is the primary framerate bottleneck. Spatial partitioning (grid cells) would cut the effective N per SAT from all cars to ~4–6 nearby cars, reducing cost by ~6–8×.

**Test classification.** A systematic RED→GREEN pass over all 25 cards is needed: run each card failing first, implement or fix, confirm green. Group cards into `guard_green` / `known_red` / `diagnostic` with confidence. Consider: forced-gridlock test (deliberately deadlock a fork, verify it clears within N ticks).

**Paradox tuning.** In some multi-lane configs, 2L can complete faster than 1L. The paradox requires careful IDM and batch scheduler tuning to hold once multi-lane flow becomes efficient.

---

## Common Pitfalls

**Changing IDM parameters without testing monotonic speed.** `IDM_S0 = 6` and `IDM_T = 2` control following distance. Too tight causes overlaps. Too loose creates headspace that makes single-lane traffic slower than multi-lane, breaking the paradox. Run the monotonic speed test (card G or the headless Test 3) before touching IDM constants.

**Adding speed modifications after the bicycle model.** The bicycle model must be the last step that changes position. The `_chooseLegalMove` call is final. Anything that modifies `x`, `y`, or `th` after that violates the architectural contract.

**Bypassing the planner for maneuver-mode cars.** The planner is the sole arbiter of maneuver candidates. Do not add direct speed or position overrides for maneuvering cars outside of `desSpd`/`desSt` — the planner must evaluate them as candidates so legality checks still apply.

**Testing only at one canvas size.** Many bugs are resolution-dependent or framerate-dependent. Always test at phone resolution (110×700, dt=2) in addition to desktop (200×500, dt=1).

**Hardcoding visual parameters that depend on geometry.** Road dimensions, fork position, branch spread, and lane widths all adapt to canvas size. Visual elements must be computed dynamically or they will look wrong on different screen sizes.

**Deploying changes to 3+ lane mixed-traffic without a visual check.** Headless tests cannot catch visual wobble issues or maneuver behavior. For any change touching the planner, maneuver logic, or batch scheduler, run a 3L/20-car 50/50 simulation in the browser and observe.

---

## Repository Layout

| File | Purpose |
|------|---------|
| `traffic_v18.html` | Interactive browser UI — open this to run the simulator |
| `traffic_core.js` | Simulation engine: Road, Car, Sim, Ren classes and all physics |
| `traffic_test_suite.js` | Shared test card registry (A–Y), scenario definitions and verdict functions |
| `run_traffic_suite.js` | Node.js CLI runner for headless test execution |
| `red_visual_tests.html` | Browser visual regression dashboard (consumes `traffic_test_suite.js`) |
| `v18_plan.md` | Full design history: resolved decisions, execution order, hitbox spec, maneuvering spec, v19/v20 divergence analysis. **Primary reference for architecture decisions.** |
| `docs/DISCOVERY_Maneuver_Mode_Fix.md` | Root cause analysis of the maneuver trigger bug and fix approach |
| `docs/DISCOVERY_City_Nature_Background.md` | Discovery doc for the City & Nature visual theme (Leo Bloise's design) |
| `docs/PLAN_City_Nature_Background.md` | Implementation plan for the City & Nature theme |
| `docs/IDEAS_City_Nature_Background.md` | Deferred ideas from the City & Nature discovery (animated elements, more themes) |
| `docs/DISCOVERY_Maneuver_Conflict_Overhaul.md` | Discovery for maneuver & conflict logic overhaul + performance extension |
| `docs/PLAN_Maneuver_Conflict_Overhaul.md` | Implementation plan for maneuver/conflict fixes + performance optimizations |
| `docs/DISCOVERY_Traffic_Rio_Satellite_Visual_Restyle.md` | Discovery for the Rio satellite scenic theme |
| `docs/PLAN_Traffic_Rio_Satellite_Visual_Restyle.md` | Plan for the Rio satellite restyle |
| `verify_fork_width_wall_sync.js` | Geometry helper for fork-width wall synchronization |

---

## How to Make Changes

Read `v18_plan.md` first. It contains the full design rationale, the architectural decisions that were changed from the plan during implementation (v19 divergences), and the v20 traffic-handling layer specification.

**Before any deployment:**
- Run guard tests: `node run_traffic_suite.js --id S --id X --id AA`
- Run the 3L/20-car 50/50 browser simulation visually

**For planner changes** (`_candidateSet`, `_scoreCandidate`, `_chooseBestLegalCandidate`):
- Test at phone resolution (110×700), dt=2, 3L, 20 cars minimum
- Confirm zero overlaps and zero wall escapes still hold

**For maneuver changes** (`maneuvering`, `noProgressTicks`, wobble phases):
- Visual browser testing is essential — headless tests cannot catch visual wobble quality
- Check entry rate (is maneuver triggering when it shouldn't?), exit rate (are cars clearing maneuver within ~60 ticks?), and stuck-car behavior (can any single car get permanently stuck?)

**For renderer changes:**
- Verify syntax with `new Function(scriptContent)` to catch parse errors headlessly
- Run a basic 2L/10-car simulation to confirm rendering doesn't crash

**For new systems:**
- Define which step in the tick execution order the system occupies
- Specify what inputs it reads and what it modifies (only `desSpd` and/or `desSt` before the planner call)
- Add a targeted test card that validates the specific behavior

# Traffic Lane Paradox Simulation

## Purpose

This simulation demonstrates how adding more lanes to a road can paradoxically increase travel time when vehicles must cross paths at a Y-intersection. The project is an interactive HTML/JavaScript application that runs entirely in the browser with no server dependencies.

Users set up side-by-side simulations with different lane counts (1 lane, 2 lanes, 3 lanes, etc.) and observe that single-lane traffic flows freely while multi-lane traffic creates crossing conflicts at the fork, slowing everyone down. This is a visual demonstration of a concept related to Braess's paradox in traffic network theory.

---

## Architecture

The simulation is a single HTML file (`index.html` — GitHub Pages ready; formerly `traffic_v18.html`) backed by a shared simulation engine (`traffic_core.js`). No build system, no external dependencies beyond a Google Fonts import. The renderer runs in-browser; the simulation core also runs headlessly in Node.js for testing.

### Core Classes

**Road** constructs the road geometry for a given lane count and canvas size. It generates independent cubic bezier paths for every lane-branch combination, precomputes conflict zones where crossing paths intersect, and generates road boundary segments for wall collision detection. Road geometry adapts to canvas dimensions — behavior can vary between phone and desktop.

**Car** is a data object holding position (`x`, `y`, `th`), motion (`speed`, `steer`, `desSpd`, `desSt`), path tracking (`path`, `pathKey`, `pathIdx`, `prevCTE`), and traffic coordination state including `trafficMode` ('free', 'commit', 'yield', 'batch', 'maneuver', 'hold_exit'), `noProgressTicks`, `batchId`, `primaryBlockerId`, `maneuvering`, `maneuverPhase`, `maneuverTimer`, and `maneuverPerpDir`.

**Sim** runs the simulation tick loop. Each tick executes an ordered series of steps including lane detection, batch scheduler updates, traffic mode assignment, blocker classification and maneuver entry/exit logic, Stanley controller steering, IDM following distance, cone detection, wall avoidance, maneuver wobble overrides, branch speed floor, and finally the cost-based legal move selector that integrates the bicycle model. Step ordering matters — later steps override earlier ones.

**Ren** renders to an HTML5 canvas in five themes selectable via a dropdown in the UI:
- `classic` — dark road on dark background (utilitarian)
- `rioSatellite` — colorful aerial map style with Rio-inspired landmarks (church, island, mountains)
- `cityNature` — top-down houses on the left (urban, with parked cars), farm fields + barn + pond + animals (cows, pigs, chickens, sheep) on the right, dense forest in the V-area between branches
- `night` — cityNature geometry under a night veil: stars, moon, lamppost halos, warm house light spill, and car headlight glows
- `snow` — cityNature geometry under snow: white ground, snow-capped roofs and pines, frozen pond, falling snowflakes

Scenic themes are drawn to an offscreen buffer once per load/resize/theme-switch and stamped per frame via `drawImage()`, avoiding per-frame overhead. A lightweight animation layer (`Ren._animLayer`) draws per-frame sprites on top — chimney smoke, swaying canopies, pond ripples, twinkling stars, snowfall — as stateless functions of `Date.now()`, so sim determinism is untouched; an idle render loop keeps them moving while paused with the timer frozen. Hovering a car shows a live tooltip (mode, speed, target, stuck ticks, batch, maneuver phase — PT/EN). The rendered car shape and the SAT collision rectangle share the same constants — what the user sees is what collides (night headlight glows are scene lighting under the body, not body geometry).

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

*(Last verified 2026-06-10 via `npm run traffic:test:guards` and focused card runs.)*

### What Works Reliably

- Single-lane monotonic speed: cars on a branch never slow down. The core paradox premise holds.
- Zero SAT overlaps: hard constraint maintained across all configurations.
- Zero wall escapes: cars never exit the road surface.
- Left-right symmetry: 100% left and 100% right produce identical times.
- Fork batch scheduler: prevents blocked-exit admission; same-target runs no longer produce false conflict violations.
- Maneuvering: cars do wobble, reverse, and adjust angles to give way. Gridlocks resolve; the yield false-trigger and batch+stuck deadlock bugs are fixed (PLAN_Maneuver_Conflict_Overhaul Features 1–2).
- Guard suite green: S (2.67s), X (24.68s), AA (5.33s), AH (41.85s) all pass (times reflect the COMMIT_DIST=300 calibration).
- Braess paradox demonstrated: card Q green — 1L strictly fastest at 50/50 across 4 seed triples.

### The Paradox Works — and the traffic logic is honest now

**Card Q is green on all four seed triples** (2026-06-12): at 50/50 demand, 1 lane completes in 10.00s while 2/3 lanes take 13.28/14.22s (and up to 57s on unlucky seeds) — adding lanes makes everyone slower, as the model intends. Two rounds got it there: `COMMIT_DIST` 90→300 created real crossings (`v18_plan.md` §0.2), and the yield/maneuver correctness round fixed three behavior bugs while keeping the paradox calibrated (`docs/DISCOVERY_Yield_Maneuver_Correctness.md`):

- **Premature yields** (83–100% of yields!) — fixed by an ETA gate: a yield episode starts only on an actual arrival-time conflict with the active batch.
- **Granted cars reverse-wobbling at max steer** (up to 572 hybrid ticks + 92 overlaps on unlucky seeds) — fixed by wobble×grant mutual exclusion, a cascade guard, planner-level reverse exclusion, and a grant stall-release watchdog.
- **Multi-zone assignment overwrite** (a second zone's "all clear" cancelled a real yield on 3L+ paths) — fixed with nearest-zone precedence.

Permanent regression net: guard cards **BS/BT/BU/BV** (premature yield, batch∧maneuver hybrid, granted-crossing safety, yield idle) plus a flight recorder (`sim.debugTrace`), CLI timeline/repro tools (`trace_traffic_events.js`, `extract_repro.js`) and a browser debug overlay (`index.html?debug=1` or press `d`).

### Known Rough Edges

**Same-target throughput scaling below target.** Cards H/I are red: 2L=7.40s (target ≤5.75s), 3L=6.57s (target ≤3.83s) for 100%-left traffic.

**Framerate at high car counts.** Performance waves P1–P5 + sleep (Wave 4) cut 3L/40 wall time ~78%, the planner fast path hits ~84% of nominal moves, and a spatial hash grid (90px cells, live-updated at the `_commitPose` choke point) trims neighbor queries at 200+ cars; very dense scenarios can still tax slower devices.

---

## Testing Architecture

Tests share a registry of labeled cards (A–Y plus extensions AA–BP) defined in `traffic_test_suite.js`. Two frontends consume the same registry:

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
npm run traffic:test:guards
# equivalent to:
node run_traffic_suite.js --id S --id X --id AA --id AH
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

**Card BC — branch-stuck cars never maneuver.** Pre-existing red (pre-dates the calibration): the maneuver system only operates on the main segment, so a car stuck on a branch (card BC's scenario) waits forever. Needs branch-segment maneuver support or a scoped fix.

**Promote card Q to guard.** Q (paradox race) is `survey_green`; promote to `guard_green` once it has survived a few more sessions (it now holds on 4/4 seed triples).

**Test classification.** A systematic RED→GREEN pass over all cards is needed: run each card failing first, implement or fix, confirm green. Group cards into `guard_green` / `known_red` / `diagnostic` with confidence.

**Two-phase tick architecture.** Replace sequential commit (high-priority cars monopolize conflict resolution) with parallel intent + conflict resolution. Design notes in PLAN_Maneuver_Conflict_Overhaul §Feature 8; needs its own discovery before implementation.

**Other deferred items** (tracked in IDEAS docs): desert theme, full A–Y RED→GREEN test overhaul, overlap-prevention pipeline simplification, maneuver candidate count reduction.

*(Resolved since the last revision: maneuver entry/exit bugs — Features 1–2 of PLAN_Maneuver_Conflict_Overhaul; the O(N²) framerate collapse — performance waves P1–P5 + car sleep, −78% wall time at 80 cars; spatial hash broad-phase — card BQ; the paradox calibration — card Q green via COMMIT_DIST=300; night/snow themes, animated scene layer, hover tooltip, animated mode transitions, sheep + parked cars — card BR; premature yields, dangerous granted maneuvers, multi-zone assignment overwrite and the BA merge-completion regression — cards BS–BV + DISCOVERY_Yield_Maneuver_Correctness, −6.9% wall time as a side effect; the browser debug overlay shipped as `?debug=1`.)*

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
| `index.html` | Interactive browser UI — open this to run the simulator (formerly `traffic_v18.html`) |
| `traffic_core.js` | Simulation engine: Road, Car, Sim, Ren classes and all physics |
| `traffic_test_suite.js` | Shared test card registry (A–Y + AA–BP), scenario definitions and verdict functions |
| `run_traffic_suite.js` | Node.js CLI runner for headless test execution |
| `package.json` | npm scripts: `traffic:test:guards`, `traffic:test:survey`, `traffic:test:focus` |
| `red_visual_tests.html` | Browser visual regression dashboard (consumes `traffic_test_suite.js`) |
| `profile_planner_hotspots.js` | Planner profiler: hotspot wall times + fast-path hit/miss counters |
| `screenshot_visual_check.py` | Playwright screenshot automation for visual review |
| `brute_overlap_check.js` | Brute-force overlap diagnostic (Car Overlap Debug plan deliverable) |
| `sweep_paradox_params.js` | Staged parameter sweep that found the COMMIT_DIST=300 paradox calibration |
| `v18_plan.md` | Full design history: resolved decisions, execution order, hitbox spec, maneuvering spec, v19/v20 divergence analysis. **Primary reference for architecture decisions.** |
| `docs/DISCOVERY_Maneuver_Mode_Fix.md` | Root cause analysis of the maneuver trigger bug and fix approach |
| `docs/DISCOVERY_City_Nature_Background.md` | Discovery doc for the City & Nature visual theme (Leo Bloise's design) |
| `docs/PLAN_City_Nature_Background.md` | Implementation plan for the City & Nature theme (shipped) |
| `docs/IDEAS_City_Nature_Background.md` | Deferred ideas from the City & Nature discovery (animated elements, more themes) |
| `docs/DISCOVERY_Maneuver_Conflict_Overhaul.md` | Discovery for maneuver & conflict logic overhaul + performance extension |
| `docs/PLAN_Maneuver_Conflict_Overhaul.md` | Implementation plan for maneuver/conflict fixes + performance optimizations |
| `docs/IDEAS_Maneuver_Conflict_Overhaul.md` | Deferred ideas: paradox tuning, spatial partitioning, test overhaul |
| `docs/DISCOVERY_Visual_State_Indicators.md` | Discovery for per-mode car indicators |
| `docs/PLAN_Visual_State_Indicators.md` | Implementation plan for visual state indicators (shipped, commit cf6f3f6) |
| `docs/IDEAS_Visual_State_Indicators.md` | Deferred ideas: animated transitions, hover tooltip |
| `docs/DISCOVERY_Car_Overlap_Debug_Universal_Block.md` | Discovery for overlap diagnostic infrastructure |
| `docs/PLAN_Car_Overlap_Debug_Universal_Block.md` | Plan for overlap diagnostics (diagnostics shipped; fix is follow-up) |
| `docs/IDEAS_Car_Overlap_Debug_Universal_Block.md` | Deferred ideas: visual overlap debugger, pipeline simplification |
| `verify_fork_width_wall_sync.js` | Geometry helper for fork-width wall synchronization |

---

## How to Make Changes

Read `v18_plan.md` first. It contains the full design rationale, the architectural decisions that were changed from the plan during implementation (v19 divergences), and the v20 traffic-handling layer specification.

**Before any deployment:**
- Run guard tests: `npm run traffic:test:guards` (S, X, AA, AH)
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

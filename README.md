# Traffic Lane Paradox Simulation

## Purpose

This simulation demonstrates how adding more lanes to a road can paradoxically increase travel time when vehicles must cross paths at a Y-intersection. The project is an interactive HTML/JavaScript application that runs entirely in the browser, with no server dependencies.

The user sets up side-by-side simulations with different lane counts (1 lane, 2 lanes, 3 lanes, etc.) and observes that single-lane traffic flows freely while multi-lane traffic creates crossing conflicts at the fork, slowing everyone down. This is a visual demonstration of a concept related to Braess's paradox in traffic network theory.

---

## Architecture

The simulation is a single HTML file containing all CSS, JavaScript, and rendering logic. There is no build system, no external dependencies beyond a Google Fonts import, and no module structure. Everything lives in one `<script>` tag.

### Core Classes

**Road** constructs the road geometry for a given lane count and canvas size. It generates independent cubic bezier paths for every lane-branch combination, precomputes conflict zones where crossing paths intersect, and generates road boundary segments. The road geometry adapts to the canvas dimensions, which means behavior can vary between phone screens and desktop.

**Car** is a data object holding position, heading, speed, steering angle, lane assignment, target branch, and various state flags (yielding, maneuvering, merging, stuck timer).

**Sim** runs the simulation tick loop. Each tick executes approximately 20 ordered steps including lane detection, reservation management, MOBIL lane changes, Stanley controller steering, IDM following distance, cone detection, wall avoidance, maneuvering, and the bicycle model position update. The execution order matters — later steps can override earlier ones, and the bicycle model in step 14 is the only system that modifies car positions.

**Ren** renders the simulation to a canvas element, drawing the road surface, lane markings, stop line, and cars.

### Key Design Principles

**Position changes only through the bicycle model.** No system directly modifies a car's x, y, or heading. All systems influence speed and steering angle, which the bicycle model then integrates into position changes. This was established in v14 after multiple failed attempts with ORCA velocity planning and SAT push-apart that produced physically impossible lateral movements.

**Cars are rectangles with exact visual-collision match.** The rendered car shape and the SAT collision rectangle use the same constants (CAR_L, CAR_W). What the user sees is what collides.

**The forward cone is directional.** A car behind you is not a conflict. The cone detection system only fires for cars that are ahead and encroaching on the detecting car's lane. Same-direction same-lane cars are handled by IDM, not the cone.

**The reservation system governs fork crossing priority.** When two paths cross at the fork, only one car passes at a time. The yielding car stops before the conflict zone. The reservation is granted based on estimated arrival time with a persistent tiebreak for simultaneous arrivals.

**Branch speed floor prevents accordion cascade.** On branches, if the gap to the car ahead exceeds the IDM minimum gap, speed is forced to v0. This prevents tiny IDM fluctuations from cascading through long queues into visible traffic jams.

**dt subdivision prevents phone framerate issues.** When the browser delivers a large time step (low framerate phone), the simulation breaks it into sub-steps of maximum 1.0 each. This prevents the bicycle model from overshooting curves.

---

## Current State (as of v18 visual)

### What Works Well

Single-lane traffic flows at full speed through both branches with zero slowdowns, verified by a monotonic speed test across multiple canvas sizes and dt values. The paradox demonstrates correctly: at 50/50 left-right split with 10 cars, 1 lane finishes faster than 2 or 3 lanes. Throughput scales correctly with lane count when all cars go to the same branch. Left-right symmetry is verified. Stress tests with 40+ cars complete successfully. The maneuvering system activates during gridlocks.

### What Needs Fixing (v18 plan)

Cars can still visually overlap each other because the SAT system reacts after overlap occurs rather than preventing it. The planned fix is a projection-based check that computes whether the next frame's positions would overlap and clamps speed preemptively.

Cars can get stuck on walls because the wall avoidance system is reactive (steering override after proximity is detected) rather than predictive. The planned fix uses the same projection approach as car-car prevention.

Lane changes happen with insufficient safety distance, causing collisions. The planned fix enforces a minimum gap of 1.5x car length before MOBIL can initiate a lane change.

The intersection zone is too narrow for larger cars to curve through without hitting lane boundaries. The planned fix widens lanes in the fork region.

A coordinated maneuvering system is planned where yielding cars actively move aside when the priority car broadcasts its intent to pass. Blocking cars compute the perpendicular direction to the priority car's path and wobble forward/backward with max steering to create clearance. This cascades to neighboring cars as needed.

### Visual State

The road renders as a unified dark surface with dashed lane dividers on the main road and both branches. Inner branch edges are hidden in the intersection zone (computed dynamically from where the two inner edges geometrically separate) and drawn only on the branch portions where the two corridors are visually distinct. Outer branch edges are drawn fully. The fork point is at 50% of canvas height to give branches adequate visual space. Panels support horizontal scrolling and can be added or removed.

---

## Testing Architecture

Tests run headless in Node.js by extracting the simulation code from the HTML file and executing it without a browser. The renderer is excluded (tests stop at the line before `class Ren`). Tests use fixed seeds for reproducibility and run across multiple canvas sizes and dt values to catch resolution-dependent and framerate-dependent bugs.

### Key Test Categories

**Monotonic speed (Test 3):** Single lane, 10 cars, 50/50 split. Every car on a branch must have monotonically non-decreasing speed. Any decrease above 0.001 is a failure. This is the most important test because it validates the simulation's core promise that single-lane traffic never slows down.

**Throughput scaling (Test 4):** 1L, 2L, 3L at 100% single branch. 2 lanes must complete within 15% of half the 1-lane time, 3 lanes within 15% of one-third.

**Paradox (Test 5):** 1L, 2L, 3L at 50/50 split. 1 lane must finish fastest.

**Zero overlap (Test 1):** 3 lanes, 20 cars, 50/50 split. Zero SAT overlap detections. Any detection indicates a physics bug.

**Zero wall escape (Test 2):** Every frame, every car corner must be inside the road boundary. Any escape indicates a wall enforcement bug.

**Symmetry (Test 6):** 100% left vs 100% right must produce times within 15%.

Tests should always run at phone resolution (110x700) with dt=2 in addition to desktop resolution (200x500) with dt=1, because many bugs manifest only under phone conditions.

---

## Common Pitfalls

**Changing IDM parameters without testing monotonic speed.** IDM_S0 and IDM_T control following distance. Too tight causes overlaps. Too loose causes massive headspace that makes single-lane traffic slower than multi-lane, breaking the paradox.

**Adding speed modifications after the bicycle model.** The bicycle model must be the last thing that changes position. Any speed or position modification after it violates the architectural contract and will cause bugs.

**Testing only at dt=1 on a 200x500 canvas.** Many bugs are resolution-dependent or framerate-dependent. Phone conditions (110x700 canvas, dt=2-3) must always be tested.

**Cone detection interfering with same-lane following.** The cone must skip same-direction cars in the same lane. IDM handles following. If the cone fires on a following car, it crushes speed to 20% and creates massive headspace. The lane-aware filter and same-direction skip are critical.

**Hardcoding visual parameters that depend on geometry.** Road dimensions, fork position, branch spread, and lane widths all adapt to canvas size. Visual elements like inner edge cutoff points must be computed dynamically, not hardcoded, or they will look wrong on different screen sizes.

---

## Repository Layout

The core simulation lives in `traffic_v18.html` and `traffic_core.js`. The renderer-focused visual checks are in `red_visual_tests.html`, and the current implementation plan is documented in `v18_plan.md`.

This repository intentionally stays simple: open the HTML file in a browser to run the simulator, and use the plan document plus the README as the source of truth for behavior and constraints.

---

## How to Make Changes

Read `v18_plan.md` first. It contains the resolved design decisions, the full execution order per tick (20 steps), the hitbox response scenarios, the maneuvering system specification, and the complete test plan.

When modifying the simulation, always run at minimum the monotonic speed test and the throughput scaling test before deploying. These two tests catch the majority of regressions. Run the full 11-test suite before any major deployment.

When modifying the renderer, verify syntax with `new Function(scriptContent)` and run a basic simulation sanity check (does a 2-lane 10-car simulation complete?) before deploying. Visual changes cannot be tested headlessly — they require the user to review screenshots.

When adding new systems, define which step in the 20-step execution order the new system occupies, what inputs it reads, what outputs it modifies (speed and/or steering only), and how it interacts with adjacent steps. Add a targeted test that validates the specific behavior the new system provides.

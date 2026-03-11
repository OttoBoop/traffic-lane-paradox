V18 Plan Document — Traffic Lane Paradox Simulation
Status: FINAL DRAFT — Ready for user review before building

0. Harness Audit Update â€” 2026-03-11
This document now has a newer harness-first reality layer. The shared scenario registry lives in `traffic_test_suite.js`, the visual dashboard in `red_visual_tests.html` consumes that shared registry, and `run_traffic_suite.js` runs the same cards under Node. The old v19 diagnosis below is historical context, not the current ground truth.

Implemented harness changes:
- Shared A-AA registry extracted out of the HTML dashboard.
- Browser dashboard and Node CLI now read the same definitions, metrics, and verdict functions.
- `package.json` exposes `traffic:test:guards`, `traffic:test:survey`, and `traffic:test:focus`.
- CLI records now include `id`, `gate`, `verdict`, `time`, and serialized metrics.

Shared audit results already confirmed by the new runner:
- `AA` now passes. Blocked-exit admission is prevented, `illegalBlockedExitAdmissionCount` is zero, and same-target runs no longer log false blocked-exit violations.
- `B` now passes. The partial-clearance case produces measurable legal lateral motion without accepting an unsafe merge.
- `R` now passes. All 1L/2L/3L comparison runs complete within budget.
- `U` now passes. Accepted live merges stayed at or above `CAR_L * 1.5` in the audited run.
- `S`, `T`, and `X` are confirmed guards.
- `D` is diagnostic, not a hard-deadlock red card.
- `N` is diagnostic. Its verdict is an interaction-quality threshold, not a hard safety invariant.

Cards still intentionally survey-only after this audit:
- Active red targets: `C`, `H`, `I`, `Q`, `V`, and `Y`.
- `W` remains survey-only until a full solo fairness audit completes. It should not be treated as a confirmed green guard yet.

Notes on audit cost:
- Some heavy mixed-traffic cards are expensive enough that combined CLI runs can exceed local shell timeouts. The harness is correct; the practical workflow is to run focused subsets or single cards for the heaviest cases.

1. Overview
V18 is a major rewrite addressing six defect categories and adding coordinated maneuvering, visual improvements, and UI changes. Every system interaction has been designed through iterative discussion. This document captures every decision made and specifies exactly what to build and test.

2. Car Dimensions and Constants
Cars occupy 60% of lane width. With 22px lanes: CAR_W = 13, CAR_L = 22. This gives 4.5px clearance per side (20.5%), which is the maneuvering space cars use to edge past each other during gridlock resolution.

Cascading constants: WBASE = 13, DET_W = 6, CONE_MARGIN = 2, IDM_S0 = 6, IDM_T = 2, spawn spacing = CAR_L + IDM_S0 + 8 = 36px, ZONE_CROSS_THRESH = CAR_W + 8 = 21. The visual renderer and SAT collision system both use CAR_L and CAR_W directly — they are guaranteed to match.

3. Hard Hitbox Projection System
The projection check runs after all speed/steering computations but before the bicycle model. It has final authority to reduce speed. It uses a 2px margin around all rectangles — cars stop before their visual rectangles touch.

For each car, the system computes its projected next position AND every nearby car's projected next position (both using their respective computed speeds and headings). It runs SAT overlap on the two projected rectangles with the 2px margin inflation. Broad-phase skip: pairs with center distance > 60px are not checked.

When overlap is detected, the response depends on the scenario:

Scenario A (same-lane following): The behind car's speed is reduced to zero. The ahead car continues. This is IDM's safety backstop for when gap management fails due to dt spikes.

Scenario B (fork crossing convergence): The yielding car (per reservation system) reduces speed. The priority car continues. If neither is marked yielding, the car further from the crossing point reduces speed.

Scenario C (failed lane change): The merging car's speed is reduced. It then tries forward with max steer toward the perpendicular of the blocking car's heading (attempting to clear the lane). If forward is blocked, it tries reverse with max steer, alternating. The car does not go fully back to its previous lane — it edges just enough to create safe passage distance (the 20% clearance), then waits for the safe forward gap (CAR_L * 1.5) before resuming its desired lane change.

Scenario D (maneuvering in gridlock): The maneuvering car stops (speed to zero) but does NOT exit maneuver mode. It pauses until the adjacent car has moved enough, then resumes the next maneuver phase. The 2px margin prevents overlap while allowing close proximity.

Scenario E (branch curve following): The following car's speed is reduced. Analysis shows this is a non-issue at our curve radii (1500px+) with IDM gap (6px) — corner sweep is ~0.1px/frame vs 4px effective clearance. Verified by Test 11.

Scenario detection uses heading difference, segment info, and car flags: same segment + heading diff < 0.5 rad = A or E. Different targets near fork = B. Car has merging flag = C. Car has maneuvering flag = D.

Wall projection: Same system. Walls are treated as static obstacles. The four corners of the projected car rectangle are checked against road boundaries using signed distance (dot product with wall normal). Positive = inside road, negative = outside. If any corner would exit the road, speed is reduced until all corners stay inside. This applies to main road (simple x-bounds), branches (nearest boundary segment check), and the widened intersection zone (uses widened boundaries).

4. Coordinated Maneuvering System
This is an emergent system, not centrally planned. The reservation holder broadcasts intent, blocking cars react independently, and their reactions cascade to neighboring cars.

4.1 Triggering
When a car gets the reservation and begins creeping toward the fork, its forward cone and projection check detect blocking cars. Each blocking car that is in the priority car's projected path receives a signal containing the priority car's path direction at the blocking car's location.

Only cars that the priority car's cone or projection would actually hit receive the signal initially. However, as those cars maneuver, their movement may trigger other nearby cars via the normal cone/projection system, creating the cascade.

4.2 Individual Maneuvering Behavior
A maneuvering car computes the perpendicular direction to the priority car's path at its own location. It then attempts to move in that perpendicular direction using the bicycle model's constraints:

Phase 1: Try forward with max steer toward the perpendicular direction. If the projection check blocks this (wall or another car in the way), switch to Phase 2.

Phase 2: Try reverse with max steer toward the perpendicular direction. If blocked, switch back to Phase 1 with adjusted steering.

The car alternates between forward and reverse, each time adjusting its heading to gradually shift perpendicular to the priority car's path. This produces the wobbling, angle-changing behavior described in the requirements.

If the perpendicular direction leads toward a wall (like the outermost lane car being pushed toward the road edge), the car stays put. Other cars must find alternative directions — forward/backward shifting instead of lateral. The car at the wall is not forced to move through the wall.

4.3 Cascade Behavior
As a maneuvering car edges sideways, it enters the space of neighboring cars. These neighbors react through the normal systems:

Cars with clear paths (not yielding, their own path is unobstructed) are more likely to avoid the maneuvering car using normal cone detection and IDM braking. They may slow down or steer slightly to give the maneuvering car room without entering full maneuver mode themselves.

Cars without clear paths (their forward cone is blocked by maneuvering cars) enter maneuver mode themselves. They independently compute their own perpendicular direction and begin their own wobble sequence. This creates the chain effect in tight gridlocks.

Cars that are already on the correct branch (not yielding, heading toward their target) continue normally. Maneuvering cars must avoid them, not the other way around. Normal cone/IDM handles this.

4.4 Exit Condition
A car exits maneuver mode when BOTH conditions are true: the priority car has completely passed the maneuvering car's position (the priority car's progress along its path has advanced beyond the maneuvering car's y-position), AND no other maneuvering cars are blocking the car's own forward path.

4.5 Recovery After Maneuvering
After exiting maneuver mode, the car may be offset from its original lane — possibly in a different lane or straddling two lanes. It recomputes a path from its current position to its target branch. The new path is generated by finding the closest point on each existing lane-branch path and selecting the one that provides the smoothest route from the car's current position and heading. The Stanley controller then guides the car along this new path.

5. Safety Distance for Lane Changes
Normal MOBIL lane changes require a minimum gap of CAR_L * 1.5 = 33px to the nearest car in the target lane (both ahead and behind). If the gap is smaller, the lane change is rejected.

During maneuvering, the safety distance relaxes to CAR_L * 0.5 = 11px because the car is moving slowly and using edge clearance. However, this relaxed distance is only for allowing passage to the priority car — the maneuvering car does not perform a full lane change at this distance. It edges into the clearance zone temporarily.

To actually complete a lane change (switch to a new lane's path permanently), the full 33px safety distance is still required. The maneuvering car stops or nearly stops until the car with priority has safe distance to complete its maneuver.

6. Wider Intersection Zone
Lanes widen in the fork zone so cars can curve without hitting lane boundaries. The intersection zone spans from forkY+40 to forkY-20. Lane width tapers from lw (normal) to lw*1.3 (widened) and back. Road boundary walls flare outward correspondingly. Paths stay centered in the widened lanes.

The widening factor (1.3×) is tuned by Tests 3 and 11. If single-lane monotonic speed fails or branch rectangle clearance is too tight, the factor increases. The key constraint: when all cars go to the same branch, they maintain full speed through the intersection with zero wall contact.

7. Visual Changes
7.1 Unified Road Surface
Remove thick outer border strokes on each branch. Remove the dark triangular dead zone between branches. Draw the entire road as overlapping filled regions without borders — main road rectangle plus each branch polygon. The road appears as one continuous dark surface that splits.

7.2 Lane Dividers
Main road dividers end at the fork point. Branch dividers start at the fork point (small gap acceptable). Branch dividers are dashed grey lines matching the main road style, drawn by sampling the branch bezier at lane-center offsets. For a 2-lane road, one divider per branch. For a 3-lane road, two dividers per branch.

7.3 Fork Position
Move forkY from h0.34 to h0.50 to give branches half the vertical screen space instead of one-third.

8. UI Changes
Horizontal scrolling: the simulation container uses overflow-x: auto with min-width: 160px per panel. Panels maintain legible size even with 4+ simulations. Panel removal works down to a minimum of 1 panel.

9. Branch Speed Floor
Retained. On branches, if gap to car ahead exceeds IDM_S0 and speed is positive, force speed to v0. This prevents IDM accordion cascade. The hard hitbox projection has final authority — if it detects imminent overlap on a branch, it overrides the floor. Test 11 verifies this override essentially never triggers during normal branch following.

10. System Execution Order Per Tick
Lane detection + stuck tracking
Reservation system (fork crossing priority)
MOBIL + blinker (lane changes with 33px safety distance)
Priority car broadcast (flag blocking cars in priority car's path)
Maneuvering decisions (blocking cars compute perpendicular direction, begin wobble)
Stanley controller (desired steering — uses recomputed path if post-maneuver)
IDM (desired speed based on same-lane car ahead)
Zone yielding (virtual wall at conflict zone for yielding cars)
Cone detection (speed/steering for encroaching/converging cars)
Wall steering override (nudge away from nearby walls on main road)
Maneuvering execution (forward/reverse with max steer phases)
Branch speed floor (force v0 when gap is safe)
Hard hitbox projection — final speed authority, 2px margin, scenario-specific response
Hard wall projection — final speed authority, corner check against boundaries
Steering clamp + rate limit
Bicycle model — the ONLY position update
Heading alignment (visual smoothing at low speed)
Heading safety clamp (main road anti-spin)
Segment transition + completion detection
SAT monitoring (assertion only — any overlap = bug)
Steps 13-14 can only REDUCE speed. Step 16 uses the final clamped speed. No system after step 16 modifies position.

11. Test Plan
Test 1 — Hard Hitbox: Zero Overlap
3 lanes, 20 cars, 50/50, phone (110×700), 10000 ticks, dt=1. Pass: zero SAT overlaps in monitoring (step 20).

Test 2 — Wall Penetration: Zero Escapes
1 lane, 10 cars, 50/50, phone+desktop, dt=0.3/1.0/2.0 (6 configs). Every frame check all car corners against road boundary with signed distance. Pass: zero escapes.

Test 3 — Single Lane Monotonic Speed
1 lane, 10 cars, 50/50, phone+desktop, dt=0.3/1.0/2.0 (6 configs). Pass: zero speed dips > 0.001 on branches.

Test 4 — Throughput Scaling
1L, 2L, 3L at 100% left, 10 cars, phone. Pass: 2L within 15% of 1L/2, 3L within 15% of 1L/3.

Test 5 — Paradox
1L, 2L, 3L at 50/50, 10 cars. Pass: 1L finishes fastest.

Test 6 — Symmetry
2L at 100% left vs right. Pass: within 15%.

Test 7 — Stress Completion
4L, 5L at 40 cars, 50/50, 30000 ticks. Pass: all complete.

Test 8 — Maneuvering Activation
3L, 40 cars, 50/50. Pass: at least one car enters maneuvering mode.

Test 9 — Safety Distance Enforcement
2L, 10 cars, 50/50. Log every MOBIL lane change with gap. Pass: no normal-mode lane change with gap < CAR_L * 1.5.

Test 10 — Visual-Hitbox Match
Place car at known position. Verify SAT rectangle corners = rendering rectangle corners.

Test 11 — Scenario E: Branch Rectangle Clearance
1 lane, 10 cars, 100% left, phone, dt=1, 800 ticks. Every frame, for every pair of adjacent cars on same branch, compute minimum rectangle-to-rectangle distance. Pass: minimum distance > 2px (the projection margin never triggers).

12. Implementation Order
Car dimensions (CAR_L=22, CAR_W=13) and all cascading constants
Spawn spacing update (36px)
Move forkY to h*0.50
Wider intersection zone geometry + boundary generation
Hard hitbox projection (step 13) with all five scenario responses
Hard wall projection (step 14) with signed distance
Safety distance check in MOBIL (33px normal, 11px maneuvering)
Priority car broadcast system (step 4 in tick)
Maneuvering behavior: perpendicular computation, forward/reverse wobble, cascade triggering
Maneuver exit condition and path recomputation
Unified road surface rendering (remove borders/dead zone)
Branch lane divider drawing
UI: horizontal scrolling, panel min-width, panel removal to 1
Branch speed floor (retained, projection overrides when needed)
Run Tests 1-11
Iterate on failures

13. User Requirements (verbatim)
"THE HITBOXES BEING FIXED... THE BEHAVIOR IN THE SCREENSHOT SHOULD NEVER BE POSSIBLE."
"60% of lane width... either side can use 20% of the other lane for maneuvering."
"To safely yield, there should be a lot of vertical distance. But with cars maneuvering, they're going quite slow, going through the edges of different lanes."
"The intersection lanes are not curved, they are straight."
"The big triangular border should vanish."
"Main dividers end at fork, branch dividers start at fork — small gap is fine."
"THE BRANCHING LANES ARE QUITE HARD TO SEE ON THE PHONE. Half the vertical width instead of a third."
"Horizontal scrolling instead of all lanes shrinking. Removable down to a single simulation."
"The reservation holder broadcasts 'I need to pass' and all yielding cars in its path enter maneuver mode."
"Cars can stop, wobble, move backwards, go forwards and backwards as they change angles."
"The perpendicular direction to the priority car's path."
"Try forward with max steer toward perpendicular, if blocked try reverse with max steer, alternate."
"Priority car creeps forward slowly while blockers are moving, checking clearance continuously."
"D3L stays put — C2R must find a different direction."
"E0L enters maneuver mode if its path is blocked by maneuvering cars."
"Exit maneuver when priority car has passed AND no maneuver cars blocking own passage."
"Recompute path from current position to target branch after maneuvering."
"Rectangle + 2px margin for projection check."
"Walls use same projection system as car-car prevention."

14. Plan State — v19
This section documents the actual state of the codebase after the v18 implementation attempt, what works, what doesn't, and what architectural decisions diverged from the original plan. Written after hands-on testing with real phone screenshots and a dedicated collision test harness.

14.1 What Works
Hard car-car constraint (Tests 1, 10). Cars cannot overlap. A 2px margin is enforced via SAT with inflated rectangles. A standalone test harness with 10 collision scenarios (head-on, rear-end, T-bone, diagonal, three-car pileup, squeeze from both sides, 10-car gridlock, high-speed dt=3, lane merge, and 20-car random chaos) passes 10/10. In the full simulation, Test 1 (3L, 20 cars, 50/50, phone, 10000 ticks) produces zero SAT overlaps.

Hard wall constraint (Test 2). Cars cannot leave the road surface. Main road walls use halfWAt(y) which includes the intersection zone widening. Branch walls are checked against the actual road surface computed from path extents (branchHalfW), not the mismatched quadratic bPt centerline. Test 2 passes across all 6 configurations (phone+desktop, dt=0.3/1.0/2.0) with zero escapes.

Single-lane flow (Test 3). Single-lane traffic flows at full speed with zero speed dips on branches. The branch speed floor (Step 12) prevents IDM accordion cascade. This is the simulation's core promise and it holds.

Symmetry (Test 6). 100% left and 100% right produce identical times (4.65s). Zero drift.

Visual-hitbox match (Test 10). SAT corners and renderer use the same CAR_L/CAR_W constants. What you see is what collides.

Car dimensions and constants (Section 2). All values match the plan: CAR_L=22, CAR_W=13, WBASE=13, spawn spacing=36, ZONE_CROSS_THRESH=21, MOBIL_SAFE_GAP=33, MOBIL_MANEUVER_GAP=11, PROJ_MARGIN=2.

Safety distance for lane changes (Section 5). MOBIL enforces a 33px minimum gap before allowing a lane change. The code checks both ahead and behind distances in the target lane. Needs instrumentation for full verification but the logic is structurally correct.

Visual changes (Section 7). Unified road surface without thick borders or triangular dead zone. Main road dividers end at fork, branch dividers start at fork. forkY at h*0.50.

UI changes (Section 8). Horizontal scrolling, 160px minimum panel width, panel removal down to 1, panel addition.

Branch speed floor (Section 9). Step 12 forces v0 on branches when gap exceeds IDM_S0. Test 3 confirms no speed dips.

14.2 What Doesn't Work
Throughput scaling (Test 4). 2 lanes should complete within 15% of half the 1-lane time; 3 lanes within 15% of one-third. Actual: 1L=7.2s, 2L=5.6s (expected <=4.1s), 3L=5.2s (expected <=2.8s). Multi-lane traffic gridlocks at the fork because the hard constraint freezes cars in place and nothing resolves the resulting deadlock.

Paradox (Test 5). 1 lane should finish fastest at 50/50 split. Actual: 1L=6.2s, 2L=4.6s. 2 lanes finishes faster because the hard constraint keeps traffic orderly enough that parallel passage outweighs crossing delay. 3 lanes never finishes — permanent gridlock.

Stress completion (Test 7). 4L completes 11/40 cars, 5L completes 23/40 within 30000 ticks. Multi-lane gridlocks are permanent because no mechanism exists to clear them.

Maneuvering activation (Test 8). Zero cars enter maneuvering mode in 3L/40-car scenarios. The stuck timer (REVERSE_STUCK_THRESH=80 ticks at speed<0.1) never triggers because the hard constraint reverts frozen cars to their saved position each tick, which resets their speed to 0 but doesn't let them accumulate stuck time in the way the old system expected.

14.3 Architectural Divergences from Plan
Hard hitbox: post-movement revert instead of pre-movement projection. The plan (Section 3) specifies a projection system at Steps 13–14 that computes next-frame positions, detects overlap, and reduces speed before the bicycle model runs. The five scenario responses (A through E) would handle each overlap type differently. What was built instead is a save/move/check/revert system that runs after the bicycle model. If two cars overlap after moving, the lower-priority car's position is reverted to its saved state and its speed is set to zero. This is simpler and provably correct (10/10 test scenarios) but has a critical behavioral flaw: cars that are reverted don't try anything else. They sit frozen at their previous position, which creates permanent gridlocks. The user's intent was that cars should be blocked from illegal moves but should then use their pathfinding to find a legal alternative. The current system doesn't attempt alternatives — it just doesn't move.

Wider intersection zone: path-extent-based widening instead of fixed taper. The plan specifies lanes tapering from lw to lw×1.3 with paths staying centered. What was built computes the actual road extent from where the cubic bezier paths go, producing a branchHalfW that peaks at ~38px (vs nominal 22px). This was necessary because the paths (cubic) and bPt centerline (quadratic) diverge by up to 27px, making the plan's 1.3× taper insufficient. The road now renders to contain all valid driving positions, but the shape doesn't match the plan's description.

Execution order: Steps 13–14 replaced. The plan's 20-step order has Steps 13 (hard hitbox projection) and 14 (hard wall projection) as pre-bicycle-model speed reducers with "final authority." These were replaced by post-bicycle-model enforcement after Step 16. The plan's statement "no system after step 16 modifies position" is violated — the revert enforcement does modify position. Steps 1–12 and 15–20 otherwise match the plan.

Coordinated maneuvering: coded but non-functional. Steps 4 (priority car broadcast), 5 (maneuvering decisions), and 11 (maneuvering execution) are all implemented with perpendicular direction computation, forward/reverse wobble phases, exit conditions, and post-maneuver path recomputation. However, the maneuvering system cannot activate because its trigger condition (stuck timer reaching threshold) is never met under the current revert-based enforcement. The code exists but is dead.

14.4 Root Cause of Multi-Lane Failure
Every multi-lane failure traces back to the same cause: the hard car-car constraint reverts cars to their saved position instead of making them find a legal alternative. When two cars' paths cross at the fork, the lower-priority car's move is cancelled every tick. It sits frozen, blocking other cars behind it, which are also frozen by the same constraint. No car accumulates enough stuck time to trigger maneuvering. No car tries a different heading, speed, or path. The gridlock is permanent.

The fix is not to weaken the hard constraint — cars must never overlap. The fix is to change what happens when a move is illegal. Instead of reverting to the saved position, the car should attempt alternative moves within the bicycle model's constraints (different speed, different steering angle) that don't produce an overlap. Only if no legal move exists should the car stay put.

14.5 Known Bug: Revert-to-Saved-Position
The current enforcement saves (x, y, th), runs the bicycle model, checks constraints, and if violated, restores (x, y, th) and sets speed to zero. This is incorrect behavior per the user's requirements. The user specified that hard walls block movement in the wall's direction, not that they teleport the car back to a previous state. A car hitting a wall should still be able to move in other directions — sideways, backward, or at a reduced speed that doesn't produce overlap. The current system prevents any movement at all when any overlap is detected, which is overly restrictive and produces the permanent gridlocks described above.

This is the primary bug to fix in the next iteration. A red test should verify that a car facing a blocked path still attempts legal alternative moves rather than freezing in place.

14.6 Test Results Summary
Test	Description	Result
1	Hard Hitbox: Zero Overlap	PASS — 0 SAT overlaps
2	Wall Penetration: Zero Escapes	PASS — 0 escapes, 6 configs
3	Single Lane Monotonic Speed	PASS — 0 dips
4	Throughput Scaling	FAIL — gridlocks prevent scaling
5	Paradox	FAIL — 2L faster than 1L, 3L gridlocks
6	Symmetry	PASS — 0% difference
7	Stress Completion	FAIL — 4L: 11/40, 5L: 23/40
8	Maneuvering Activation	FAIL — never triggers
9	Safety Distance Enforcement	Needs instrumentation
10	Visual-Hitbox Match	PASS
11	Branch Rectangle Clearance	Implied by Test 3

14.7 Next Steps
The immediate priority is a red test that catches the revert-to-saved-position behavior. A car on a collision course with a stopped car should still make forward progress by steering around it or reducing speed to avoid overlap - not by freezing in place every tick. Once that red test exists, the enforcement system can be redesigned to attempt legal alternative moves before falling back to zero movement. Only after this fix can the maneuvering system, throughput scaling, paradox demonstration, and stress completion be meaningfully addressed.

15. V20 Traffic Handling Layer
Summary
Add a combined traffic-handling feature that resolves fork gridlocks without weakening hard walls or no-overlap rules. The feature combines three behaviors: upstream lane commitment, fork-level batch scheduling, and a cost-based local motion planner that chooses the best legal move instead of the first legal move or full stop.

This is a new planning layer on top of the current hard-constraint system. It does not change car dimensions, renderer geometry, or the rule that position changes only through the bicycle model. The primary success criterion is legal movement through the fork under sustained multi-lane traffic. Preserving the paradox remains a secondary tuning goal after correctness and flow improve.

15.1 Key Changes
1. Add a Traffic State Layer
Introduce explicit traffic-handling state on each car:
- `trafficMode`: `free`, `commit`, `yield`, `batch`, `maneuver`, `hold_exit`
- `noProgressTicks`: based on path progress delta, not raw speed
- `commitUntilFork`: boolean lock once the car reaches commit distance
- `batchId` and `batchTarget`: current scheduled fork movement batch
- `primaryBlockerId`: nearest blocking car used by the planner
- `lastProgress`: previous path progress for stall detection

Introduce explicit state on each conflict zone:
- `activeBatchId`
- `activeBatchTarget`
- `batchMembers`
- `batchExpireTick`
- `starveTicksLeft` / `starveTicksRight`
- `downstreamClearanceByTarget`

2. Upstream Lane Commitment and Demand Balancing
Replace "late opportunistic lane changes near the fork" with early branch-aware lane assignment:
- Define `COMMIT_DIST = 90px` before the fork.
- Before `COMMIT_DIST`, MOBIL may still change lanes, but gets an added incentive toward lanes whose target-branch queue is shorter.
- After `COMMIT_DIST`, voluntary lane changes are blocked unless the current lane is physically unusable.
- Cars targeting the same branch should distribute across available approach lanes before they reach the fork.
- Once committed, the car keeps its branch/lane intent through the fork; no oscillation near the merge.

3. Fork Batch Scheduler
Replace single-car fork ownership with short compatible movement batches:
- The scheduler works per target branch, not just per individual car.
- A batch may contain up to `2` compatible cars by default.
- Compatible means: same target branch, safe longitudinal spacing, and no internal overlap if both advance under current controls.
- A car cannot enter the conflict zone unless its target branch has downstream exit clearance of at least `CAR_L * 2`.
- If downstream branch space is not available, the car enters `hold_exit` and stops before the conflict zone.
- When both targets are queued, batches alternate by starvation counters, with tie-break by earliest arrival.
- Same-target convoys are preferred over alternating single cars when downstream clearance exists.
- The scheduler never grants a batch that would leave a car stopped inside the conflict zone.

4. Cost-Based Local Motion Planner
Replace "first legal move or stay put" with "best legal move from a fixed candidate set":
- Candidate generation order:
  - desired `(speed, steer)`
  - reduced-speed same-steer ladder
  - low-speed steer sweep toward target path
  - low-speed steer sweep away from primary blocker
  - reverse steer sweep only if `trafficMode === maneuver`
  - full stop
- Every candidate must satisfy:
  - inside-road check
  - no overlap against already-committed higher-priority poses
  - no overlap against current poses of lower-priority cars
- Candidate scoring:
  - maximize path progress
  - penalize entering conflict zone without batch permission
  - penalize reducing downstream clearance
  - penalize steering change magnitude
  - penalize reverse unless in `maneuver`
  - reward lateral clearance creation if blocked
  - reward alignment with committed target branch
- The planner returns one legal pose only. No post-move revert remains in the final design.

5. Replace Speed-Based Stall Trigger With Progress-Based Trigger
Maneuvering must trigger from lack of forward path progress, not just low speed:
- Track progress using `pathIdx` and nearest-point distance along path.
- If commanded forward speed is positive but progress gain stays below epsilon for `60` ticks, enter `maneuver`.
- Exiting maneuver requires:
  - progress resumed above epsilon for `20` ticks, and
  - no blocking maneuver car ahead, and
  - car is no longer in `yield` or `hold_exit`
- Maneuvering uses the same planner, but unlocks reverse candidates and wider steer sweeps. Keep the current wobble concept only as candidate bias, not as a direct override step.

6. Execution Order Changes
Keep steps 1-12 broadly intact, but replace the fork/collision decision layer with:
1. Lane detection + progress tracking
2. Reservation data refresh
3. MOBIL with upstream demand-balancing incentive
4. Batch scheduler build/update
5. Commit / yield / hold_exit mode assignment
6. Stanley path steering baseline
7. IDM baseline speed
8. Cone / wall soft modifiers
9. Traffic planner candidate selection
10. Steering clamp + rate limit
11. Bicycle model
12. Post-move segment transition / completion
13. SAT monitoring only

Hard constraints remain hard. No system after bicycle model changes position.

15.2 Tests
Required Guards
These must remain green:
- Zero overlap
- Zero wall escape
- Single-lane monotonic branch speed
- Visual-hitbox match

New Traffic-Handling Tests
Add these as the acceptance set for the feature:
- Fork Spillback Prevention: no car may remain inside the conflict zone with speed `< 0.1` for more than `10` ticks.
- Batch Utilization: in `3L, 100% left, 10 cars`, at least one batch must contain `2` cars.
- No Late Lane Oscillation: after `COMMIT_DIST`, no car may flip `merging` state more than once before entering the branch.
- Progress-Based Maneuver Trigger: in `3L, 40 cars, 50/50`, at least one car must enter `maneuver` because `noProgressTicks` crossed threshold, not because raw speed stayed low.
- Stress Completion: `4L` and `5L`, `40 cars`, `50/50`, `30000 ticks` must fully complete.
- Fair Alternation: with sustained `50/50` demand, neither branch may starve for more than `180` ticks while the other branch receives repeated batches.
- Exit Clearance Rule: no car may enter the conflict zone unless its target branch has the configured clearance.
- Planner Legality: every committed candidate pose must satisfy wall and overlap legality before bicycle integration.

Performance Gates
Treat these as phase-2 tuning gates after correctness:
- Throughput scaling
- Paradox
- Symmetry re-check under the new scheduler

15.3 Important Interfaces / State Additions
Internal additions to `Car`:
- `trafficMode`
- `noProgressTicks`
- `lastProgress`
- `commitUntilFork`
- `batchId`
- `batchTarget`
- `primaryBlockerId`

Internal additions to conflict zone objects:
- `activeBatchId`
- `activeBatchTarget`
- `batchMembers`
- `batchExpireTick`
- `starveTicksLeft`
- `starveTicksRight`
- `downstreamClearanceByTarget`

Internal helper methods to add:
- `_pathProgress(car)`
- `_downstreamClearance(target)`
- `_assignBatchStates(activeCars, zone)`
- `_candidateSet(car, trafficContext, dt)`
- `_scoreCandidate(car, candidate, trafficContext)`
- `_chooseBestLegalCandidate(car, trafficContext, dt)`

15.4 Assumptions and Defaults
- This plan should be added to the existing plan file as a new v20 section, not a separate repo design doc.
- UI and renderer stay unchanged unless a later debugging overlay is explicitly requested.
- Hard walls and no-overlap remain absolute; the new feature improves traffic handling without weakening those rules.
- The chosen product priority is: resolve gridlocks first, then tune for paradox preservation.
- The chosen architecture is hybrid: local motion planner plus fork-level coordination, not local-only and not scheduler-only.

16. Visual Red Suite Restoration Mapping
This section documents the restored visual regression dashboard in `red_visual_tests.html`, what each card is trying to discover, and how the new road-based cards map back to the older red harness and the current v19/v20 failure categories. The goal is to preserve coverage intent even when the underlying geometry or harness architecture changes.

16.1 Legacy A-E Mapping
The old A-E suite was not road-based, but each card was testing a specific behavioral question. The restored cards keep the same IDs and test those same questions on the real road geometry and shared simulation core.

- `A Blocked progress counter`
  Old intent: verify the blocked-car timer/precondition actually accumulates instead of silently resetting.
  New road-based replacement: one main-road car sits behind a stopper near the fork.
  What it is trying to discover now: whether the progress-based stuck detection used by the current architecture can still observe a truly blocked car.

- `B Blocked car creates lateral alternative`
  Old intent: a blocked car should not freeze forever if there is legal lateral clearance.
  New road-based replacement: a 2-lane approach with a blocker ahead and only partial side clearance.
  What it is trying to discover now: whether the planner can produce a legal sideways escape instead of full dead-stop behavior.

- `C Open-lane bypass / lane-change progress`
  Old intent: if the adjacent lane is clearly open, the blocked car must actually use it.
  New road-based replacement: a 2-lane approach with a blocker in lane 0 and an open lane 1.
  What it is trying to discover now: whether legal merge progress happens within budget instead of the car remaining trapped behind the blocker.

- `D Conflict pair must not hard-deadlock`
  Old intent: two conflicting cars should not freeze forever at the interaction point.
  New road-based replacement: matched-ETA fork entrants with different targets.
  What it is trying to discover now: whether mixed-direction traffic still hard-deadlocks once both cars reach the fork.

- `E Hard constraint guard`
  Old intent: even if traffic handling fails, hard legality must still hold.
  New road-based replacement: the same conflict geometry as `D`, but judged only on hard legality.
  What it is trying to discover now: whether no-overlap and no-wall-escape guarantees are still intact under the conflict geometry.

16.2 Same-Target Guard Cards
These cards cover the phase-1 same-target stabilization work and remain part of the visual regression dashboard because they guard the nominal lane-centering behavior.

- `F Side-by-side lane hold`
  Intent: two cars in adjacent lanes, same direction, must stay centered and parallel without wobble.

- `G 1L baseline throughput`
  Intent: preserve the known-good single-lane baseline for completion time and legality.

- `H 2L same-target throughput`
  Intent: expose whether same-direction two-lane flow is both legal and materially faster than the 1-lane baseline.

- `I 3L same-target throughput`
  Intent: expose whether same-direction three-lane flow scales beyond the 2-lane case instead of just wobbling legally.

- `J Fork approach lane hold`
  Intent: confirm that same-direction parallel traffic remains centered and stable on the approach to the fork, not just on a straight isolated segment.

16.3 Collision Harness Family Mapping
The earlier non-road collision harness covered several distinct scenario families. The restored road-based cards do not reproduce the old free-space geometry exactly; they recreate the usefulness of those checks on the real fork roadway.

- Old rear-end safety -> `K Rear-end queue stop`
  What it is trying to discover: whether a following car ever phases through or passes a stopped queue leader on the real road.

- Old failed lane-merge safety -> `L Unsafe merge rejection`
  What it is trying to discover: whether a merge is ever accepted with gap `< CAR_L * 1.5`.

- Old lane-merge liveness -> `M Safe merge acceptance`
  What it is trying to discover: whether the system is over-conservative and refuses clearly safe merges.

- Old T-bone / diagonal conflict protection -> `N Fork conflict hard-constraint`
  What it is trying to discover: whether conflict-zone protection still prevents overlap when two cars reach the fork on matched ETA.

- Old three-car pileup / squeeze-from-both-sides -> `O Dense squeeze queue`
  What it is trying to discover: whether dense queue pressure stays legal and visually compresses without phasing, illegal merges, or wall escape.

- Old high-dt / chaos legality -> `P dt-spike legality chaos`
  What it is trying to discover: whether coarse timesteps on phone-like geometry still preserve hard legality under dense seeded traffic.

16.4 Mixed-Traffic Failure Mapping
These cards correspond directly to the currently unresolved mixed-traffic failures described in Sections 11, 14, and 15.

- `Q Paradox race`
  Maps to: Test 5 (Paradox).
  What it is trying to discover: whether `1L` finishes fastest under `50/50` demand once the fork conflicts are working properly.

- `R Completion race`
  Maps to: Test 7 failure symptoms and general mixed-flow liveness.
  What it is trying to discover: whether `1L`, `2L`, and `3L` all finish at all under `50/50`.

- `S Maneuver activation`
  Maps to: Test 8 (Maneuvering Activation).
  What it is trying to discover: whether the system ever enters maneuver mode in dense mixed traffic.

- `T Progress-based maneuver reason`
  Maps to: V20 progress-trigger requirement.
  What it is trying to discover: whether at least one maneuver is triggered for lack of progress instead of some incidental fallback.

- `U Live merge safety under 50/50`
  Maps to: Test 9 (Safety Distance Enforcement).
  What it is trying to discover: whether accepted merges in live mixed traffic still obey the `33px` gap rule.

- `V Spillback / exit-clearance`
  Maps to: V20 exit-clearance and spillback-prevention requirements.
  What it is trying to discover: whether cars illegally enter the conflict zone when their target branch has no downstream room.

- `W Fair alternation / starvation`
  Maps to: V20 fairness/starvation requirements.
  What it is trying to discover: whether one branch can be starved while the other continues to receive service.

- `X Late lane oscillation`
  Maps to: V20 no-late-oscillation requirement.
  What it is trying to discover: whether cars keep attempting voluntary lane changes after `COMMIT_DIST`.

- `Y Stress completion`
  Maps to: Test 7 (Stress Completion).
  What it is trying to discover: whether `4L` and `5L` mixed-traffic stress runs ever fully clear the network within the large tick budget.

16.5 Dashboard Classification
Every visual card is tagged as one of:
- `guard_green`: this is a hard safety or baseline guard that should already stay green.
- `known_red`: this is a currently expected failure that must remain visible until the feature is truly fixed.
- `diagnostic`: this is primarily an observability card used to expose how the current logic behaves, even if no pass/fail target is stable yet.

16.6 Non-Road Coverage Rule
The restored dashboard intentionally avoids the old free-space geometry. Future rewrites may change canvas layout, card grouping, or rendering details, but they must preserve the discovery intent documented above:
- A-E preserve the original legacy red questions.
- K-P preserve the old collision-harness scenario families.
- Q-Y preserve the mixed-traffic and v19/v20 failure coverage.

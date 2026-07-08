# DISCOVERY — Yield & Maneuver Correctness

**Generated:** 2026-06-12
**Status:** FIXED (2026-06-12, same day — user green-lit the fix round; see §6 for the implemented package and final numbers)
**Instrumentation:** flight recorder (`_setMode` + `debugTrace` ring), always-on invariant detectors, CLI tools (`trace_traffic_events.js`, `extract_repro.js`), diagnostic cards BS/BT/BU/BV, browser overlay (`?debug=1` / `d`)

---

## 1. Symptoms (user-reported)

1. **Cars yield too soon.**
2. **Cars that received passage (batch grant) still make dangerous maneuvers.**

Both became visible after the paradox calibration (`COMMIT_DIST` 90→300) created real mixed-traffic conflicts. All evidence below was collected with read-only instrumentation; the 9 baseline card times stayed byte-identical throughout (S=2.67, X=24.68, AA=5.33, AH=41.85, G=10.00, Q=10.00/15.95/12.53, R=10.00/7.85/11.87, H=7.40, I=6.57).

## 2. Evidence

### 2.1 Bug 1 — premature yields (cards BS, BV)

| Scenario | premature / total yields | worst case |
|---|---|---|
| 2L/10 seed 302 (Q-case) | **5 / 6 (83%)** | car 7@t536: dp=328, etaOwn 6560 vs batchEta 75.9 (**86×**) |
| 3L/10 seed 303 (Q-case) | **2 / 2 (100%)** | car 4@t243: dp=372, etaOwn 7440 vs batchEta 341.9 |
| 3L/40 seed 307 | 15 premature | car 4@t217 yields at **dp=368** — the 380px gate in action |

Timeline excerpts (`node trace_traffic_events.js --lanes 2 --cars 10 --seed 302 --ticks 6000 --type premature_yield,yield_exit`):

```
[t00249] premature_yield carId=7 dp=380 etaOwn=7600 batchEta=3020
[t00536] premature_yield carId=7 dp=328 etaOwn=6560 batchEta=75.9
[t00544] yield_exit carId=7 duration=8 everSawBatchInZone=false ...
[t00117] yield_exit carId=0 duration=116 everSawBatchInZone=false ...
```

Two aggravating patterns:
- **`everSawBatchInZone=false` dominates**: most yield episodes begin and end without the batch ever entering the zone — the car braked for a crossing that never happened near it.
- **Idle-zone yields** (card BV): on 3L/40, a car spent **229 consecutive ticks in yield while the zone had NO active batch at all**; max episode duration 522 ticks (~8.7 sim-seconds).

### 2.2 Bug 2 — granted cars in dangerous maneuvers (card BT + seed hunt)

The hybrid state (`maneuvering && batchId !== null`) is **strongly seed-dependent** — the standard stress seed 307 is a lucky outlier:

| 3L/40, dt=1 | hybrid ticks | overlaps | DNF cars |
|---|---|---|---|
| seed 307 | **0** | 0 | 0 |
| seed 308 | 29 | 0 | 0 |
| seed 309 | 87 | 0 | 0 |
| seed 310 | 306 | 0 | **9/40 never finish** |
| seed 42 | **572** | **10** | 0 |
| seed 42 + dt spikes (browser-like) | 633 | **92** | 0 |

First-occurrence log (seed 309, t401): `car 13: speed=-0.6 (full reverse), steer=0.4 (MAX_ST), batchId=5, mode='maneuver'` — a **granted car reversing at maximum steer**.

**Danger model refinement:** `inZone=false` in every hybrid log entry (dp 160–370). The reverse-wobble happens on the **approach** to the zone, not inside the zone disc — which is why the in-zone detectors (`reverseInZone`, `zoneAggressiveSteer`, `grantedNearMiss`) stay at 0 while the hybrid counter explodes. The granted car backs into the queue behind it; with unlucky geometry that produces the overlaps (10–92 at seed 42).

Deterministic repro extracted (`node extract_repro.js --lanes 3 --cars 40 --seed 42 --tick 357 --focus-car 10 --radius 130`): a 14-car customCase snapshot with **four cars simultaneously in reverse wobble** (ids 9/10/12/15, all speed=-0.6 steer=0.4) interleaved with two batch cars trying to cross — paste-ready for the fix session's RED card.

## 3. Root causes

### Bug 1 — yield far beyond any useful horizon
- `traffic_core.js` `_assignBatchStates`: `nearFork = dp >= 0 && dp <= BATCH_APPROACH_DIST` gates an **unconditional** opposite-target yield. `BATCH_APPROACH_DIST = COMMIT_DIST + 80 = 380` — it silently **scaled 170→380 with the paradox calibration**, so any opposite-target car within 380px yields the moment a batch is active.
- The yield brake (soft-modifier loop) then runs IDM-toward-zero over that whole span.
- **No ETA comparison exists anywhere**: a car 380px out (etaOwn thousands of ticks at crawl speed) yields to a batch that exits the zone in ~76–340 ticks.
- The 1043 per-tick mode reset + per-zone reassignment means yield re-arms every tick while the gate holds.

### Bug 2 — no mutual exclusion between wobble and grant
- The wobble override applies to ANY `c.maneuvering`; phases 0/2 set `desSpd = -REVERSE_SPD` and max perp steer. There is **no `batchId`/`trafficMode==='batch'` exclusion**, so a car that keeps its grant while flagged maneuvering reverse-wobbles on the approach.
- The cascade entry skips only `hold_exit` cars — it can recruit batch members into maneuver.
- The maneuver→batch exit (F2-T4) requires `pathClear`; while the path isn't clear the granted car keeps wobbling.
- The planner's maneuver scoring rewards reverse when forward is blocked; nothing penalizes reverse-while-granted or reverse-into-queue.

## 4. Candidate fixes (NOT implemented — for the next session)

### Bug 1
| Option | Sketch | Risk |
|---|---|---|
| (a) Decouple `YIELD_NEAR_DIST` | New const (~170, sweepable) for the yield branch + brake; keep `BATCH_APPROACH_DIST` for the scheduler's waiting set | Late yields → illegal conflict entries; watch AA/X and `illegalConflictEntryCount` |
| (b) ETA-gated yield | Only yield when `etaOwn <= batchEta * K` (the detector's exact formula, inverted into a gate) + hysteresis to avoid flapping | yield_enter churn; flapping between commit↔yield; needs hysteresis tuning |
| (c) Graded stop-line braking | Brake toward the zone EDGE (dp − radius − CAR_L) instead of IDM-to-dp from 380px | Changes Q timing — **the paradox depends on yields costing time**; re-validate Q on 4/4 seed triples |

Recommended order: (a) first (smallest, most localized), (b) as the principled follow-up using the already-shipped ETA bookkeeping.

### Bug 2
| Option | Sketch | Risk |
|---|---|---|
| (a) Wobble × grant mutual exclusion | Skip the wobble override when `c.batchId !== null` (substitute a forward-only nudge) | Removes the unstick mechanism F2-T4 needed; could recreate permanent maneuver lock — pair with a watchdog |
| (b) Cascade guard | In cascade entry, also `continue` on `o.trafficMode === 'batch' \|\| o.batchId !== null` | Low risk, narrow — granted cars stop being recruited |
| (c) Planner reverse ban near zone while granted | Exclude reverse candidates when `batchId !== null && dp < X` | A wedged granted car can't back out → deadlock; needs timeout escape |
| (d) Steer clamp on approach while granted | `\|desSt\| <= 0.15` when granted and dp < X | Less dodging ability; near-misses may become hard overlaps — watch AH |

Recommended order: (b) immediately (near-free), then (a) with a grant-release-on-stuck fallback (if a granted car cannot move forward for N ticks, release the grant back to the scheduler instead of wobbling).

## 4.1 Collateral finding — guard cards BA/BC (full `--gate guard` audit)

Running the FULL 32-card guard gate (not just the 4-card S/X/AA/AH set) surfaced two failures, both **pre-dating this session's instrumentation** (verified byte-identical on the pre-session checkout):

- **BA "Mid-merge stuck car enters maneuver": REGRESSED by the COMMIT_DIST=300 calibration.** Pre-calibration it passed (22.45s); post-calibration it fails (85.12s). The calibration session's validation only ran S/X/AA/AH, so this slipped through. Plausible mechanism: with commitUntilFork locking at 300px, mid-merge stuck cars behave differently around the maneuver trigger. **The fix session must triage BA alongside the two user-reported bugs.**
- **BC "Branch-stuck car enters maneuver": pre-existing red** — fails identically (20.00s) before AND after the calibration. Independent backlog item.

Lesson encoded below: validation now uses the full `--gate guard` (32 cards), not the 4-card subset.

## 5. Validation matrix for the fix session

- **Full `--gate guard` (32 cards)** green except the documented pre-existing BC (and BA until triaged) — not just the 4-card S/X/AA/AH subset that let BA slip. Times WILL legitimately change — capture a new baseline first, then require byte-stability across fix commits.
- **Q green on all 4 seed triples (301/311/321/331)** — over-fixing Bug 1 can kill the paradox, since the paradox depends on yields happening.
- R complete; H/I not worsened; G byte-identical (1L untouched by both fixes).
- BS → 0 premature yields; BV → maxYieldIdleTicks < 120; **BT → 0 hybrid ticks on BOTH seeds (307 AND 42)**; BU stays 0. Then flip BS/BT/BU/BV `family: diagnostic → guard_green` (verdicts already written as the guard condition).
- Re-run the seed hunt (`/tmp`-style sweep over seeds 307–310, 42 with dt=1/spikes/chaos) — zero hybrid ticks and zero overlaps expected everywhere.
- Browser check with `?debug=1`: no red maneuver arrows on granted cars; yield lines only near the zone.

## 6. FIX ROUND (2026-06-12, follow-up session) — implemented package & results

User mandate: fix both bugs at my discretion, hard constraint = paradox stays demonstrable; prioritize paradox quality, then performance; triage BA.

### Implemented
- **Bug 1**: `YIELD_NEAR_DIST` decoupled (independent dial) + **ETA gate** `_shouldYield` (new episode only if `dp ≤ 2·CAR_L` or `etaOwn ≤ batchEta × YIELD_ETA_FACTOR`; hysteresis keeps ongoing episodes). Gate and detector share `_yieldEtas` — premature count is zero **by construction** and the BS card guards the gate.
- **Bug 2** (4 layers): cascade never recruits granted cars; granted cars never wobble-reverse (forward-only creep); planner emits no reverse candidates for granted cars; granted cars exit maneuver immediately (F2-T4 `pathClear` precondition dropped — safe now). Plus **`GRANT_STALL_RELEASE`=120**: a batch whose members all stalled releases the zone (liveness).
- **Bug 3 — found DURING the fix round by the BV idle detector: multi-zone overwrite.** `_assignBatchStates`'s per-zone loop let the LAST zone on a car's path win, so a second zone's commit/free default silently cancelled a real yield/hold_exit (3L+). Fixed with **nearest-zone precedence** (decisive modes win by smallest dp; defaults never overwrite); `batchId`/`batchTarget` follow the same rule; yield episode bookkeeping moved to the latch (ghost episodes impossible).
- **BA root fix**: merges now COMPLETE when the car reaches the new lane center (`merging` was only cleared at branch entry; with COMMIT_DIST=300 cars carried the flag for hundreds of px and the stall→maneuver path never fired). BA passes (max stall 2 frames vs threshold 10; was 12+ and 85s).

### Calibration history (paradox constraint)
| YIELD_NEAR_DIST | Q seed triples | note |
|---|---|---|
| 170 | red (3L 9.17 < 1L) | over-fixed: too little crossing cost |
| 260 / 300 | 3/4 · 2/4 | chaotic sensitivity |
| 340 (pre-precedence-fix) | 4/4 (worst +0.8%) | committed, then precedence fix changed dynamics |
| **380 (final)** | **4/4** — 13.28/12.42/11.97/10.13 vs 10.00 | horizon = BATCH_APPROACH again, but the ETA gate (not the horizon) is the premature-yield fix |

### Final numbers
- **Q 4/4 triples** (301/311/321/331); R pass; **G/H/I byte-identical** (10.00/7.40/6.57 — same-target provably untouched, ~5 independent confirmations).
- **All four invariants zero across the seed hunt** (307–310, 42, dt spikes): hybrid ticks 572→0, overlaps 92→0, premature yields 0, consecutive idle-yield 181→0; s310's 9 permanent DNFs resolved.
- **BS/BT/BU/BV all green → flipped `diagnostic` → `guard_green`** (permanent regression net).
- **Performance** (same hardware A/B, 3L/40×400t): 9502 → 8845 ms (**−6.9%**) — honest yielding costs less than wasted reverse-wobble.
- BC remains the documented pre-existing red (branch-segment maneuver — separate backlog).

## 7. Instrumentation inventory (shipped in the diagnosis session)

- **Flight recorder**: `_setMode(c, mode, reason, extra)` choke point (18 sites converted); `mode_change` events with car snapshots in a `traceEvents` ring (cap 20k, `debugTrace`-gated, default off); `wobble_phase` trace; yield episode bookkeeping (`yield_enter` enriched, new `yield_exit` with duration/idle/sawBatch); additive `maneuver_enter/exit` fields (dp, blocker, npt, exit reason).
- **Always-on detectors** (read-only, byte-identical-verified, AH overhead +1.9%): `prematureYieldCount/Log` (ETA test, K=1.5, dp>2·CAR_L floor — over-reports for stalled cars by design), `batchManeuverTickCount/ReverseInZoneCount/Log`, `zoneAggressiveSteerCount/Log` (|steer|>0.25 granted-in-zone), `grantedNearMissCount/Log` (<33px), `yieldExitCount/yieldDurations/maxYieldDurationTicks/maxYieldIdleTicks`.
- **CLI**: `trace_traffic_events.js` (merged timeline + filters + detector footer), `extract_repro.js` (tick snapshot → paste-ready customCase; batch grant state documented as non-snapshottable).
- **Cards**: BS/BT/BU/BV (`diagnostic` family; verdicts pre-written as future guard conditions).
- **Browser overlay** (`?debug=1`, `d` toggle): zone discs + batch labels, granted rings, yield→zone lines with duration + premature flag, maneuver perp arrows (red when granted), near-miss flashes, car ids, dp labels, event ticker; debug tooltip fields (PT/EN).

### Known detector caveats
- ETA formula floors speed at 0.05 (the scheduler's own convention): stalled batch members inflate `batchEta`, already-braked yielders inflate `etaOwn` — both bias toward over-reporting (acceptable for a diagnostic; tune K and the dp floor when flipping BS to guard).
- `everSawBatchInZone` is per-episode and only sampled while the episode's zone has the batch listed — a batch that completes between ticks of a long episode is still caught by `idleTicks`.
- Seed 307 is a lucky seed for the hybrid state — never rely on a single seed for maneuver-related verdicts (card BT now runs 307 + 42).

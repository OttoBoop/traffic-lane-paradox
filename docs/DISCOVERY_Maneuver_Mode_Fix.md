# Discovery: Maneuver Mode Fix

**Status:** Complete
**Date:** 2026-03-11

## 0. Pre-Discovery Research & Context

* **Existing Files Analyzed:** `traffic_core.js` (`Sim._tickStep`, `_chooseTrafficMove`), `v18_plan.md`, `traffic_test_suite.js` (red tests S, T, V).
* **Root Cause Analysis:** The Maneuver Mode (wobble to break gridlocks) fails to trigger because of a logic error in `Sim._tickStep`. The `noProgressTicks` counter, which triggers the maneuver, only increments if `forwardIntent > progressIntentThreshold`. However, `forwardIntent` is calculated as `Math.max(c.speed, c.desSpd)`. When a car is completely blocked by traffic (e.g., in a gridlock), the IDM formula naturally correctly forces `desSpd` to 0. Consequently, `forwardIntent` becomes 0, the check fails, and the stuck timer never increments.
    Additionally, the legacy "revert-to-saved-position" collision handling instantly zeroed speed upon overlap, further masking this issue.

## 1. Core Requirements

* **Context/Problem:** The progress-based trigger for Maneuver Mode is broken due to IDM interference with the `forwardIntent` variable.
* **Target Users:** Educational showcase (needs fluid jam resolution).
* **Success Definition:** Cars must correctly enter maneuver mode when path progress stops due to blockage, correctly passing existing red tests (S - Maneuver Activation, T - Progress-based Reason, V - Conflict Resolution).

## 2. Functional Requirements

* **Trigger Fix:** If a car is actively `blockedForProgress` (e.g., IDM detects a blocker `hardFollowBlock`, or `trafficMode` is `yield`/`hold_exit`), the `forwardIntent` threshold check *must be bypassed or redefined*. If the car wants to move but IDM holds it back for safety, it should still accumulate `noProgressTicks`.
* **Candidate Set Pass-through:** Ensure that when `c.trafficMode === 'maneuver'`, the `_candidateSet` produces reverse/wobble speeds, and these candidates are not disproportionately punished by `_scoreCandidate` so they can be selected.

## 3. Non-Functional Requirements

* **Performance:** Negligible impact. Only changes conditional checks.

## 4. Constraints & Boundaries

* **Tech Constraints:** Must strictly adhere to the v20 planner pipeline (`_chooseBestLegalCandidate`). The maneuver must be an evaluated candidate, not a forced override that ignores wall/overlap SAT checks.

## 5. Edge Cases & Error Handling

* **False Triggers:** A car waiting at a clear yield sign forever? No, `blockedForProgress` should only trigger if actively obstructed by another car, not just an empty intersection.

## 6. Testing & Acceptance

* **Tests to Pass:**
  * `node run_traffic_suite.js --id S` (Activation)
  * `node run_traffic_suite.js --id T` (Trigger reason)
  * `node run_traffic_suite.js --id V` (Resolution)

## 7. Parallelism Analysis

* **Task List:**
    1. Fix the `forwardIntent` / `noProgressTicks` accumulation logic in `traffic_core.js`.
    2. Verify maneuver speeds in `_candidateSet` and scoring in `_scoreCandidate`.
    3. Run and verify tests S, T, V change from red to green.

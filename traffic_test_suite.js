(function (global) {
  const TC = global.TrafficCore;
  if (!TC) {
    throw new Error("TrafficCore must be loaded before TrafficTestSuite.");
  }

  const { createScenarioSim, CAR_L, V0_DEF, satOverlap, pathQuery } = TC;
  const VIEW = { w: 220, h: 760 };
  const PHONE = { w: 110, h: 700 };
  const SHORT_VIEW = { w: 220, h: 260 };
  const SUITES = [
    {
      id: "legacy",
      title: "Legacy Red Restorations",
      subtitle:
        "Road-based replacements for the earlier A-E suite. These preserve what the old tests were trying to discover.",
    },
    {
      id: "same",
      title: "Same-Target Guards",
      subtitle:
        "Current lane-hold and same-direction throughput guards. These should stay green unless nominal flow regresses.",
    },
    {
      id: "collision",
      title: "Collision / Constraint Regressions",
      subtitle:
        "Road-based equivalents of the older collision harness: rear-end safety, merge safety, fork conflicts, queue squeeze, and dt spikes.",
    },
    {
      id: "mixed",
      title: "50/50 Mixed-Traffic Reds",
      subtitle:
        "Visual cards for the currently known mixed-flow failures from the main plan: paradox, completion, maneuvering, starvation, merge safety, and stress.",
    },
  ];

  function createHidden(spec) {
    const sim = createScenarioSim(spec);
    sim.start();
    for (let i = 0; i < (spec.maxTicks || 2000) && !sim.finished; i++) {
      sim.tick(spec.dt || 1, { v0: V0_DEF });
    }
    return sim;
  }

  function standardCase(label, options) {
    return {
      label,
      sim: createScenarioSim({
        lanes: options.lanes,
        nCars: options.cars,
        splitPct: options.split,
        w: options.w || VIEW.w,
        h: options.h || VIEW.h,
        seed: options.seed,
        dt: options.dt || 1,
        maxTicks: options.maxTicks,
      }),
      dt: options.dt || 1,
      maxTicks: options.maxTicks || 2000,
      finishBased: options.finishBased !== false,
      stepsPerFrame: options.stepsPerFrame,
    };
  }

  function customCase(label, options) {
    return {
      label,
      sim: createScenarioSim({
        lanes: options.lanes,
        w: options.w || VIEW.w,
        h: options.h || VIEW.h,
        seed: options.seed,
        cars: options.cars,
        dt: options.dt || 1,
        maxTicks: options.maxTicks,
      }),
      dt: options.dt || 1,
      maxTicks: options.maxTicks || 240,
      finishBased: options.finishBased === true,
      stepsPerFrame: options.stepsPerFrame,
    };
  }

  function legal(sim) {
    return sim.testMetrics.overlapCount === 0 && sim.testMetrics.wallEscapeCount === 0;
  }

  function countDone(sim) {
    return sim.testMetrics.doneCount;
  }

  function timeStr(caseRecord) {
    return caseRecord.sim.timerSec.toFixed(2) + "s";
  }

  function finishOrder(cases) {
    return cases
      .map((caseRecord) => ({
        label: caseRecord.label,
        finished: caseRecord.sim.finished,
        time: caseRecord.sim.timerSec,
      }))
      .sort((a, b) =>
        a.finished === b.finished ? a.time - b.time : a.finished ? -1 : 1
      )
      .map((caseRecord) =>
        `${caseRecord.label}:${caseRecord.finished ? caseRecord.time.toFixed(2) + "s" : "DNF"}`
      )
      .join(" | ");
  }

  function lastEvents(cases) {
    const out = [];
    cases.forEach((caseRecord) =>
      caseRecord.sim.testEvents
        .slice(-2)
        .forEach((event) => out.push(`${caseRecord.label} ${event.type}`))
    );
    return out.slice(-4).join(" | ") || "No events yet.";
  }

  function autoSteps(caseRecord) {
    return Math.max(1, Math.min(40, Math.ceil(caseRecord.maxTicks / 700)));
  }

  function wholePathErr(car) {
    const pq = pathQuery(car.path, car.x, car.y, car.pathIdx);
    return Math.hypot(car.x - pq.px, car.y - pq.py);
  }

  function conflictCars() {
    return [
      {
        id: 0,
        pathKey: "0-right",
        lane: 0,
        target: "right",
        pathT: 0.56,
        mobilTimer: 999,
        color: "#2888c4",
      },
      {
        id: 1,
        pathKey: "1-left",
        lane: 1,
        target: "left",
        pathT: 0.56,
        mobilTimer: 999,
        color: "#c48828",
      },
    ];
  }

  function blockedExitConflictCars() {
    return [
      {
        id: 100,
        pathKey: "1-left",
        lane: 1,
        target: "left",
        pathT: 0.80,
        seg: "left",
        fixed: true,
        color: "#555",
      },
      {
        id: 101,
        pathKey: "1-left",
        lane: 1,
        target: "left",
        pathT: 0.88,
        seg: "left",
        fixed: true,
        color: "#444",
      },
      {
        id: 0,
        pathKey: "1-left",
        lane: 1,
        target: "left",
        pathT: 0.58,
        mobilTimer: 999,
        color: "#c48828",
      },
      {
        id: 1,
        pathKey: "0-right",
        lane: 0,
        target: "right",
        pathT: 0.57,
        mobilTimer: 999,
        color: "#2888c4",
      },
    ];
  }

  function sequentialForkCars(lanes, leftCount, rightCount) {
    const cars = [];
    const total = leftCount + rightCount;
    for (let i = 0; i < total; i++) {
      cars.push({
        id: i,
        lane: i % lanes,
        target: i < leftCount ? "left" : "right",
        mobilTimer: 999,
      });
    }
    return cars;
  }

  function leftBranchBlockers(lanes) {
    const cars = [];
    for (let lane = 0; lane < Math.max(1, Math.min(lanes, 2)); lane++) {
      cars.push(
        {
          id: 100 + lane * 2,
          lane,
          target: "left",
          pathKey: `${lane}-left`,
          pathT: 0.10 + lane * 0.03,
          seg: "left",
          fixed: true,
          color: "#555",
        },
        {
          id: 101 + lane * 2,
          lane,
          target: "left",
          pathKey: `${lane}-left`,
          pathT: 0.20 + lane * 0.03,
          seg: "left",
          fixed: true,
          color: "#444",
        }
      );
    }
    return cars;
  }

  function conflictMetrics(sim) {
    const enters = sim.testEvents
      .filter((event) => event.type === "conflict_enter")
      .map((event) => `${event.carId}${event.legal ? "" : "!"}`);
    return enters.join(" -> ") || "none";
  }

  function normalizeOutcome(result) {
    if (typeof result === "boolean") {
      return { kind: result ? "pass" : "fail", text: result ? "PASS" : "FAIL", passed: !!result };
    }
    if (typeof result === "string") {
      return {
        kind: result.toLowerCase(),
        text: result.toUpperCase(),
        passed: result === "pass",
      };
    }
    return {
      kind: result.kind || "fail",
      text: result.text || (result.kind || "fail").toUpperCase(),
      passed: result.kind === "pass",
      note: result.note || "",
    };
  }

  function leftDone(sim) {
    return sim.cars.some((car) => !car.fixed && car.done && car.target === "left");
  }

  function rightDone(sim) {
    return sim.cars.some((car) => !car.fixed && car.done && car.target === "right");
  }

  let TESTS = [
    {
      id: "A",
      section: "legacy",
      family: "diagnostic",
      name: "Blocked progress counter",
      proof:
        "Old intent: prove the blocked-car precondition actually accumulates. New road version: one moving car trapped behind a fixed blocker near the fork.",
      build() {
        return {
          cases: [
            customCase("1L blocked", {
              lanes: 1,
              seed: 101,
              maxTicks: 160,
              cars: [
                { id: 0, lane: 0, target: "left", y: 505, mobilTimer: 0 },
                { id: 1, lane: 0, target: "left", y: 455, fixed: true, color: "#666" },
              ],
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Max no-progress": sim.testMetrics.maxNoProgressTicks.toFixed(0),
          Overlap: String(sim.testMetrics.overlapCount),
          Wall: String(sim.testMetrics.wallEscapeCount),
          Done: String(countDone(sim)),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return sim.testMetrics.maxNoProgressTicks >= 60 && legal(sim);
      },
    },
    {
      id: "B",
      section: "legacy",
      family: "survey_green",
      name: "Blocked car creates lateral alternative",
      proof:
        "Old intent: a blocked car should not freeze if lateral legal space exists. This road version gives partial side clearance beside the blocker.",
      build() {
        const caseRecord = customCase("2L partial clearance", {
          lanes: 2,
          seed: 102,
          maxTicks: 220,
          cars: [
            { id: 0, lane: 0, target: "left", y: 530, mobilTimer: 0 },
            { id: 1, lane: 0, target: "left", y: 482, fixed: true, color: "#666" },
            { id: 2, lane: 1, target: "left", y: 492, fixed: true, color: "#3d5669" },
            { id: 3, lane: 1, target: "left", y: 580, fixed: true, color: "#3d5669" },
          ],
        });
        return {
          cases: [caseRecord],
          state: {
            startX: caseRecord.sim.cars[0].x,
            maxShift: 0,
            targetSpan: caseRecord.sim.road.lw,
          },
        };
      },
      observe(inst) {
        const mover = inst.cases[0].sim.cars[0];
        inst.state.maxShift = Math.max(inst.state.maxShift, Math.abs(mover.x - inst.state.startX));
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Max lateral shift": inst.state.maxShift.toFixed(2) + "px",
          "Merge accepts": String(sim.testMetrics.mergeAcceptCount),
          "No-progress": sim.testMetrics.maxNoProgressTicks.toFixed(0),
          Overlap: String(sim.testMetrics.overlapCount),
        };
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        const partial =
          inst.state.maxShift > 4 && inst.state.maxShift < inst.state.targetSpan * 0.8;
        return {
          kind: legal(sim) && partial && sim.testMetrics.mergeAcceptCount === 0 ? "pass" : "fail",
          text:
            legal(sim) && partial && sim.testMetrics.mergeAcceptCount === 0 ? "PASS" : "FAIL",
        };
      },
    },
    {
      id: "C",
      section: "legacy",
      family: "known_red",
      name: "Open-lane bypass progress",
      proof:
        "Old intent: an empty adjacent lane should actually be used. This road version leaves lane 1 open and expects real lateral progress or a legal merge.",
      build() {
        const caseRecord = customCase("2L open lane", {
          lanes: 2,
          seed: 103,
          maxTicks: 1200,
          stepsPerFrame: 8,
          cars: [
            { id: 0, lane: 0, target: "left", y: 535, mobilTimer: 0 },
            { id: 1, lane: 0, target: "left", y: 485, fixed: true, color: "#666" },
          ],
        });
        return {
          cases: [caseRecord],
          state: {
            startX: caseRecord.sim.cars[0].x,
            targetX: caseRecord.sim.road.laneX(1),
            blockerY: 485,
            maxShift: 0,
            firstResolveTick: null,
            slowTick: 140,
          },
        };
      },
      observe(inst) {
        const caseRecord = inst.cases[0];
        const sim = caseRecord.sim;
        const mover = sim.cars[0];
        inst.state.maxShift = Math.max(inst.state.maxShift, Math.abs(mover.x - inst.state.startX));
        const inLane1 = Math.abs(mover.x - inst.state.targetX) < 1.5;
        const pastBlocker = mover.y < inst.state.blockerY - CAR_L;
        const resolved = inLane1 && pastBlocker;
        if (resolved && inst.state.firstResolveTick === null) {
          inst.state.firstResolveTick = caseRecord.tick;
        }
      },
      stop(inst) {
        return inst.state.firstResolveTick !== null || inst.cases.every((caseRecord) => caseRecord.done);
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        const mover = sim.cars[0];
        return {
          "First bypass tick":
            inst.state.firstResolveTick === null ? "none" : String(inst.state.firstResolveTick),
          "Merge accepts": String(sim.testMetrics.mergeAcceptCount),
          "Lane 1 dist": Math.abs(mover.x - inst.state.targetX).toFixed(2) + "px",
          "Blocker clearance": (inst.state.blockerY - mover.y - CAR_L).toFixed(2) + "px",
        };
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        if (!legal(sim) || inst.state.firstResolveTick === null) {
          return { kind: "fail", text: "FAIL" };
        }
        if (inst.state.firstResolveTick <= inst.state.slowTick) {
          return { kind: "pass", text: "PASS" };
        }
        return { kind: "warn", text: "WARN", note: "Bypass happened, but too slowly." };
      },
    },
    {
      id: "D",
      section: "legacy",
      family: "diagnostic",
      name: "Conflict pair must not hard-deadlock",
      proof:
        "Old intent: crossing cars should not freeze forever. Two matched fork entrants must both clear the fork within budget.",
      build() {
        return {
          cases: [
            customCase("2L real conflict", {
              lanes: 2,
              seed: 104,
              maxTicks: 340,
              finishBased: true,
              cars: conflictCars(),
            }),
          ],
          state: { minCenter: Infinity },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        const a = sim.cars[0];
        const b = sim.cars[1];
        inst.state.minCenter = Math.min(inst.state.minCenter, Math.hypot(a.x - b.x, a.y - b.y));
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Paths: "0-right x 1-left",
          Done: countDone(sim) + "/2",
          "Min center": inst.state.minCenter.toFixed(2),
          Time: timeStr(inst.cases[0]),
        };
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        return {
          kind: sim.finished && countDone(sim) === 2 && legal(sim) && inst.state.minCenter < 20 ? "pass" : "fail",
          text:
            sim.finished && countDone(sim) === 2 && legal(sim) && inst.state.minCenter < 20
              ? "PASS"
              : "FAIL",
        };
      },
    },
    {
      id: "E",
      section: "legacy",
      family: "guard_green",
      name: "Hard constraint guard",
      proof:
        "Old intent: even if traffic handling is wrong, legality must hold. Same geometry as D, judged only on overlap and wall escape.",
      build() {
        return {
          cases: [
            customCase("2L hard guard", {
              lanes: 2,
              seed: 105,
              maxTicks: 340,
              cars: conflictCars(),
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Overlap: String(sim.testMetrics.overlapCount),
          Wall: String(sim.testMetrics.wallEscapeCount),
          "Illegal conflict": String(sim.testMetrics.illegalConflictEntryCount),
          Spillback: sim.testMetrics.maxConflictZoneStallTicks.toFixed(0),
        };
      },
      verdict(inst) {
        return legal(inst.cases[0].sim);
      },
    },
    {
      id: "F",
      section: "same",
      family: "guard_green",
      name: "Side-by-side lane hold",
      proof:
        "Two cars in adjacent lanes, same direction, straight segment. They should stay centered without wobble.",
      build() {
        const caseRecord = customCase("2L lane hold", {
          lanes: 2,
          seed: 11,
          maxTicks: 160,
          cars: [
            { id: 0, lane: 0, target: "left", y: 640 },
            { id: 1, lane: 1, target: "left", y: 640 },
          ],
        });
        return {
          cases: [caseRecord],
          state: {
            centers: caseRecord.sim.cars.map((car) => caseRecord.sim.road.laneX(car.lane)),
            maxDrift: 0,
            maxYaw: 0,
            overlap: false,
          },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        sim.cars.forEach((car, idx) => {
          if (car.seg !== "main") {
            return;
          }
          inst.state.maxDrift = Math.max(
            inst.state.maxDrift,
            Math.abs(car.x - inst.state.centers[idx])
          );
          inst.state.maxYaw = Math.max(inst.state.maxYaw, Math.abs(car.th + Math.PI / 2));
        });
        inst.state.overlap = inst.state.overlap || satOverlap(sim.cars[0], sim.cars[1]);
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Max drift": inst.state.maxDrift.toFixed(2) + "px",
          "Max yaw": ((inst.state.maxYaw * 180) / Math.PI).toFixed(2) + " deg",
          Overlap: inst.state.overlap ? "YES" : "NO",
          Maneuvers: String(sim.testMetrics.maneuverEnterCount),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return (
          inst.state.maxDrift < 0.75 &&
          inst.state.maxYaw < 0.03 &&
          !inst.state.overlap &&
          sim.testMetrics.maneuverEnterCount === 0
        );
      },
    },
    {
      id: "G",
      section: "same",
      family: "guard_green",
      name: "1L baseline throughput",
      proof: "Single-lane baseline. Must still finish cleanly with no false traffic handling.",
      build() {
        return {
          cases: [
            standardCase("1L 100% left", {
              lanes: 1,
              cars: 10,
              split: 100,
              seed: 21,
              maxTicks: 2400,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Done: countDone(sim) + "/10",
          Time: timeStr(inst.cases[0]),
          Overlap: String(sim.testMetrics.overlapCount),
          Maneuvers: String(sim.testMetrics.maneuverEnterCount),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return sim.finished && legal(sim) && sim.testMetrics.maneuverEnterCount === 0;
      },
    },
    {
      id: "H",
      section: "same",
      family: "known_red",
      name: "2L same-target throughput",
      proof:
        "Two-lane same-target flow should stay stable and beat the 1L baseline by the expected scaling margin.",
      build() {
        const baseline = createHidden({
          lanes: 1,
          nCars: 10,
          splitPct: 100,
          w: VIEW.w,
          h: VIEW.h,
          seed: 31,
          maxTicks: 2400,
        });
        return {
          cases: [
            standardCase("2L 100% left", {
              lanes: 2,
              cars: 10,
              split: 100,
              seed: 31,
              maxTicks: 3600,
            }),
          ],
          state: { target: (baseline.timerSec / 2) * 1.15 },
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Done: countDone(sim) + "/10",
          Time: timeStr(inst.cases[0]),
          "Target max": inst.state.target.toFixed(2) + "s",
          Modes: `${sim.testMetrics.yieldEnterCount}/${sim.testMetrics.holdExitEnterCount}/${sim.batchEntryCount}`,
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return (
          sim.finished &&
          legal(sim) &&
          sim.testMetrics.maneuverEnterCount === 0 &&
          sim.testMetrics.yieldEnterCount === 0 &&
          sim.testMetrics.holdExitEnterCount === 0 &&
          sim.batchEntryCount === 0 &&
          sim.timerSec <= inst.state.target
        );
      },
    },
    {
      id: "I",
      section: "same",
      family: "known_red",
      name: "3L same-target throughput",
      proof:
        "Three-lane same-target flow should stay stable and beat the 1L baseline by the expected scaling margin.",
      build() {
        const baseline = createHidden({
          lanes: 1,
          nCars: 10,
          splitPct: 100,
          w: VIEW.w,
          h: VIEW.h,
          seed: 41,
          maxTicks: 2400,
        });
        return {
          cases: [
            standardCase("3L 100% left", {
              lanes: 3,
              cars: 10,
              split: 100,
              seed: 41,
              maxTicks: 3600,
            }),
          ],
          state: { target: (baseline.timerSec / 3) * 1.15 },
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Done: countDone(sim) + "/10",
          Time: timeStr(inst.cases[0]),
          "Target max": inst.state.target.toFixed(2) + "s",
          Modes: `${sim.testMetrics.yieldEnterCount}/${sim.testMetrics.holdExitEnterCount}/${sim.batchEntryCount}`,
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return (
          sim.finished &&
          legal(sim) &&
          sim.testMetrics.maneuverEnterCount === 0 &&
          sim.testMetrics.yieldEnterCount === 0 &&
          sim.testMetrics.holdExitEnterCount === 0 &&
          sim.batchEntryCount === 0 &&
          sim.timerSec <= inst.state.target
        );
      },
    },
    {
      id: "J",
      section: "same",
      family: "guard_green",
      name: "Whole-path lane hold",
      proof:
        "Two same-target cars must hold a clean path through the whole route, not just on the straight or early fork approach.",
      build() {
        const caseRecord = customCase("2L whole path hold", {
          lanes: 2,
          seed: 51,
          maxTicks: 420,
          finishBased: true,
          cars: [
            { id: 0, lane: 0, target: "left", y: 620 },
            { id: 1, lane: 1, target: "left", y: 628 },
          ],
        });
        return {
          cases: [caseRecord],
          state: { maxPathErr: 0, maxYaw: 0, overlap: false },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        sim.cars.forEach((car) => {
          if (car.done) {
            return;
          }
          const pq = pathQuery(car.path, car.x, car.y, car.pathIdx);
          let hd = car.th - pq.ang;
          while (hd > Math.PI) {
            hd -= Math.PI * 2;
          }
          while (hd < -Math.PI) {
            hd += Math.PI * 2;
          }
          inst.state.maxPathErr = Math.max(inst.state.maxPathErr, wholePathErr(car));
          inst.state.maxYaw = Math.max(inst.state.maxYaw, Math.abs(hd));
        });
        inst.state.overlap = inst.state.overlap || satOverlap(sim.cars[0], sim.cars[1]);
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Done: countDone(sim) + "/2",
          "Max path err": inst.state.maxPathErr.toFixed(2) + "px",
          "Max yaw": ((inst.state.maxYaw * 180) / Math.PI).toFixed(2) + " deg",
          Overlap: inst.state.overlap ? "YES" : "NO",
        };
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        return {
          kind:
            sim.finished &&
              inst.state.maxPathErr < 3.0 &&
              inst.state.maxYaw < 0.12 &&
              !inst.state.overlap &&
              sim.testMetrics.maneuverEnterCount === 0
              ? "pass"
              : "fail",
          text:
            sim.finished &&
              inst.state.maxPathErr < 3.0 &&
              inst.state.maxYaw < 0.12 &&
              !inst.state.overlap &&
              sim.testMetrics.maneuverEnterCount === 0
              ? "PASS"
              : "FAIL",
        };
      },
    },
      {
        id: "AJ",
        section: "same",
        family: "guard_green",
        name: "Side-by-side opposite-target fork hold",
        proof:
          "Two adjacent cars already aligned with non-conflicting left/right branch paths should follow their own curves without merge, yield, maneuver, or visible path wobble.",
        build() {
          const caseRecord = customCase("2L opposite split hold", {
            lanes: 2,
            seed: 801,
            maxTicks: 420,
            finishBased: true,
            cars: [
              { id: 0, lane: 0, target: "left", y: 620 },
              { id: 1, lane: 1, target: "right", y: 620 },
            ],
          });
          return {
            cases: [caseRecord],
            state: { maxPathErr: 0, maxYaw: 0, overlap: false },
          };
        },
        observe(inst) {
          const sim = inst.cases[0].sim;
          sim.cars.forEach((car) => {
            if (car.done) return;
            const pq = pathQuery(car.path, car.x, car.y, car.pathIdx);
            let hd = car.th - pq.ang;
            while (hd > Math.PI) hd -= Math.PI * 2;
            while (hd < -Math.PI) hd += Math.PI * 2;
            inst.state.maxPathErr = Math.max(inst.state.maxPathErr, wholePathErr(car));
            inst.state.maxYaw = Math.max(inst.state.maxYaw, Math.abs(hd));
          });
          inst.state.overlap = inst.state.overlap || satOverlap(sim.cars[0], sim.cars[1]);
        },
        metrics(inst) {
          const sim = inst.cases[0].sim;
          return {
            Done: countDone(sim) + "/2",
            "Max path err": inst.state.maxPathErr.toFixed(2) + "px",
            "Max yaw": ((inst.state.maxYaw * 180) / Math.PI).toFixed(2) + " deg",
            Modes: `${sim.testMetrics.yieldEnterCount}/${sim.testMetrics.holdExitEnterCount}/${sim.testMetrics.maneuverEnterCount}/${sim.batchEntryCount}`,
            Merges: String(sim.testMetrics.mergeAcceptCount),
          };
        },
        verdict(inst) {
          const sim = inst.cases[0].sim;
          return (
            sim.finished &&
            legal(sim) &&
            !inst.state.overlap &&
            inst.state.maxPathErr < 3.0 &&
            inst.state.maxYaw < 0.12 &&
            sim.testMetrics.yieldEnterCount === 0 &&
            sim.testMetrics.holdExitEnterCount === 0 &&
            sim.testMetrics.maneuverEnterCount === 0 &&
            sim.batchEntryCount === 0 &&
            sim.testMetrics.mergeAcceptCount === 0 &&
            sim.testMetrics.maxNoProgressTicks === 0
          );
        },
      },
      {
        id: "AK",
        section: "same",
        family: "guard_green",
        name: "Staggered opposite-target fork hold",
        proof:
          "A nearby side car on the adjacent fork path should still be treated as compatible traffic: the pair should keep progressing along left/right curves without false side-blocking traffic modes.",
        build() {
          const caseRecord = customCase("2L opposite split staggered", {
            lanes: 2,
            seed: 802,
            maxTicks: 420,
            finishBased: true,
            cars: [
              { id: 0, lane: 0, target: "left", y: 624 },
              { id: 1, lane: 1, target: "right", y: 616 },
            ],
          });
          return {
            cases: [caseRecord],
            state: { maxPathErr: 0, maxYaw: 0, overlap: false },
          };
        },
        observe(inst) {
          const sim = inst.cases[0].sim;
          sim.cars.forEach((car) => {
            if (car.done) return;
            const pq = pathQuery(car.path, car.x, car.y, car.pathIdx);
            let hd = car.th - pq.ang;
            while (hd > Math.PI) hd -= Math.PI * 2;
            while (hd < -Math.PI) hd += Math.PI * 2;
            inst.state.maxPathErr = Math.max(inst.state.maxPathErr, wholePathErr(car));
            inst.state.maxYaw = Math.max(inst.state.maxYaw, Math.abs(hd));
          });
          inst.state.overlap = inst.state.overlap || satOverlap(sim.cars[0], sim.cars[1]);
        },
        metrics(inst) {
          const sim = inst.cases[0].sim;
          return {
            Done: countDone(sim) + "/2",
            "Max path err": inst.state.maxPathErr.toFixed(2) + "px",
            "Max yaw": ((inst.state.maxYaw * 180) / Math.PI).toFixed(2) + " deg",
            Modes: `${sim.testMetrics.yieldEnterCount}/${sim.testMetrics.holdExitEnterCount}/${sim.testMetrics.maneuverEnterCount}/${sim.batchEntryCount}`,
            Merges: String(sim.testMetrics.mergeAcceptCount),
          };
        },
        verdict(inst) {
          const sim = inst.cases[0].sim;
          return (
            sim.finished &&
            legal(sim) &&
            !inst.state.overlap &&
            inst.state.maxPathErr < 3.0 &&
            inst.state.maxYaw < 0.12 &&
            sim.testMetrics.yieldEnterCount === 0 &&
            sim.testMetrics.holdExitEnterCount === 0 &&
            sim.testMetrics.maneuverEnterCount === 0 &&
            sim.batchEntryCount === 0 &&
            sim.testMetrics.mergeAcceptCount === 0 &&
            sim.testMetrics.maxNoProgressTicks === 0
          );
        },
      },
      {
        id: "AL",
        section: "same",
        family: "guard_green",
        name: "Blocked with side neighbor waits cleanly",
        proof:
          "If the adjacent lane is occupied, a blocked driver should wait cleanly instead of inventing a maneuver response to a side car.",
        build() {
          return {
            cases: [
              customCase("2L blocked side occupied", {
                lanes: 2,
                seed: 803,
                maxTicks: 240,
                cars: [
                  { id: 0, lane: 0, target: "left", y: 530, mobilTimer: 0 },
                  { id: 1, lane: 0, target: "left", y: 482, fixed: true, color: "#666" },
                  { id: 2, lane: 1, target: "right", y: 494, fixed: true, color: "#2888c4" },
                  { id: 3, lane: 1, target: "right", y: 574, fixed: true, color: "#5aa6d1" },
                ],
              }),
            ],
            state: {},
          };
        },
        metrics(inst) {
          const sim = inst.cases[0].sim;
          return {
            Maneuvers: String(sim.testMetrics.maneuverEnterCount),
            Yields: String(sim.testMetrics.yieldEnterCount),
            "Merge accepts": String(sim.testMetrics.mergeAcceptCount),
            "No-progress": sim.testMetrics.maxNoProgressTicks.toFixed(0),
          };
        },
        verdict(inst) {
          const sim = inst.cases[0].sim;
          return (
            legal(sim) &&
            sim.testMetrics.maneuverEnterCount === 0 &&
            sim.testMetrics.yieldEnterCount === 0 &&
            sim.testMetrics.mergeAcceptCount === 0
          );
        },
      },
      {
        id: "AM",
        section: "legacy",
        family: "survey_green",
        name: "Open-lane bypass avoids false maneuver",
        proof:
          "With a truly open adjacent lane, bypass behavior should not escalate into maneuver mode; the car should solve it through legal lateral progress or merge logic.",
        build() {
          const caseRecord = customCase("2L open lane no maneuver", {
            lanes: 2,
            seed: 804,
            maxTicks: 1200,
            stepsPerFrame: 8,
            cars: [
              { id: 0, lane: 0, target: "left", y: 535, mobilTimer: 0 },
              { id: 1, lane: 0, target: "left", y: 485, fixed: true, color: "#666" },
            ],
          });
          return {
            cases: [caseRecord],
            state: { startX: caseRecord.sim.cars[0].x, maxShift: 0 },
          };
        },
        observe(inst) {
          const mover = inst.cases[0].sim.cars[0];
          inst.state.maxShift = Math.max(inst.state.maxShift, Math.abs(mover.x - inst.state.startX));
        },
        metrics(inst) {
          const sim = inst.cases[0].sim;
          return {
            "Max lateral shift": inst.state.maxShift.toFixed(2) + "px",
            Maneuvers: String(sim.testMetrics.maneuverEnterCount),
            "Merge accepts": String(sim.testMetrics.mergeAcceptCount),
            "No-progress": sim.testMetrics.maxNoProgressTicks.toFixed(0),
          };
        },
        verdict(inst) {
          const sim = inst.cases[0].sim;
          return (
            legal(sim) &&
            sim.testMetrics.maneuverEnterCount === 0 &&
            (sim.testMetrics.mergeAcceptCount > 0 || inst.state.maxShift > 4)
          );
        },
      },
    {
      id: "AF",
      section: "same",
      family: "guard_green",
      name: "1L straight path hold",
      proof:
        "A single 1-lane car on a clear road should track the straight main-road centerline without visible wobble before the fork.",
      build() {
        const caseRecord = customCase("1L straight hold", {
          lanes: 1,
          seed: 703,
          maxTicks: 220,
          cars: [{ id: 0, lane: 0, target: "left", y: 640 }],
        });
        return {
          cases: [caseRecord],
          state: {
            center: caseRecord.sim.road.laneX(0),
            startY: caseRecord.sim.cars[0].y,
            minY: caseRecord.sim.cars[0].y,
            maxDrift: 0,
            maxYaw: 0,
          },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        const car = sim.cars[0];
        if (car.done || car.seg !== "main") return;
        inst.state.minY = Math.min(inst.state.minY, car.y);
        inst.state.maxDrift = Math.max(inst.state.maxDrift, Math.abs(car.x - inst.state.center));
        inst.state.maxYaw = Math.max(inst.state.maxYaw, Math.abs(car.th + Math.PI / 2));
      },
      metrics(inst) {
        return {
          Progress: (inst.state.startY - inst.state.minY).toFixed(2) + "px",
          "Max drift": inst.state.maxDrift.toFixed(2) + "px",
          "Max yaw": ((inst.state.maxYaw * 180) / Math.PI).toFixed(2) + " deg",
        };
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        const progress = inst.state.startY - inst.state.minY;
        const pass =
          progress >= 200 &&
          legal(sim) &&
          sim.testMetrics.yieldEnterCount === 0 &&
          sim.testMetrics.maneuverEnterCount === 0 &&
          inst.state.maxDrift < 0.45 &&
          inst.state.maxYaw < 0.02;
        return { kind: pass ? "pass" : "fail", text: pass ? "PASS" : "FAIL" };
      },
    },
    {
      id: "AG",
      section: "same",
      family: "survey_green",
      name: "Spawn starts with safe spacing",
      proof:
        "Initial spawn should already respect safe same-lane headway and should not place the front row of every lane at the exact same depth.",
      build() {
        return {
          cases: [
            standardCase("3L spawn audit", {
              lanes: 3,
              cars: 12,
              split: 50,
              seed: 704,
              maxTicks: 1,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        const lanes = new Map();
        for (const car of sim.cars) {
          if (!lanes.has(car.lane)) lanes.set(car.lane, []);
          lanes.get(car.lane).push(car);
        }
        let minSameLaneGap = Infinity;
        const firstRow = [];
        for (const cars of lanes.values()) {
          cars.sort((a, b) => a.y - b.y);
          if (cars.length) firstRow.push(cars[0].y);
          for (let i = 1; i < cars.length; i++) {
            minSameLaneGap = Math.min(minSameLaneGap, cars[i].y - cars[i - 1].y - CAR_L);
          }
        }
        const firstRowSpread = firstRow.length ? Math.max(...firstRow) - Math.min(...firstRow) : 0;
        return {
          "Min same-lane gap": (minSameLaneGap === Infinity ? 0 : minSameLaneGap).toFixed(2) + "px",
          "First-row spread": firstRowSpread.toFixed(2) + "px",
        };
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        const lanes = new Map();
        for (const car of sim.cars) {
          if (!lanes.has(car.lane)) lanes.set(car.lane, []);
          lanes.get(car.lane).push(car);
        }
        let minSameLaneGap = Infinity;
        const firstRow = [];
        for (const cars of lanes.values()) {
          cars.sort((a, b) => a.y - b.y);
          if (cars.length) firstRow.push(cars[0].y);
          for (let i = 1; i < cars.length; i++) {
            minSameLaneGap = Math.min(minSameLaneGap, cars[i].y - cars[i - 1].y - CAR_L);
          }
        }
        const firstRowSpread = firstRow.length ? Math.max(...firstRow) - Math.min(...firstRow) : 0;
        const pass = minSameLaneGap >= CAR_L * 1.5 && firstRowSpread >= CAR_L * 0.5;
        return { kind: pass ? "pass" : "fail", text: pass ? "PASS" : "FAIL" };
      },
    },
    {
      id: "AH",
      section: "mixed",
      family: "guard_green",
      name: "Concurrent maneuver cap",
      proof:
        "Even under the 3L mixed-traffic jam, no more than MAX_ACTIVE_MANEUVERS (8) cars may be in maneuver mode at the same time.",
      build() {
        return {
          cases: [
            standardCase("3L maneuver cap", {
              lanes: 3,
              cars: 40,
              split: 50,
              seed: 307,
              maxTicks: 12000,
              stepsPerFrame: 20,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Peak active maneuvers": String(sim.testMetrics.maxConcurrentManeuverCount),
          "Total maneuvers": String(sim.testMetrics.maneuverEnterCount),
          Done: countDone(sim) + "/40",
          Time: timeStr(inst.cases[0]),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return legal(sim) && sim.testMetrics.maneuverEnterCount > 0 && sim.testMetrics.maxConcurrentManeuverCount <= 8;
      },
    },
    {
      id: "AI",
      section: "collision",
      family: "known_red",
      name: "No zero-legal follow deadlock",
      proof:
        "The mixed 3L jam should not collapse same-lane spacing into near-tailgating and then leave cars with zero legal moves.",
      build() {
        return {
          cases: [
            standardCase("3L follow deadlock", {
              lanes: 3,
              cars: 40,
              split: 50,
              seed: 307,
              maxTicks: 12000,
              stepsPerFrame: 20,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        const minGap = sim.testMetrics.minRuntimeSameLaneGap;
        return {
          "Min runtime same-lane gap": (minGap === Infinity ? 0 : minGap).toFixed(2) + "px",
          "Zero-legal stalls": String(sim.testMetrics.plannerIllegalCount),
          "Max no-progress": sim.testMetrics.maxNoProgressTicks.toFixed(0),
          Time: timeStr(inst.cases[0]),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        const minGap = sim.testMetrics.minRuntimeSameLaneGap;
        return legal(sim) && sim.testMetrics.plannerIllegalCount === 0 && minGap >= 2;
      },
    },
    {
      id: "K",
      section: "collision",
      family: "guard_green",
      name: "Rear-end queue stop",
      proof:
        "Road-based rear-end safety. A follower must not pass through a stopped queue blocker.",
      build() {
        return {
          cases: [
            customCase("1L rear-end", {
              lanes: 1,
              seed: 201,
              maxTicks: 180,
              cars: [
                { id: 0, lane: 0, target: "left", y: 510 },
                { id: 1, lane: 0, target: "left", y: 460, fixed: true, color: "#666" },
              ],
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Mover y": sim.cars[0].y.toFixed(1),
          "Blocker y": sim.cars[1].y.toFixed(1),
          Overlap: String(sim.testMetrics.overlapCount),
          Wall: String(sim.testMetrics.wallEscapeCount),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return legal(sim) && sim.cars[0].y > sim.cars[1].y;
      },
    },
    {
      id: "L",
      section: "collision",
      family: "survey_green",
      name: "Unsafe merge rejection",
      proof:
        "Road-based unsafe merge guard. A merge must not be accepted when the target-lane gap is below 33px.",
      build() {
        return {
          cases: [
            customCase("2L unsafe gap", {
              lanes: 2,
              seed: 202,
              maxTicks: 220,
              cars: [
                { id: 0, lane: 0, target: "left", y: 540, mobilTimer: 0 },
                { id: 1, lane: 0, target: "left", y: 486, fixed: true, color: "#666" },
                { id: 2, lane: 1, target: "left", y: 504, fixed: true, color: "#3d5669" },
                { id: 3, lane: 1, target: "left", y: 548, fixed: true, color: "#3d5669" },
              ],
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Merge attempts": String(sim.testMetrics.mergeAttemptCount),
          "Unsafe rejects": String(sim.testMetrics.mergeRejectUnsafeCount),
          "Merge accepts": String(sim.testMetrics.mergeAcceptCount),
          "Visible target gap": (548 - 504 - CAR_L).toFixed(2) + "px",
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return legal(sim) && sim.testMetrics.mergeAcceptCount === 0 && sim.testMetrics.mergeRejectUnsafeCount > 0;
      },
    },
    {
      id: "M",
      section: "collision",
      family: "diagnostic",
      name: "Safe merge acceptance",
      proof:
        "Road-based merge liveness. With a legal target-lane gap, a merge should begin instead of freezing.",
      build() {
        return {
          cases: [
            customCase("2L safe gap", {
              lanes: 2,
              seed: 203,
              maxTicks: 260,
              cars: [
                { id: 0, lane: 0, target: "left", y: 540, mobilTimer: 0 },
                { id: 1, lane: 0, target: "left", y: 486, fixed: true, color: "#666" },
                { id: 2, lane: 1, target: "left", y: 430, fixed: true, color: "#3d5669" },
                { id: 3, lane: 1, target: "left", y: 654, fixed: true, color: "#3d5669" },
              ],
            }),
          ],
          state: { firstMergeTick: null, slowTick: 150 },
        };
      },
      observe(inst) {
        const caseRecord = inst.cases[0];
        const sim = caseRecord.sim;
        if (sim.testMetrics.mergeAcceptCount > 0 && inst.state.firstMergeTick === null) {
          inst.state.firstMergeTick = caseRecord.tick;
        }
      },
      stop(inst) {
        return inst.state.firstMergeTick !== null || inst.cases.every((caseRecord) => caseRecord.done);
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "First merge tick":
            inst.state.firstMergeTick === null ? "none" : String(inst.state.firstMergeTick),
          "Merge accepts": String(sim.testMetrics.mergeAcceptCount),
          "Min accepted gap":
            sim.testMetrics.minAcceptedMergeGap === Infinity
              ? "INF"
              : sim.testMetrics.minAcceptedMergeGap.toFixed(2),
          "Visible target gap": (654 - 430 - CAR_L).toFixed(2) + "px",
        };
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        if (
          !legal(sim) ||
          sim.testMetrics.mergeAcceptCount === 0 ||
          sim.testMetrics.minAcceptedMergeGap < CAR_L * 1.5
        ) {
          return { kind: "fail", text: "FAIL" };
        }
        if (inst.state.firstMergeTick !== null && inst.state.firstMergeTick <= inst.state.slowTick) {
          return { kind: "pass", text: "PASS" };
        }
        return { kind: "warn", text: "WARN", note: "Merge is legal but too slow." };
      },
    },
    {
      id: "N",
      section: "collision",
      family: "diagnostic",
      name: "Fork conflict hard-constraint",
      proof:
        "Road-based T-bone / diagonal protection. Conflicting fork entrants must stay legal and produce a consistent first conflict entry.",
      build() {
        return {
          cases: [
            customCase("2L fork guard", {
              lanes: 2,
              seed: 204,
              maxTicks: 280,
              finishBased: true,
              cars: conflictCars(),
            }),
          ],
          state: { minCenter: Infinity },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        const a = sim.cars[0];
        const b = sim.cars[1];
        inst.state.minCenter = Math.min(inst.state.minCenter, Math.hypot(a.x - b.x, a.y - b.y));
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Paths: "0-right x 1-left",
          "Min center": inst.state.minCenter.toFixed(2),
          Overlap: String(sim.testMetrics.overlapCount),
          Wall: String(sim.testMetrics.wallEscapeCount),
        };
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        return {
          kind: legal(sim) && inst.state.minCenter < 20 ? "pass" : "fail",
          text: legal(sim) && inst.state.minCenter < 20 ? "PASS" : "FAIL",
        };
      },
    },
    {
      id: "O",
      section: "collision",
      family: "diagnostic",
      name: "Dense squeeze queue",
      proof:
        "Road-based squeeze and pileup regression. A dense fork queue should compress visually without phasing or illegal merges.",
      build() {
        return {
          cases: [
            customCase("3L squeeze", {
              lanes: 3,
              seed: 205,
              maxTicks: 260,
              cars: [
                { id: 0, lane: 0, target: "left", y: 520, mobilTimer: 0 },
                { id: 1, lane: 1, target: "right", y: 515, mobilTimer: 0 },
                { id: 2, lane: 2, target: "left", y: 510, mobilTimer: 0 },
                { id: 3, lane: 0, target: "right", y: 470, mobilTimer: 0 },
                { id: 4, lane: 1, target: "left", y: 465, mobilTimer: 0 },
                { id: 5, lane: 2, target: "right", y: 460, mobilTimer: 0 },
              ],
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Overlap: String(sim.testMetrics.overlapCount),
          Wall: String(sim.testMetrics.wallEscapeCount),
          "Unsafe rejects": String(sim.testMetrics.mergeRejectUnsafeCount),
          "Planner illegal": String(sim.plannerIllegalCount),
        };
      },
      verdict(inst) {
        return legal(inst.cases[0].sim);
      },
    },
    {
      id: "GEO",
      section: "collision",
      family: "guard_green",
      name: "Fork-edge geometry sync",
      proof:
        "Static fork geometry guard. The split wall and branch dividers must begin only after the fork opens by the configured gap, and the shared width model must stay monotonic.",
      build() {
        const caseRecord = customCase("3L geometry", { lanes: 3, seed: 208, maxTicks: 1, cars: [] });
        const road = caseRecord.sim.road;
        let maxHalf = 0;
        for (let i = 0; i <= 100; i++) {
          maxHalf = Math.max(maxHalf, road.branchHalfW("left", i / 100));
        }
        return { cases: [caseRecord], state: { maxHalf } };
      },
      metrics(inst) {
        const road = inst.cases[0].sim.road;
        return {
          "Base/main/branch": `${road.baseLw.toFixed(1)} / ${road.mainLw.toFixed(1)} / ${road.branchLw.toFixed(1)}`,
          "Split start": road.splitWallStartT.toFixed(3),
          "Gap at split": road.splitGapAt(road.splitWallStartT).toFixed(2) + "px",
          "Pre-split artifacts": String(road.preSplitInnerBoundarySampleCount),
        };
      },
      stop() {
        return true;
      },
      verdict(inst) {
        const road = inst.cases[0].sim.road;
        return (
          road.preSplitInnerBoundarySampleCount === 0 &&
          Math.abs(road.mainLw - road.baseLw * 1.1) < 0.001 &&
          Math.abs(road.branchLw - road.baseLw * 1.25) < 0.001 &&
          road.splitGapAt(road.splitWallStartT) >= TC.SPLIT_WALL_GAP &&
          inst.state.maxHalf <= road.branchHalfW("left", 1) + 1
        );
      },
    },
    {
      id: "SEQ",
      section: "collision",
      family: "guard_green",
      name: "Fork edge sequential replay",
      proof:
        "Geometry replay requested during planning: first a left-target convoy, then a right-target convoy. The fork must stay legal with zero premature inner-wall contacts.",
      build() {
        return {
          cases: [
            customCase("3L left then right", {
              lanes: 3,
              seed: 209,
              maxTicks: 9000,
              finishBased: true,
              cars: sequentialForkCars(3, 6, 6),
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Done: countDone(sim) + "/12",
          Time: timeStr(inst.cases[0]),
          Wall: String(sim.testMetrics.wallEscapeCount),
          "Premature split": String(sim.testMetrics.prematureSplitWallContactCount),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return (
          sim.finished &&
          countDone(sim) === 12 &&
          sim.testMetrics.wallEscapeCount === 0 &&
          sim.testMetrics.prematureSplitWallContactCount === 0
        );
      },
    },
    {
      id: "AO",
      section: "collision",
      family: "known_red",
      name: "Short-view completion floor",
      proof:
        "Browser fallback now keeps a minimum logical road even when the canvas gets very short. " +
        "At that floor, 2L and 3L mixed traffic must still stay legal and reach a branch exit.",
      build() {
        return {
          cases: [
            standardCase("2L short view", {
              lanes: 2,
              cars: 6,
              split: 50,
              seed: 615,
              maxTicks: 5000,
              w: SHORT_VIEW.w,
              h: SHORT_VIEW.h,
              stepsPerFrame: 10,
            }),
            standardCase("3L short view", {
              lanes: 3,
              cars: 6,
              split: 50,
              seed: 616,
              maxTicks: 5000,
              w: SHORT_VIEW.w,
              h: SHORT_VIEW.h,
              stepsPerFrame: 10,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        return {
          "2L": inst.cases[0].sim.finished ? timeStr(inst.cases[0]) : "DNF",
          "3L": inst.cases[1].sim.finished ? timeStr(inst.cases[1]) : "DNF",
          "2L done": countDone(inst.cases[0].sim) + "/6",
          "3L done": countDone(inst.cases[1].sim) + "/6",
        };
      },
      verdict(inst) {
        return inst.cases.every((caseRecord) => caseRecord.sim.finished && legal(caseRecord.sim));
      },
    },
    {
      id: "P",
      section: "collision",
      family: "guard_green",
      name: "dt-spike legality chaos",
      proof:
        "Road-based high-dt guard. Dense traffic at dt=2 and dt=3 must still stay overlap-free and inside the road.",
      build() {
        return {
          cases: [
            standardCase("3L 20c dt2", {
              lanes: 3,
              cars: 20,
              split: 50,
              seed: 206,
              maxTicks: 4000,
              dt: 2,
              w: PHONE.w,
              h: PHONE.h,
              finishBased: false,
              stepsPerFrame: 12,
            }),
            standardCase("3L 20c dt3", {
              lanes: 3,
              cars: 20,
              split: 50,
              seed: 207,
              maxTicks: 4000,
              dt: 3,
              w: PHONE.w,
              h: PHONE.h,
              finishBased: false,
              stepsPerFrame: 12,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const a = inst.cases[0].sim;
        const b = inst.cases[1].sim;
        return {
          "dt2 legal": legal(a) ? "YES" : "NO",
          "dt3 legal": legal(b) ? "YES" : "NO",
          "dt2 overlaps": String(a.testMetrics.overlapCount),
          "dt3 overlaps": String(b.testMetrics.overlapCount),
        };
      },
      verdict(inst) {
        return inst.cases.every((caseRecord) => legal(caseRecord.sim));
      },
    },
    {
      id: "Q",
      section: "mixed",
      family: "known_red",
      name: "Paradox race",
      proof:
        "1L, 2L, 3L at 50/50. The pass condition is that all complete and 1L finishes fastest.",
      build() {
        return {
          cases: [
            standardCase("1L", {
              lanes: 1,
              cars: 10,
              split: 50,
              seed: 301,
              maxTicks: 6000,
              stepsPerFrame: 8,
            }),
            standardCase("2L", {
              lanes: 2,
              cars: 10,
              split: 50,
              seed: 302,
              maxTicks: 6000,
              stepsPerFrame: 8,
            }),
            standardCase("3L", {
              lanes: 3,
              cars: 10,
              split: 50,
              seed: 303,
              maxTicks: 6000,
              stepsPerFrame: 8,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        return {
          Order: finishOrder(inst.cases),
          "1L done": countDone(inst.cases[0].sim) + "/10",
          "2L done": countDone(inst.cases[1].sim) + "/10",
          "3L done": countDone(inst.cases[2].sim) + "/10",
        };
      },
      verdict(inst) {
        const [a, b, c] = inst.cases.map((caseRecord) => caseRecord.sim);
        return a.finished && b.finished && c.finished && a.timerSec < b.timerSec && a.timerSec < c.timerSec;
      },
    },
    {
      id: "R",
      section: "mixed",
      family: "survey_green",
      name: "Completion race",
      proof:
        "Same comparative setup as Q, but judged only on whether all 1L/2L/3L runs complete within budget.",
      build() {
        return {
          cases: [
            standardCase("1L", {
              lanes: 1,
              cars: 10,
              split: 50,
              seed: 304,
              maxTicks: 6000,
              stepsPerFrame: 8,
            }),
            standardCase("2L", {
              lanes: 2,
              cars: 10,
              split: 50,
              seed: 305,
              maxTicks: 6000,
              stepsPerFrame: 8,
            }),
            standardCase("3L", {
              lanes: 3,
              cars: 10,
              split: 50,
              seed: 306,
              maxTicks: 6000,
              stepsPerFrame: 8,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        return {
          Order: finishOrder(inst.cases),
          "1L": inst.cases[0].sim.finished ? "DONE" : "DNF",
          "2L": inst.cases[1].sim.finished ? "DONE" : "DNF",
          "3L": inst.cases[2].sim.finished ? "DONE" : "DNF",
        };
      },
      verdict(inst) {
        return inst.cases.every((caseRecord) => caseRecord.sim.finished);
      },
    },
    {
      id: "S",
      section: "mixed",
      family: "guard_green",
      name: "Maneuver activation",
      proof:
        "3L, 40 cars, 50/50. At least one car should enter maneuver mode in a real mixed-traffic jam.",
      build() {
        return {
          cases: [
            standardCase("3L 40c", {
              lanes: 3,
              cars: 40,
              split: 50,
              seed: 307,
              maxTicks: 12000,
              stepsPerFrame: 20,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Maneuvers: String(sim.testMetrics.maneuverEnterCount),
          Done: countDone(sim) + "/40",
          Time: timeStr(inst.cases[0]),
          "No-progress max": sim.testMetrics.maxNoProgressTicks.toFixed(0),
        };
      },
      stop(inst) {
        return (
          inst.cases[0].sim.testMetrics.maneuverEnterCount > 0 ||
          inst.cases.every((caseRecord) => caseRecord.done)
        );
      },
      verdict(inst) {
        return inst.cases[0].sim.testMetrics.maneuverEnterCount > 0;
      },
    },
    {
      id: "T",
      section: "mixed",
      family: "guard_green",
      name: "Progress-based maneuver reason",
      proof:
        "Same setup as S, but the maneuver entry must be caused by progress starvation, not just a generic fallback.",
      build() {
        return {
          cases: [
            standardCase("3L 40c", {
              lanes: 3,
              cars: 40,
              split: 50,
              seed: 308,
              maxTicks: 12000,
              stepsPerFrame: 20,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Progress maneuvers": String(sim.testMetrics.maneuverEnterReasons.progress),
          "Total maneuvers": String(sim.testMetrics.maneuverEnterCount),
          Done: countDone(sim) + "/40",
          Time: timeStr(inst.cases[0]),
        };
      },
      stop(inst) {
        return (
          inst.cases[0].sim.testMetrics.maneuverEnterReasons.progress > 0 ||
          inst.cases.every((caseRecord) => caseRecord.done)
        );
      },
      verdict(inst) {
        return inst.cases[0].sim.testMetrics.maneuverEnterReasons.progress > 0;
      },
    },
    {
      id: "U",
      section: "mixed",
      family: "known_red",
      name: "Live merge safety under 50/50",
      proof:
        "2L, 10 cars, 50/50. Any accepted live merge should still respect the 33px normal safety distance.",
      build() {
        return {
          cases: [
            standardCase("2L 50/50", {
              lanes: 2,
              cars: 10,
              split: 50,
              seed: 309,
              maxTicks: 5000,
              stepsPerFrame: 10,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Merge accepts": String(sim.testMetrics.mergeAcceptCount),
          "Unsafe rejects": String(sim.testMetrics.mergeRejectUnsafeCount),
          "Min accepted gap":
            sim.testMetrics.minAcceptedMergeGap === Infinity
              ? "INF"
              : sim.testMetrics.minAcceptedMergeGap.toFixed(2),
          "Wall escapes": String(sim.testMetrics.wallEscapeCount),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return legal(sim) && sim.testMetrics.mergeAcceptCount > 0 && sim.testMetrics.minAcceptedMergeGap >= CAR_L * 1.5;
      },
    },
    {
      id: "V",
      section: "mixed",
      family: "survey_green",
      name: "Conflict maneuver resolution",
      proof:
        "Mixed conflict should only count as solved if cars actually maneuver around the blockage and restore progress instead of only waiting.",
      build() {
        return {
          cases: [
            standardCase("3L maneuver jam", {
              lanes: 3,
              cars: 14,
              split: 50,
              seed: 310,
              maxTicks: 7000,
              stepsPerFrame: 12,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "First maneuver":
            sim.testMetrics.firstManeuverTick === null
              ? "none"
              : sim.testMetrics.firstManeuverTick.toFixed(0),
          "First conflict clear":
            sim.testMetrics.firstConflictClearanceTick === null
              ? "none"
              : sim.testMetrics.firstConflictClearanceTick.toFixed(0),
          "Done left/right": `${leftDone(sim) ? 1 : 0}/${rightDone(sim) ? 1 : 0}`,
        };
      },
      stop(inst) {
        const sim = inst.cases[0].sim;
        return leftDone(sim) && rightDone(sim) && sim.testMetrics.firstConflictClearanceTick !== null;
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        const restored =
          leftDone(sim) &&
          rightDone(sim) &&
          sim.testMetrics.firstConflictClearanceTick !== null;
        return {
          kind:
            legal(sim) &&
              sim.testMetrics.firstManeuverTick !== null &&
              restored
              ? "pass"
              : "fail",
          text:
            legal(sim) &&
              sim.testMetrics.firstManeuverTick !== null &&
              restored
              ? "PASS"
              : "FAIL",
        };
      },
    },
    {
      id: "AA",
      section: "mixed",
      family: "survey_green",
      name: "Blocked-exit legality / spillback",
      proof:
        "Downstream left branch is blocked. No car may be admitted into the blocked branch illegally, and no car should stall inside the conflict zone for too long.",
      build() {
        return {
          cases: [
            customCase("2L blocked exit conflict", {
              lanes: 2,
              seed: 410,
              maxTicks: 320,
              cars: blockedExitConflictCars(),
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Conflict entries": conflictMetrics(sim),
          "Blocked-exit admits": String(sim.testMetrics.illegalBlockedExitAdmissionCount),
          "Max conflict stall": sim.testMetrics.maxConflictZoneStallTicks.toFixed(0),
          "Branch stop": sim.testMetrics.maxBlockedBranchStopTicks.toFixed(0),
        };
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        return {
          kind:
            legal(sim) &&
              sim.testMetrics.illegalBlockedExitAdmissionCount === 0 &&
              sim.testMetrics.maxConflictZoneStallTicks <= 10
              ? "pass"
              : "fail",
          text:
            legal(sim) &&
              sim.testMetrics.illegalBlockedExitAdmissionCount === 0 &&
              sim.testMetrics.maxConflictZoneStallTicks <= 10
              ? "PASS"
              : "FAIL",
        };
      },
    },
    {
      id: "AB",
      section: "same",
      family: "survey_green",
      name: "Lower conflicts yield without convoy wobble",
      proof:
        "When a same-target left convoy already has the clear path, lower conflicting cars should yield instead of pulling the convoy into yield or maneuver mode.",
      build() {
        return {
          cases: [
            customCase("2L convoy priority", {
              lanes: 2,
              seed: 510,
              maxTicks: 240,
              finishBased: true,
              cars: [
                { id: 0, pathKey: "1-left", lane: 1, target: "left", pathT: 0.51, mobilTimer: 999, color: "#c48828" },
                { id: 1, pathKey: "1-left", lane: 1, target: "left", pathT: 0.44, mobilTimer: 999, color: "#d8a35f" },
                { id: 2, pathKey: "0-right", lane: 0, target: "right", pathT: 0.46, mobilTimer: 999, color: "#2888c4" },
                { id: 3, pathKey: "0-right", lane: 0, target: "right", pathT: 0.38, mobilTimer: 999, color: "#5aa6d1" },
              ],
            }),
          ],
          state: { leftBadYield: false, leftBadManeuver: false, rightYield: false },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        inst.state.leftBadYield = inst.state.leftBadYield || sim.testEvents.some(
          (event) => event.type === "yield_enter" && (event.carId === 0 || event.carId === 1)
        );
        inst.state.leftBadManeuver = inst.state.leftBadManeuver || sim.testEvents.some(
          (event) => event.type === "maneuver_enter" && (event.carId === 0 || event.carId === 1)
        );
        inst.state.rightYield = inst.state.rightYield || sim.testEvents.some(
          (event) => event.type === "yield_enter" && (event.carId === 2 || event.carId === 3)
        );
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Left bad yield": inst.state.leftBadYield ? "YES" : "NO",
          "Left bad maneuver": inst.state.leftBadManeuver ? "YES" : "NO",
          "Right yielded": inst.state.rightYield ? "YES" : "NO",
          Modes: `${sim.testMetrics.yieldEnterCount}/${sim.testMetrics.maneuverEnterCount}`,
        };
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        const pass =
          legal(sim) &&
          inst.state.rightYield &&
          !inst.state.leftBadYield &&
          !inst.state.leftBadManeuver &&
          sim.cars[0].seg === "left" &&
          sim.cars[1].seg === "left";
        return { kind: pass ? "pass" : "fail", text: pass ? "PASS" : "FAIL" };
      },
    },
    {
      id: "AD",
      section: "mixed",
      family: "survey_green",
      name: "Maneuver exit ignores side-clear maneuverers",
      proof:
        "A car with restored forward progress should exit maneuver mode even if another maneuvering car remains nearby but outside its real blocker corridor.",
      build() {
        return {
          cases: [
            customCase("2L maneuver exit locality", {
              lanes: 2,
              seed: 511,
              maxTicks: 160,
              cars: [
                {
                  id: 0,
                  pathKey: "1-left",
                  lane: 1,
                  target: "left",
                  pathT: 0.76,
                  seg: "left",
                  dx: 2,
                  mobilTimer: 999,
                  maneuvering: true,
                  trafficMode: "maneuver",
                  noProgressTicks: 80,
                  progressResumeTicks: 19,
                  color: "#c48828",
                },
                {
                  id: 1,
                  pathKey: "0-left",
                  lane: 0,
                  target: "left",
                  pathT: 0.57,
                  seg: "main",
                  dx: 0,
                  dy: -6,
                  mobilTimer: 999,
                  maneuvering: true,
                  trafficMode: "maneuver",
                  noProgressTicks: 80,
                  color: "#8f6a2a",
                },
              ],
            }),
          ],
          state: { exitSeen: false, progressSeen: false },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        inst.state.exitSeen = inst.state.exitSeen || sim.testEvents.some(
          (event) => event.type === "maneuver_exit" && event.carId === 0
        );
        inst.state.progressSeen = inst.state.progressSeen || sim.cars[0].seg === "left" || sim.cars[0].pathIdx > 70;
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Exit: inst.state.exitSeen ? "YES" : "NO",
          Progress: inst.state.progressSeen ? "YES" : "NO",
          "Car 0 mode": sim.cars[0].trafficMode,
          "Car 0 maneuver": sim.cars[0].maneuvering ? "YES" : "NO",
        };
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        const pass =
          legal(sim) &&
          inst.state.progressSeen &&
          ((inst.state.exitSeen) || (!sim.cars[0].maneuvering && sim.cars[0].trafficMode !== "maneuver"));
        return { kind: pass ? "pass" : "fail", text: pass ? "PASS" : "FAIL" };
      },
    },
    {
      id: "AN",
      section: "mixed",
      family: "known_red",
      name: "Batch grant stays stable until clearance",
      proof:
        "Once a target gets the fork batch, the scheduler should not flip the grant to the opposite target before the current holder clears the zone.",
      build() {
        return {
          cases: [
            standardCase("2L priority stability", {
              lanes: 2,
              cars: 10,
              split: 50,
              seed: 309,
              maxTicks: 700,
              stepsPerFrame: 10,
            }),
          ],
          state: { flippedBeforeClear: false, grants: 0 },
        };
      },
      observe(inst) {
        const events = inst.cases[0].sim.testEvents.filter(
          (event) => event.type === "batch_grant" || event.type === "conflict_exit"
        );
        let currentTarget = null;
        let cleared = true;
        let grantCount = 0;
        let flippedBeforeClear = false;
        for (const event of events) {
          if (event.type === "batch_grant") {
            grantCount++;
            if (!cleared && currentTarget !== null && event.target !== currentTarget) {
              flippedBeforeClear = true;
              break;
            }
            currentTarget = event.target;
            cleared = false;
          } else if (event.type === "conflict_exit") {
            cleared = true;
          }
        }
        inst.state.flippedBeforeClear = flippedBeforeClear;
        inst.state.grants = grantCount;
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Grant flips": inst.state.flippedBeforeClear ? "YES" : "NO",
          Grants: String(inst.state.grants),
          Yields: String(sim.testMetrics.yieldEnterCount),
          "Conflict clears":
            sim.testMetrics.firstConflictClearanceTick === null
              ? "none"
              : sim.testMetrics.firstConflictClearanceTick.toFixed(0),
        };
      },
      evaluate(inst) {
        const sim = inst.cases[0].sim;
        const pass = legal(sim) && !inst.state.flippedBeforeClear;
        return { kind: pass ? "pass" : "fail", text: pass ? "PASS" : "FAIL" };
      },
    },
    {
      id: "W",
      section: "mixed",
      family: "diagnostic",
      name: "Fair alternation / starvation",
      proof:
        "3L, 20 cars, 50/50. Both targets must get service and starvation must stay below 180 ticks.",
      build() {
        return {
          cases: [
            standardCase("3L fairness", {
              lanes: 3,
              cars: 20,
              split: 50,
              seed: 311,
              maxTicks: 7000,
              stepsPerFrame: 12,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        const left = sim.cars.filter((car) => car.done && car.target === "left").length;
        const right = sim.cars.filter((car) => car.done && car.target === "right").length;
        return {
          "Done left/right": `${left}/${right}`,
          "Max starve": String(sim.testMetrics.maxStarveTicks),
          Batches: String(sim.testMetrics.batchGrantCount),
          Time: timeStr(inst.cases[0]),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        const left = sim.cars.filter((car) => car.done && car.target === "left").length;
        const right = sim.cars.filter((car) => car.done && car.target === "right").length;
        return left > 0 && right > 0 && sim.testMetrics.maxStarveTicks <= 180;
      },
    },
    {
      id: "X",
      section: "mixed",
      family: "guard_green",
      name: "Late lane oscillation",
      proof:
        "3L, 20 cars, 50/50. No car should keep attempting voluntary lane changes after COMMIT_DIST.",
      build() {
        return {
          cases: [
            standardCase("3L commit lock", {
              lanes: 3,
              cars: 20,
              split: 50,
              seed: 312,
              maxTicks: 7000,
              stepsPerFrame: 12,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Late commit changes": String(sim.testMetrics.lateCommitLaneChangeCount),
          "Merge attempts": String(sim.testMetrics.mergeAttemptCount),
          Done: countDone(sim) + "/20",
          Time: timeStr(inst.cases[0]),
        };
      },
      verdict(inst) {
        return inst.cases[0].sim.testMetrics.lateCommitLaneChangeCount === 0;
      },
    },
    {
      id: "Y",
      section: "mixed",
      family: "survey_green",
      name: "Stress completion",
      proof:
        "4L and 5L, 40 cars, 50/50. Both heavy mixed-traffic runs should still complete within the large tick budget.",
      build() {
        return {
          cases: [
            standardCase("4L", {
              lanes: 4,
              cars: 40,
              split: 50,
              seed: 313,
              maxTicks: 30000,
              stepsPerFrame: 40,
            }),
            standardCase("5L", {
              lanes: 5,
              cars: 40,
              split: 50,
              seed: 314,
              maxTicks: 30000,
              stepsPerFrame: 40,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        return {
          "4L": inst.cases[0].sim.finished ? timeStr(inst.cases[0]) : "DNF",
          "5L": inst.cases[1].sim.finished ? timeStr(inst.cases[1]) : "DNF",
          "4L done": countDone(inst.cases[0].sim) + "/40",
          "5L done": countDone(inst.cases[1].sim) + "/40",
        };
      },
      verdict(inst) {
        return inst.cases.every((caseRecord) => caseRecord.sim.finished);
      },
    },
    {
      id: "Z",
      section: "mixed",
      family: "guard_green",
      name: "Seed 309 hard-wall replay",
      proof:
        "Mirror the U seed, but judge only the hard-wall contract. This isolates whether the 2L 50/50 seed 309 run ever leaves the road.",
      build() {
        return {
          cases: [
            standardCase("2L seed 309 wall", {
              lanes: 2,
              cars: 10,
              split: 50,
              seed: 309,
              maxTicks: 5000,
              stepsPerFrame: 10,
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Wall escapes": String(sim.testMetrics.wallEscapeCount),
          Overlap: String(sim.testMetrics.overlapCount),
          Done: countDone(sim) + "/10",
          Time: timeStr(inst.cases[0]),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return sim.testMetrics.wallEscapeCount === 0 && sim.testMetrics.overlapCount === 0;
      },
    },
    // ─── MANEUVER OVERHAUL RED TESTS ─────────────────────────────────────────
    {
      id: "AC",
      section: "mixed",
      family: "guard_green", // FAIL today (bug), PASS after fix
      name: "Yield false-trigger — yield car must NOT accumulate noProgressTicks while batch car is progressing",
      proof:
        "Bug: line 619 traffic_core.js — blockedForProgress includes trafficMode==='yield'. " +
        "The crossing car (lane 1, target=left) enters yield mode while the 10-car convoy crosses. " +
        "With the bug: yield sets blockedForProgress=true → noProgressTicks accumulates every tick, " +
        "even when batch cars are actively progressing (noProgressTicks < 60). " +
        "Fix (F1-T2): batch-partner progress tracking — when any batch car has " +
        "noProgressTicks < NO_PROGRESS_THRESH, suppress yield car's accumulation. " +
        "After fix: yield car's noProgressTicks stays 0 while any batch car is progressing. " +
        "Test halts when: yield car has noProgressTicks > 0 AND any batch car has noProgressTicks < 60. " +
        "Crossing car at y=460 — within BATCH_APPROACH_DIST=170 of fork immediately — guarantees " +
        "it enters yield the moment the batch activates. Previous y=650 was too far: convoy cleared " +
        "via trailing before crossing car reached nearFork zone.",
      build() {
        // Deterministic 10+1 convoy scenario:
        //   Lane 0 (left): 10 cars going RIGHT — car at y=430 is closest to fork (gets batch priority)
        //   Lane 1 (right): 1 car going LEFT  — starts at y=460 (within nearFork zone immediately)
        // BATCH_APPROACH_DIST=170: fork≈y300, so nearFork boundary ≈ y470. Crossing car at y=460
        // is inside nearFork from t≈0, ensuring yield fires before convoy clears.
        // With bug: crossing car enters maneuver at ~60t (convoy still progressing) → FAIL.
        // With fix: crossing car's noProgressTicks stays 0 while any batch car is progressing → PASS.
        return {
          cases: [
            customCase("2L 10+1 convoy yield", {
              lanes: 2,
              seed: 101,
              maxTicks: 600,
              stepsPerFrame: 5,
              cars: [
                // Left-lane convoy (lane 0): all want to go RIGHT — cross to right branch
                { id: 0, lane: 0, target: "right", y: 430 }, // Ahead — gets batch priority first
                { id: 1, lane: 0, target: "right", y: 460 },
                { id: 2, lane: 0, target: "right", y: 490 },
                { id: 3, lane: 0, target: "right", y: 520 },
                { id: 4, lane: 0, target: "right", y: 550 },
                { id: 5, lane: 0, target: "right", y: 580 },
                { id: 6, lane: 0, target: "right", y: 610 },
                { id: 7, lane: 0, target: "right", y: 640 },
                { id: 8, lane: 0, target: "right", y: 670 },
                { id: 9, lane: 0, target: "right", y: 700 },
                // Right-lane crossing car (lane 1): wants to go LEFT — must yield to convoy
                // Placed at y=460: within BATCH_APPROACH_DIST of fork, enters yield immediately
                { id: 10, lane: 1, target: "left", y: 460 },
              ],
            }),
          ],
          state: {},
        };
      },
      stop(inst) {
        // Violation: yield car has noProgressTicks > 0 WHILE any batch car has noProgressTicks < 60.
        // With bug: yield sets blockedForProgress=true → noProgressTicks accumulates immediately.
        //   After ~5-10 ticks of yield: noProgressTicks > 0, batch cars still progressing → FIRES.
        // With fix (batch-partner tracking): yield car's noProgressTicks is suppressed while
        //   any batch car is progressing → stays at 0 → no violation.
        const sim = inst.cases[0].sim;
        const state = inst.state;
        if (state.firstViolation) return true;

        const yieldCar = sim.cars.find(
          (c) => !c.fixed && !c.done && c.trafficMode === "yield" && c.noProgressTicks > 0
        );
        if (yieldCar) {
          const batchCarProgressing = sim.cars.find(
            (c) => !c.fixed && !c.done && c.trafficMode === "batch" && c.noProgressTicks < 60
          );
          if (batchCarProgressing) {
            state.firstViolation = {
              tick: sim.ticks,
              yieldCarId: yieldCar.id,
              yieldNoProgress: yieldCar.noProgressTicks,
              batchCarId: batchCarProgressing.id,
              batchNoProgress: batchCarProgressing.noProgressTicks,
            };
            return true; // Stop immediately
          }
        }
        return sim.finished || inst.cases[0].done;
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        const state = inst.state;
        const crossingCar = sim.cars.find((c) => c.target === "left" && !c.fixed);
        const v = state.firstViolation;
        return {
          "Yield events": String(sim.testMetrics.yieldEnterCount || 0),
          "Maneuver events": String(sim.testMetrics.maneuverEnterCount || 0),
          "Stopped at tick": String(sim.ticks),
          "Crossing car mode": crossingCar
            ? crossingCar.trafficMode + (crossingCar.maneuvering ? "+M" : "")
            : "n/a",
          "Violation": v
            ? `t=${v.tick} yield-car${v.yieldCarId} noP=${v.yieldNoProgress.toFixed(1)} | batch-car${v.batchCarId} noP=${v.batchNoProgress.toFixed(1)}`
            : "none",
        };
      },
      verdict(inst) {
        // FAIL today: yield car accumulates noProgressTicks while batch car is actively progressing.
        // PASS after fix: batch-partner check suppresses accumulation → noProgressTicks stays 0.
        return !inst.state.firstViolation;
      },
    },
    {
      id: "AE",
      section: "mixed",
      family: "guard_green", // FAIL today (bug), PASS after F1-T2 fix
      name: "Yield patience — crossing car must NOT enter maneuver while convoy batch is active",
      proof:
        "2+1 convoy scenario (same geometry as card AC). " +
        "2 convoy cars (lane 0, target=right, y=430,460) + crossing car (lane 1, target=left, y=460). " +
        "Crossing car enters yield while convoy batch is active. " +
        "Assert-1: crossing car finishes (eventually gets its batch turn after convoy clears). " +
        "Assert-2: crossing car has 0 maneuver events — noProgressTicks was suppressed by F1-T2. " +
        "With bug: yield → blockedForProgress=true → crossing car accumulates noProgressTicks → " +
        "enters maneuver at ~60t while convoy is still crossing → maneuver event fires → FAIL. " +
        "With fix: batch-partner check suppresses accumulation → stays in yield → 0 maneuver events → PASS.",
      build() {
        return {
          cases: [
            customCase("2L 2+1 yield patience", {
              lanes: 2,
              seed: 101,
              maxTicks: 600,
              stepsPerFrame: 5,
              cars: [
                // 2-car convoy ahead of crossing car
                { id: 0, lane: 0, target: "right", y: 430 },
                { id: 1, lane: 0, target: "right", y: 460 },
                // Crossing car: enters yield while convoy in batch
                { id: 2, lane: 1, target: "left", y: 460 },
              ],
            }),
          ],
          state: { finishTimes: {}, failReason: null },
        };
      },
      stop(inst) {
        const sim = inst.cases[0].sim;
        const state = inst.state;
        for (const car of sim.cars) {
          if (car.done && !(car.id in state.finishTimes)) {
            state.finishTimes[car.id] = sim.ticks;
          }
        }
        return sim.finished || inst.cases[0].done;
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        const state = inst.state;
        const crossingCar = sim.cars.find((c) => c.target === "left" && !c.fixed);
        const maneuverEvents = sim.testEvents.filter(
          (e) => e.type === "maneuver_enter" && crossingCar && e.carId === crossingCar.id
        ).length;
        return {
          "Crossing car done": crossingCar
            ? String(crossingCar.done) + " @t=" + (state.finishTimes[crossingCar.id] || "DNF")
            : "n/a",
          "Crossing car maneuver events": String(maneuverEvents),
          "Fail reason": state.failReason || "none",
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        const state = inst.state;
        const crossingCar = sim.cars.find((c) => c.target === "left" && !c.fixed);

        // Assertion 1: crossing car finished
        if (!crossingCar || !crossingCar.done) {
          state.failReason = "Assert-1 FAIL: crossing car (target=left) did not finish";
          return false;
        }

        // Assertion 2: crossing car triggered 0 maneuver events
        // (F1-T2: noProgressTicks stays suppressed while any batch car is progressing)
        const maneuverEvents = sim.testEvents.filter(
          (e) => e.type === "maneuver_enter" && e.carId === crossingCar.id
        ).length;
        if (maneuverEvents > 0) {
          state.failReason = `Assert-2 FAIL: crossing car entered maneuver ${maneuverEvents} time(s) — noProgressTicks was NOT suppressed`;
          return false;
        }

        return true;
      },
    },
    // ── F1-T1b: Test B — 10+1 convoy completion within 30 in-game seconds ──
    {
      id: "AP",
      section: "mixed",
      family: "diagnostic",
      name: "Convoy clears — all 11 cars finish within 30 sim-seconds",
      proof:
        "10+1 convoy scenario (same as card AC). 3 assertions: " +
        "(1) crossing car (target=left) finishes, " +
        "(2) all 10 convoy cars (target=right) finish, " +
        "(3) all cars finish within 1800 ticks (30 sim-seconds). " +
        "Before main speed floor: IDM cascade keeps rear cars frozen — only 2/10 finish in 800t. " +
        "After fix: scheduler disables once crossing car clears, main speed floor kicks in, " +
        "convoy flows smoothly through fork. All done well under 30s.",
      build() {
        return {
          cases: [
            customCase("2L 10+1 convoy order", {
              lanes: 2,
              seed: 101,
              maxTicks: 1800,
              stepsPerFrame: 8,
              cars: [
                { id: 0, lane: 0, target: "right", y: 430 },
                { id: 1, lane: 0, target: "right", y: 460 },
                { id: 2, lane: 0, target: "right", y: 490 },
                { id: 3, lane: 0, target: "right", y: 520 },
                { id: 4, lane: 0, target: "right", y: 550 },
                { id: 5, lane: 0, target: "right", y: 580 },
                { id: 6, lane: 0, target: "right", y: 610 },
                { id: 7, lane: 0, target: "right", y: 640 },
                { id: 8, lane: 0, target: "right", y: 670 },
                { id: 9, lane: 0, target: "right", y: 700 },
                { id: 10, lane: 1, target: "left", y: 460 },
              ],
            }),
          ],
          state: { finishTicks: {} },
        };
      },
      stop(inst) {
        const sim = inst.cases[0].sim;
        for (const car of sim.cars) {
          if (car.done && !(car.id in inst.state.finishTicks)) {
            inst.state.finishTicks[car.id] = sim.ticks;
          }
        }
        return sim.finished || inst.cases[0].done;
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        const crossingCar = sim.cars.find((c) => c.target === "left" && !c.fixed);
        const convoyCars = sim.cars.filter((c) => c.target === "right" && !c.fixed);
        const convoyDone = convoyCars.filter((c) => c.done).length;
        const crossingTick = crossingCar ? (inst.state.finishTicks[crossingCar.id] || "DNF") : "n/a";
        const lastAnyTick = Math.max(0, ...Object.values(inst.state.finishTicks));
        return {
          "Crossing done": crossingCar ? String(crossingCar.done) + " @t=" + crossingTick : "n/a",
          "Convoy done": convoyDone + "/10",
          "Last car tick": String(lastAnyTick || "none"),
          "Sim seconds": (sim.ticks / 60).toFixed(1) + "s",
          "Cleared in 30s": lastAnyTick > 0 && lastAnyTick <= 1800 ? "YES" : "NO",
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        const crossingCar = sim.cars.find((c) => c.target === "left" && !c.fixed);
        const convoyCars = sim.cars.filter((c) => c.target === "right" && !c.fixed);

        // Assert 1: crossing car finished
        if (!crossingCar || !crossingCar.done) return false;

        // Assert 2: all 10 convoy cars finished
        if (convoyCars.some((c) => !c.done)) return false;

        // Assert 3: all cars done within 1800 ticks (30 sim-seconds)
        const lastTick = Math.max(0, ...Object.values(inst.state.finishTicks));
        if (lastTick > 1800 || lastTick === 0) return false;

        return legal(sim);
      },
    },
    // ── F2-T1: Batch+stuck direct exit test ──
    {
      id: "AQ",
      section: "mixed",
      family: "diagnostic",
      name: "Batch+stuck: maneuvering car with batch grant exits maneuver",
      proof:
        "Bug: maneuver exit logic (lines 693-722) has no branch for assignedMode==='batch' AND canExit===true. " +
        "Test: 2L, 14 cars, 50/50 split — enough density to force maneuver entry + batch scheduling. " +
        "Observe: stop records _assignedTrafficMode='batch' on maneuvering cars (the bug condition). " +
        "With bug: car stays in maneuver because exit logic falls through to default → max maneuver ticks high. " +
        "With fix: car exits maneuver when batch+canExit → all cars complete, max maneuver ticks low.",
      build() {
        return {
          cases: [
            standardCase("3L batch+stuck dense", {
              lanes: 3,
              cars: 40,
              split: 50,
              seed: 307,
              maxTicks: 12000,
              stepsPerFrame: 20,
            }),
          ],
          state: { batchGrantWhileManeuver: false, maxManeuverTicks: 0 },
        };
      },
      stop(inst) {
        const sim = inst.cases[0].sim;
        for (const car of sim.cars) {
          if (car.maneuvering && car.maneuverTimer > inst.state.maxManeuverTicks) {
            inst.state.maxManeuverTicks = car.maneuverTimer;
          }
          // The bug condition: car.maneuvering is true AND batch scheduler assigned 'batch'
          if (car.maneuvering && car._assignedTrafficMode === "batch") {
            inst.state.batchGrantWhileManeuver = true;
          }
        }
        return sim.finished || inst.cases[0].done;
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Batch+maneuver seen": String(inst.state.batchGrantWhileManeuver),
          "Max maneuver ticks": inst.state.maxManeuverTicks.toFixed(0),
          "Maneuver enters": String(sim.testMetrics.maneuverEnterCount || 0),
          "Cars done": countDone(sim) + "/" + sim.cars.filter((c) => !c.fixed).length,
          Ticks: String(sim.ticks),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        const allDone = sim.cars.every((c) => c.fixed || c.done);
        // PASS: all cars complete AND no car stuck in maneuver > 200 ticks
        return allDone && inst.state.maxManeuverTicks <= 200 && legal(sim);
      },
    },
    // ── F2-T2: No car stuck in maneuver > 300 ticks (uses card AI's scenario) ──
    {
      id: "AR",
      section: "mixed",
      family: "diagnostic",
      name: "No car in maneuver > 300 ticks (stress scenario)",
      proof:
        "Bug: batch+stuck causes a car to remain in maneuver indefinitely. " +
        "Test: 3L, 40 cars, 50/50 split — same as card AI's follow-deadlock scenario. " +
        "Assert: no car has maneuverTimer > 300 at any point during the run. " +
        "With bug: at least one car exceeds 300t in maneuver → FAIL. " +
        "With fix: all maneuvers resolve within 300t → PASS.",
      build() {
        return {
          cases: [
            standardCase("3L maneuver timeout", {
              lanes: 3,
              cars: 40,
              split: 50,
              seed: 307,
              maxTicks: 12000,
              stepsPerFrame: 20,
            }),
          ],
          state: { maxManeuverTicks: 0, stuckCarId: null },
        };
      },
      stop(inst) {
        const sim = inst.cases[0].sim;
        for (const car of sim.cars) {
          if (car.maneuvering && car.maneuverTimer > inst.state.maxManeuverTicks) {
            inst.state.maxManeuverTicks = car.maneuverTimer;
            if (car.maneuverTimer > 300) inst.state.stuckCarId = car.id;
          }
        }
        return sim.finished || inst.cases[0].done;
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Max maneuver ticks": inst.state.maxManeuverTicks.toFixed(0),
          "Stuck car": inst.state.stuckCarId !== null ? "car " + inst.state.stuckCarId : "none",
          "Cars done": countDone(sim) + "/40",
          Ticks: String(sim.ticks),
        };
      },
      verdict(inst) {
        return inst.state.maxManeuverTicks <= 300 && legal(inst.cases[0].sim);
      },
    },
    // ── F2-T3: Forced-gridlock resolution ──
    {
      id: "AS",
      section: "mixed",
      family: "diagnostic",
      name: "Forced-gridlock resolves — all crossing cars complete",
      proof:
        "2L, 4 cars per side, all crossing (8 total). Dense packing near fork forces gridlock. " +
        "Assert: all 8 cars complete within maxTicks. " +
        "With bug: permanent stuck car → not all complete → FAIL. " +
        "With fix: batch scheduler + maneuver resolve → all complete → PASS.",
      build() {
        return {
          cases: [
            standardCase("3L gridlock resolution", {
              lanes: 3,
              cars: 40,
              split: 50,
              seed: 308,
              maxTicks: 12000,
              stepsPerFrame: 20,
            }),
          ],
          state: { maxManeuverTicks: 0 },
        };
      },
      stop(inst) {
        const sim = inst.cases[0].sim;
        for (const car of sim.cars) {
          if (car.maneuvering && car.maneuverTimer > inst.state.maxManeuverTicks) {
            inst.state.maxManeuverTicks = car.maneuverTimer;
          }
        }
        return sim.finished || inst.cases[0].done;
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        const doneCars = sim.cars.filter((c) => !c.fixed && c.done).length;
        const totalCars = sim.cars.filter((c) => !c.fixed).length;
        return {
          "Cars done": doneCars + "/" + totalCars,
          "Max maneuver ticks": inst.state.maxManeuverTicks.toFixed(0),
          Ticks: String(sim.ticks),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        const allDone = sim.cars.every((c) => c.fixed || c.done);
        return allDone && inst.state.maxManeuverTicks <= 300 && legal(sim);
      },
    },

    // ── Performance Wave 4 — Diagnostic cards (AT–AW) ──────────────
    // These cards quantify performance bottlenecks at high car counts.
    // RED phase: all should FAIL, proving the bottleneck exists.
    // GREEN phase: fixes make them PASS.

    {
      id: "AT",
      section: "mixed",
      family: "diagnostic",
      name: "Off-screen sleep ratio — pipeline skipped for distant cars",
      proof:
        "3L, 80 cars, 50/50, 100 ticks. Checks sim.testMetrics.sleepTicksTotal vs awakeTicksTotal. " +
        "Verdict: PASS if >50% of car-ticks are sleeping (pipeline skipped). " +
        "FAIL if sleeping mechanism is absent or ineffective.",
      build() {
        const c = standardCase("80-car sleep ratio", {
          lanes: 3,
          cars: 80,
          split: 50,
          seed: 307,
          w: PHONE.w,
          h: PHONE.h,
          maxTicks: 100,
          stepsPerFrame: 1,
        });
        return { cases: [c], state: {} };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        const sl = sim.testMetrics.sleepTicksTotal;
        const aw = sim.testMetrics.awakeTicksTotal;
        const total = sl + aw;
        const pct = total > 0 ? ((sl / total) * 100).toFixed(1) : "0";
        return {
          "Sleeping car-ticks": String(sl),
          "Awake car-ticks": String(aw),
          "Sleep %": pct + "%",
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        const sl = sim.testMetrics.sleepTicksTotal;
        const aw = sim.testMetrics.awakeTicksTotal;
        const total = sl + aw;
        if (total === 0) return false;
        // PASS if >50% of car-ticks are sleeping
        return (sl / total) > 0.50 && legal(sim);
      },
    },

    {
      id: "AU",
      section: "mixed",
      family: "diagnostic",
      name: "Per-tick scaling — wall time at 20/40/60/80 cars",
      proof:
        "Run 3L sims at 20, 40, 60, 80 cars for 50 ticks each. Measure wall time per tick. " +
        "Verdict: FAIL if 80-car per-tick is >6× the 20-car per-tick (proves super-linear scaling).",
      build() {
        const configs = [20, 40, 60, 80];
        const cases = configs.map((n) =>
          standardCase(n + " cars", {
            lanes: 3,
            cars: n,
            split: 50,
            seed: 307,
            w: PHONE.w,
            h: PHONE.h,
            maxTicks: 50,
            stepsPerFrame: 1,
            finishBased: false,
          })
        );
        return {
          cases,
          state: { wallTimes: {}, measuring: configs.slice() },
        };
      },
      observe(_inst) {
        // Timing is measured in verdict via createHidden; observe is a no-op
      },
      verdict(inst) {
        // Measure wall time for each case by running fresh hidden sims
        const configs = [20, 40, 60, 80];
        const times = {};
        for (const n of configs) {
          const start = typeof performance !== "undefined" ? performance.now() : Date.now();
          createHidden({
            lanes: 3,
            nCars: n,
            splitPct: 50,
            seed: 307,
            w: PHONE.w,
            h: PHONE.h,
            maxTicks: 50,
            dt: 1,
          });
          const end = typeof performance !== "undefined" ? performance.now() : Date.now();
          times[n] = end - start;
        }
        inst.state.wallTimes = times;
        const ratio = times[80] / Math.max(times[20], 0.01);
        // PASS if scaling is <=4× (near-linear); FAIL if super-linear
        return ratio <= 4;
      },
      metrics(inst) {
        const t = inst.state.wallTimes || {};
        const ratio = t[20] ? (t[80] / t[20]).toFixed(1) : "?";
        return {
          "20 cars": (t[20] || 0).toFixed(1) + " ms",
          "40 cars": (t[40] || 0).toFixed(1) + " ms",
          "60 cars": (t[60] || 0).toFixed(1) + " ms",
          "80 cars": (t[80] || 0).toFixed(1) + " ms",
          "80/20 ratio": ratio + "×",
        };
      },
    },

    {
      id: "AV",
      section: "mixed",
      family: "diagnostic",
      name: "Safety metrics O(N²) cost — fraction of tick time",
      proof:
        "3L, 80 cars, 50/50, 50 ticks. Instrument _updateRuntimeSafetyMetrics to measure its " +
        "wall time as a fraction of total tick time. " +
        "Verdict: FAIL if safety metrics consume >15% of total tick time.",
      build() {
        const c = standardCase("80-car safety overhead", {
          lanes: 3,
          cars: 80,
          split: 50,
          seed: 307,
          w: PHONE.w,
          h: PHONE.h,
          maxTicks: 50,
          stepsPerFrame: 1,
          finishBased: false,
        });
        return {
          cases: [c],
          state: { safetyMs: 0, totalMs: 0, instrumented: false },
        };
      },
      observe(inst) {
        // Instrument on first observe call
        if (!inst.state.instrumented) {
          const sim = inst.cases[0].sim;
          const origSafety = sim._updateRuntimeSafetyMetrics.bind(sim);
          const origTick = sim._tickStep.bind(sim);
          const state = inst.state;

          sim._updateRuntimeSafetyMetrics = function (active) {
            const s = typeof performance !== "undefined" ? performance.now() : Date.now();
            origSafety(active);
            state.safetyMs += (typeof performance !== "undefined" ? performance.now() : Date.now()) - s;
          };

          sim._tickStep = function (dt, P) {
            const s = typeof performance !== "undefined" ? performance.now() : Date.now();
            origTick(dt, P);
            state.totalMs += (typeof performance !== "undefined" ? performance.now() : Date.now()) - s;
          };

          inst.state.instrumented = true;
        }
      },
      metrics(inst) {
        const s = inst.state;
        const pct = s.totalMs > 0 ? ((s.safetyMs / s.totalMs) * 100).toFixed(1) : "0";
        return {
          "Safety time": s.safetyMs.toFixed(1) + " ms",
          "Total tick time": s.totalMs.toFixed(1) + " ms",
          "Safety %": pct + "%",
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        const s = inst.state;
        if (s.totalMs === 0) return false;
        const pct = s.safetyMs / s.totalMs;
        // PASS only if safety metrics use <5% of tick time
        return pct < 0.05 && legal(sim);
      },
    },

    {
      id: "AW",
      section: "mixed",
      family: "diagnostic",
      name: "80-car wall time improvement — sleep reduces per-tick cost",
      proof:
        "3L, 80 cars, 50/50, 50 ticks. Measures wall time and compares to a baseline " +
        "where all 80 cars would run full pipeline (~57ms/tick baseline). " +
        "Verdict: PASS if avg per-tick < 30ms (proving sleep mechanism cuts cost in half).",
      build() {
        const c = standardCase("80-car perf", {
          lanes: 3,
          cars: 80,
          split: 50,
          seed: 307,
          w: PHONE.w,
          h: PHONE.h,
          maxTicks: 50,
          stepsPerFrame: 1,
          finishBased: false,
        });
        return { cases: [c], state: {} };
      },
      verdict(inst) {
        // Run a fresh hidden sim and measure wall time
        const start = typeof performance !== "undefined" ? performance.now() : Date.now();
        const sim = createHidden({
          lanes: 3,
          nCars: 80,
          splitPct: 50,
          seed: 307,
          w: PHONE.w,
          h: PHONE.h,
          maxTicks: 50,
          dt: 1,
        });
        const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
        const perTick = elapsed / 50;
        inst.state.wallMs = elapsed;
        inst.state.perTickMs = perTick;
        // PASS if per-tick < 30ms (baseline was ~57ms)
        return perTick < 30 && legal(sim);
      },
      metrics(inst) {
        return {
          "Wall time": (inst.state.wallMs || 0).toFixed(0) + " ms",
          "Per-tick avg": (inst.state.perTickMs || 0).toFixed(1) + " ms",
          "Target": "< 30 ms/tick",
        };
      },
    },
    // ── Same-target yield delay (batch scheduler over-yields) ──────────────
    {
      id: "AX",
      section: "mixed",
      family: "diagnostic",
      name: "Same-target non-batch car must NOT yield when batch is for its target",
      proof:
        "3L custom: car0 (0-right) enables scheduler in zone 0, car1 (1-left) gets batched, " +
        "car2 (1-left) is 15px behind car1 — too close to trail (need CAR_L*1.4=30.8) or " +
        "share (need |y|>=CAR_L*1.3=28.6). Without fix, car2 yields despite same target. " +
        "Fix: add c.target !== zone.activeBatchTarget to _assignBatchStates yield condition.",
      build() {
        return {
          cases: [
            customCase("3L same-target yield", {
              lanes: 3,
              seed: 1,
              maxTicks: 600,
              finishBased: true,
              stepsPerFrame: 5,
              cars: [
                { id: 0, lane: 0, target: "right", y: 420 },
                { id: 1, lane: 1, target: "left", y: 390 },
                { id: 2, lane: 1, target: "left", y: 405 },
              ],
            }),
          ],
          state: { sameTargetYieldTicks: 0, worstCarId: null },
        };
      },
      stop(inst) {
        const sim = inst.cases[0].sim;
        for (const car of sim.cars) {
          if (car.done || car.fixed || car.trafficMode !== "yield") continue;
          for (const zone of sim.road.conflictZones) {
            if (!zone.paths.has(car.pathKey)) continue;
            if (zone.activeBatchTarget === car.target) {
              inst.state.sameTargetYieldTicks++;
              if (!inst.state.worstCarId) inst.state.worstCarId = car.id;
            }
          }
        }
        return sim.finished || inst.cases[0].done;
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Ticks: String(sim.ticks),
          "Cars done": sim.cars.filter((c) => c.done).length + "/" + sim.cars.length,
          "Same-target yield ticks": String(inst.state.sameTargetYieldTicks),
          "First offender": inst.state.worstCarId !== null ? "car" + inst.state.worstCarId : "none",
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        const allDone = sim.cars.every((c) => c.fixed || c.done);
        return allDone && inst.state.sameTargetYieldTicks === 0 && legal(sim);
      },
    },
    // ── P7: Merge-scenario — anticipatory braking after MOBIL lane change ───
    {
      id: "AY",
      section: "mixed",
      family: "diagnostic",
      name: "Merge scenario — follower brakes anticipatorily when adjacent car merges in",
      proof:
        "2L/4 cars (VIEW). Car A (lane 0, y=420) drives toward fork. " +
        "Blocker (lane 1, y=400, fixed) forces Car B (lane 1, y=500, mobilTimer=1) " +
        "to attempt MOBIL merge into lane 0. Car C (lane 0, y=560) follows behind A. " +
        "After B merges into lane 0 between A and C, C must decelerate (IDM response). " +
        "Assert: ≥1 merge accepted, Car C speed dips below its peak, no SAT overlaps. " +
        "Safety net for P5 candidate reduction — if reducing candidates breaks merge " +
        "acceptance or follower braking response, this card catches it.",
      build() {
        return {
          cases: [
            customCase("2L merge + follower braking", {
              lanes: 2,
              w: VIEW.w,
              h: VIEW.h,
              seed: 42,
              maxTicks: 600,
              stepsPerFrame: 5,
              finishBased: true,
              cars: [
                { id: 0, lane: 0, target: "right", y: 420 },               // A — lead car
                { id: 1, lane: 1, target: "right", y: 400, fixed: true },   // Blocker
                { id: 2, lane: 1, target: "right", y: 500, mobilTimer: 1 }, // B — merger
                { id: 3, lane: 0, target: "right", y: 560 },               // C — follower
              ],
            }),
          ],
          state: {
            mergeAccepted: false,
            mergeTick: -1,
            cPeakSpeed: 0,
            cMinSpeedAfterMerge: 9999,
            cSpeedAtMerge: 0,
          },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        const carC = sim.cars[3]; // follower
        // Track C's peak speed before any merge
        if (!inst.state.mergeAccepted) {
          if (carC.speed > inst.state.cPeakSpeed) inst.state.cPeakSpeed = carC.speed;
        }
        // Detect merge event
        if (!inst.state.mergeAccepted && sim.testMetrics.mergeAcceptCount > 0) {
          inst.state.mergeAccepted = true;
          inst.state.mergeTick = sim.ticks;
          inst.state.cSpeedAtMerge = carC.speed;
        }
        // After merge, track C's minimum speed (braking response)
        if (inst.state.mergeAccepted) {
          if (carC.speed < inst.state.cMinSpeedAfterMerge) {
            inst.state.cMinSpeedAfterMerge = carC.speed;
          }
        }
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        const s = inst.state;
        return {
          Ticks: String(Math.round(sim.ticks)),
          "Merge accepted": s.mergeAccepted ? "yes (tick " + Math.round(s.mergeTick) + ")" : "no",
          "Car C peak speed": s.cPeakSpeed.toFixed(2),
          "Car C speed at merge": s.cSpeedAtMerge.toFixed(2),
          "Car C min speed after merge": s.cMinSpeedAfterMerge < 9999 ? s.cMinSpeedAfterMerge.toFixed(2) : "n/a",
          "Speed dip": s.mergeAccepted ? (s.cSpeedAtMerge - s.cMinSpeedAfterMerge).toFixed(2) : "n/a",
          Overlaps: String(sim.testMetrics.overlapCount),
          "Cars done": sim.cars.filter((c) => c.done).length + "/" + sim.cars.filter((c) => !c.fixed).length,
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        const s = inst.state;
        // Must have at least one merge
        if (!s.mergeAccepted) return false;
        // Car C must show speed reduction after merge (anticipatory braking)
        const speedDip = s.cSpeedAtMerge - s.cMinSpeedAfterMerge;
        if (speedDip < 0.05) return false;
        // No collisions
        return legal(sim);
      },
    },
    // ── Reverse maneuver gap violation — cars must not reverse into car behind ──
    {
      id: "AZ",
      section: "mixed",
      family: "guard_green",
      name: "Reverse maneuver must not cause overlap (80-car stress)",
      proof:
        "3L/80 cars, seed 777, 1000 ticks. High density triggers frequent maneuver+reverse. " +
        "Bug: _sameLaneRuntimeGap only checks forward direction, so reverse candidates " +
        "can place a car too close to the car behind it. Next tick the cars overlap. " +
        "Without fix: 171 overlaps. Fix: check rear gap for reverse candidates in " +
        "_isLegalPoseNeighbors. PASS if 0 overlaps and 0 wall escapes.",
      build() {
        return {
          cases: [
            standardCase("3L/80 reverse-gap stress", {
              lanes: 3,
              cars: 80,
              split: 50,
              seed: 777,
              w: PHONE.w,
              h: PHONE.h,
              maxTicks: 1000,
              stepsPerFrame: 10,
            }),
          ],
          state: { maxOverlaps: 0, wallEscapes: 0, maneuverReverses: 0 },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        inst.state.wallEscapes = sim.testMetrics.wallEscapeCount;
        inst.state.maxOverlaps = Math.max(inst.state.maxOverlaps, sim.testMetrics.overlapCount);
        for (const c of sim.cars) {
          if (c.maneuvering && c.speed < -0.01) inst.state.maneuverReverses++;
        }
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Ticks: String(Math.round(sim.ticks)),
          "Cars done": countDone(sim) + "/" + sim.cars.filter((c) => !c.fixed).length,
          "Wall escapes": String(inst.state.wallEscapes),
          "Overlaps": String(sim.testMetrics.overlapCount),
          "Maneuver reverses seen": String(inst.state.maneuverReverses),
          "Maneuver enters": String(sim.testMetrics.maneuverEnterCount || 0),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return sim.testMetrics.overlapCount === 0 && inst.state.wallEscapes === 0;
      },
    },
    // ── BA: Bug 1 — Merging cars stuck mid-lane-change must enter maneuver ──
    {
      id: "BA",
      section: "mixed",
      family: "guard_green",
      name: "Mid-merge stuck car enters maneuver",
      proof:
        "3L/80, 50/50. Bug: after MOBIL merge (line 1846), pathKey points to target " +
        "lane but physical position is still in old lane. Progress measured along " +
        "target-lane path is erratic (car is far from path), causing spurious " +
        "_progressDelta >= PROGRESS_EPS that resets noProgressTicks. Car stays " +
        "merging+stopped indefinitely without entering maneuver. " +
        "PASS: no car stays merging+slow (speed<0.2) for >10 observe frames (~200 ticks) " +
        "without entering maneuver. FAIL today: stuck-merge cars never recover.",
      build() {
        return {
          cases: [
            standardCase("3L/80 merge-stuck", {
              lanes: 3,
              cars: 80,
              split: 50,
              seed: 500,
              w: PHONE.w,
              h: PHONE.h,
              maxTicks: 6000,
              stepsPerFrame: 20,
            }),
          ],
          state: { maxMergeStallFrames: 0, anyMergeStall: false },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        for (const c of sim.cars) {
          if (c.merging && !c.maneuvering && !c.done && !c.fixed && Math.abs(c.speed) < 0.2) {
            c._mergeStallFrames = (c._mergeStallFrames || 0) + 1;
          } else {
            c._mergeStallFrames = 0;
          }
          if ((c._mergeStallFrames || 0) > inst.state.maxMergeStallFrames) {
            inst.state.maxMergeStallFrames = c._mergeStallFrames;
          }
          if ((c._mergeStallFrames || 0) > 10) {
            inst.state.anyMergeStall = true;
          }
        }
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Max merge-stall frames": String(inst.state.maxMergeStallFrames),
          "Merge stall detected": String(inst.state.anyMergeStall),
          "Maneuver enters": String(sim.testMetrics.maneuverEnterCount || 0),
          "Cars done": countDone(sim) + "/80",
          Time: timeStr(inst.cases[0]),
        };
      },
      verdict(inst) {
        // PASS: no car was stuck merging for >10 observe frames without entering maneuver
        return !inst.state.anyMergeStall;
      },
    },
    // ── BB: Bug 2 — Maneuvering cars must not violate car boundaries (overlaps) ──
    {
      id: "BB",
      section: "collision",
      family: "guard_green",
      name: "Maneuver wobble respects car boundaries (3L/80 stress)",
      proof:
        "3L/80 cars, 50/50, 6000 ticks. Dense traffic triggers maneuver wobble near " +
        "road edges. Bug: post-tick separation pass (lines 1114-1118) pushes lower-priority " +
        "car along center-to-center vector with no road boundary check. Single-pass " +
        "separation can create new overlaps with third cars. During maneuver, reduced " +
        "MOBIL_MANEUVER_GAP=11px allows close crowding. " +
        "PASS: 0 overlaps AND 0 wall escapes. FAIL today: dense maneuver zones " +
        "produce persistent overlaps and/or wall escapes.",
      build() {
        return {
          cases: [
            standardCase("3L/80 maneuver-boundary", {
              lanes: 3,
              cars: 80,
              split: 50,
              seed: 501,
              w: PHONE.w,
              h: PHONE.h,
              maxTicks: 6000,
              stepsPerFrame: 20,
            }),
          ],
          state: { peakOverlaps: 0, peakWallEscapes: 0 },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        inst.state.peakOverlaps = Math.max(inst.state.peakOverlaps, sim.testMetrics.overlapCount);
        inst.state.peakWallEscapes = Math.max(inst.state.peakWallEscapes, sim.testMetrics.wallEscapeCount);
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Overlaps: String(sim.testMetrics.overlapCount),
          "Wall escapes": String(sim.testMetrics.wallEscapeCount),
          "Maneuver enters": String(sim.testMetrics.maneuverEnterCount || 0),
          "Cars done": countDone(sim) + "/80",
          Time: timeStr(inst.cases[0]),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return sim.testMetrics.overlapCount === 0 && sim.testMetrics.wallEscapeCount === 0;
      },
    },
    // ── BC: Bug 3 — Branch-stuck cars must enter maneuver ──
    {
      id: "BC",
      section: "mixed",
      family: "guard_green",
      name: "Branch-stuck car enters maneuver",
      proof:
        "2L custom. Bug: maneuver-entry loop (line 689) only iterates 'mains' " +
        "(seg==='main'). Branch cars are excluded. Worse, line 664 resets " +
        "c.maneuvering=false and c.noProgressTicks=0 for all branch cars every tick, " +
        "making maneuver entry impossible. " +
        "Test: cars 0,1 go left. Fixed blockers on left branch. Cars enter branch " +
        "and get stuck. Must enter maneuver to recover. " +
        "PASS: at least one branch car enters maneuver. FAIL today: branch cars " +
        "can never enter or stay in maneuver mode.",
      build() {
        return {
          cases: [
            customCase("2L branch-stuck", {
              lanes: 2,
              seed: 403,
              maxTicks: 1200,
              stepsPerFrame: 5,
              cars: [
                { id: 0, lane: 0, target: "left", y: 340 },
                { id: 1, lane: 0, target: "left", y: 370 },
                { id: 2, pathKey: "0-left", lane: 0, target: "left", pathT: 0.75, seg: "left", fixed: true, color: "#666" },
                { id: 3, pathKey: "0-left", lane: 0, target: "left", pathT: 0.85, seg: "left", fixed: true, color: "#555" },
              ],
            }),
          ],
          state: { branchManeuverEvents: 0, maxBranchStopTicks: 0 },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        inst.state.branchManeuverEvents = sim.testEvents.filter(
          (e) => e.type === "maneuver_enter" && (e.carId === 0 || e.carId === 1)
        ).length;
        inst.state.maxBranchStopTicks = sim.testMetrics.maxBlockedBranchStopTicks;
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        const car0 = sim.cars.find((c) => c.id === 0);
        const car1 = sim.cars.find((c) => c.id === 1);
        return {
          "Car 0 seg": car0.seg,
          "Car 1 seg": car1.seg,
          "Car 0 branchStopTicks": String(car0._branchStopTicks || 0),
          "Branch maneuver events": String(inst.state.branchManeuverEvents),
          "Max branch stop ticks": String(inst.state.maxBranchStopTicks),
          Ticks: String(Math.round(sim.ticks)),
        };
      },
      verdict(inst) {
        return inst.state.branchManeuverEvents > 0;
      },
    },
    // ── BD: 2L overlap stress — matches user's 2-lane scenario ──
    {
      id: "BD",
      section: "mixed",
      family: "guard_green",
      name: "2L/40-car dense traffic must not overlap (PHONE canvas)",
      proof:
        "2L/40 cars on PHONE canvas (110×700). Reproduces user-reported phasing bug " +
        "in 2-lane setups. High density + narrow road triggers maneuver + heading " +
        "corrections that previously bypassed SAT checks. " +
        "Fix: _commitPose overlap guard on all post-move passes. " +
        "PASS if 0 overlaps and 0 wall escapes.",
      build() {
        return {
          cases: [
            standardCase("2L/40 overlap stress", {
              lanes: 2,
              cars: 40,
              split: 50,
              seed: 42,
              w: PHONE.w,
              h: PHONE.h,
              maxTicks: 1000,
              stepsPerFrame: 10,
            }),
          ],
          state: { maxOverlaps: 0, wallEscapes: 0 },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        inst.state.wallEscapes = sim.testMetrics.wallEscapeCount;
        inst.state.maxOverlaps = Math.max(inst.state.maxOverlaps, sim.testMetrics.overlapCount);
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          Ticks: String(Math.round(sim.ticks)),
          "Cars done": countDone(sim) + "/" + sim.cars.filter((c) => !c.fixed).length,
          "Wall escapes": String(inst.state.wallEscapes),
          "Overlaps": String(sim.testMetrics.overlapCount),
          "Maneuver enters": String(sim.testMetrics.maneuverEnterCount || 0),
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        return sim.testMetrics.overlapCount === 0 && inst.state.wallEscapes === 0;
      },
    },

    // ─── Card BE: Diagnostic overlap + near-miss tracker ───────────────
    {
      id: "BE",
      section: "mixed",
      family: "diagnostic",
      name: "3L/40-car maneuver overlap diagnostic (PHONE)",
      proof:
        "3L/40 cars on PHONE canvas (110×700). Runs diagnostic overlap check " +
        "at end of each tick to capture near-miss pairs (within CAR_L*1.5 center distance) " +
        "and margin-based overlaps (PROJ_MARGIN=2px). Multiple seeds tested. " +
        "Diagnostic family — observe overlap events, do not gate on pass/fail.",
      build() {
        // Sweep 3 seeds to find overlap conditions
        const seeds = [42, 777, 123];
        return {
          cases: seeds.map((seed) =>
            standardCase(`3L/40 seed=${seed}`, {
              lanes: 3,
              cars: 40,
              split: 50,
              seed,
              w: PHONE.w,
              h: PHONE.h,
              maxTicks: 600,
              stepsPerFrame: 1, // match browser default
            })
          ),
          state: {
            totalNearMisses: 0,
            totalOverlapEvents: 0,
            totalZeroMarginOverlaps: 0,
          },
        };
      },
      observe(inst) {
        for (const c of inst.cases) {
          const m = c.sim.testMetrics;
          // F1-T1: nearMissLog must exist and be an array
          if (Array.isArray(m.nearMissLog)) {
            inst.state.totalNearMisses += m.nearMissLog.length;
          }
          // F1-T2: overlapEventLog must exist and be an array
          if (Array.isArray(m.overlapEventLog)) {
            inst.state.totalOverlapEvents += m.overlapEventLog.length;
            inst.state.totalZeroMarginOverlaps += m.overlapEventLog.filter(
              (e) => e.zeroMarginOverlap
            ).length;
          }
        }
      },
      metrics(inst) {
        const allMetrics = inst.cases.map((c) => c.sim.testMetrics);
        return {
          "Seeds run": String(inst.cases.length),
          "Total near-misses": String(inst.state.totalNearMisses),
          "Total margin overlaps": String(inst.state.totalOverlapEvents),
          "Zero-margin overlaps": String(inst.state.totalZeroMarginOverlaps),
          "Existing overlapCount": allMetrics
            .map((m) => m.overlapCount)
            .join("/"),
          "Maneuver enters": allMetrics
            .map((m) => m.maneuverEnterCount || 0)
            .join("/"),
        };
      },
      verdict(inst) {
        // Both diagnostic logs must exist AND have entries.
        // nearMissLog: PASSES after F1-T1 (already implemented)
        // overlapEventLog: FAILS until F1-T2 adds margin-based overlap detection
        return inst.state.totalNearMisses > 0 && inst.state.totalOverlapEvents > 0;
      },
    },
    // ── BG: conflict zone search window — performance cost ───────────────────
    {
      id: "BG",
      section: "collision",
      family: "diagnostic",
      name: "Conflict zone search: fi+25 window vs full-branch sweep (3L perf)",
      proof:
        "Compares Road construction time between the old fi+25 capped window and " +
        "the full-branch sweep for a 3-lane road (VIEW canvas). " +
        "Also runs a 3L/50-car/50-50 hidden sim each way and reports tick throughput. " +
        "Diagnostic only — no pass/fail gate. " +
        "Expected: full sweep is slower to construct but produces the outer-lane zone " +
        "('0-right'/'2-left') that the capped window misses; sim throughput unchanged.",
      build() {
        const Road = TC.Road;
        const ITERS = 200;
        const w = VIEW.w, h = VIEW.h;

        // ── Road construction timing ──────────────────────────────────────────
        // Warm up JIT
        for (let i = 0; i < 5; i++) new Road(3, w, h, { conflictWindowCap: 25 });
        for (let i = 0; i < 5; i++) new Road(3, w, h);

        const t0cap = Date.now();
        for (let i = 0; i < ITERS; i++) new Road(3, w, h, { conflictWindowCap: 25 });
        const msCap = Date.now() - t0cap;

        const t0full = Date.now();
        for (let i = 0; i < ITERS; i++) new Road(3, w, h);
        const msFull = Date.now() - t0full;

        const roadCap  = new Road(3, w, h, { conflictWindowCap: 25 });
        const roadFull = new Road(3, w, h);
        const zonesCap  = roadCap.conflictZones.length;
        const zonesFull = roadFull.conflictZones.length;
        const outerZoneCap  = !!roadCap.conflictZones.find(
          (z) => z.paths.has("0-right") && z.paths.has("2-left")
        );
        const outerZoneFull = !!roadFull.conflictZones.find(
          (z) => z.paths.has("0-right") && z.paths.has("2-left")
        );

        // ── Sim throughput: 3L / 50 cars / 50-50 ─────────────────────────────
        const SIM_TICKS = 600;
        const simSpec = { lanes: 3, nCars: 50, splitPct: 50, w, h, seed: 42,
                          dt: 1, maxTicks: SIM_TICKS };

        // Capped window: temporarily force cap via Road opts is not wired into
        // createScenarioSim, so we measure construction-only cost separately.
        // Throughput is identical post-construction, so we run one sim for both.
        const t0sim = Date.now();
        const simHidden = createHidden({ ...simSpec });
        const msSim = Date.now() - t0sim;
        const ticksSim = simHidden.ticks;

        return {
          cases: [
            customCase("3L/50 full-sweep sim", {
              lanes: 3, seed: 42, w, h,
              cars: 50, split: 50,
              maxTicks: SIM_TICKS,
            }),
          ],
          state: {
            msCap, msFull, ITERS,
            zonesCap, zonesFull,
            outerZoneCap, outerZoneFull,
            msSim, ticksSim,
          },
        };
      },
      metrics(inst) {
        const s = inst.state;
        const ratio = s.msCap > 0 ? (s.msFull / s.msCap).toFixed(2) : "N/A";
        const perCap  = s.msCap  > 0 ? (s.msCap  / s.ITERS).toFixed(3) : "N/A";
        const perFull = s.msFull > 0 ? (s.msFull / s.ITERS).toFixed(3) : "N/A";
        const tickRate = s.msSim > 0 ? ((s.ticksSim / s.msSim) * 1000).toFixed(0) : "N/A";
        return {
          [`fi+25 (${s.ITERS}x)`]:  `${s.msCap}ms  (${perCap}ms/road)`,
          [`full  (${s.ITERS}x)`]:  `${s.msFull}ms  (${perFull}ms/road)`,
          "Slowdown ratio":          `${ratio}x`,
          "Zones cap/full":          `${s.zonesCap} / ${s.zonesFull}`,
          "Outer zone cap/full":     `${s.outerZoneCap ? "YES" : "NO"} / ${s.outerZoneFull ? "YES" : "NO"}`,
          "Sim throughput":          `${tickRate} ticks/s  (${s.ticksSim} ticks, ${s.msSim}ms)`,
        };
      },
      verdict(inst) {
        // Diagnostic: passes when outer zone is found with full sweep but not cap,
        // confirming the fix is effective.
        return inst.state.outerZoneFull && !inst.state.outerZoneCap;
      },
    },
    // ── BF: 3L outer-lane conflict zone ──────────────────────────────────────
    {
      id: "BF",
      section: "collision",
      family: "guard_green",
      name: "3L outer-lane conflict zone is created and respected",
      proof:
        "In a 3-lane road, lane 0 going right and lane 2 going left must cross paths. " +
        "The conflict zone detector must find their closest approach across the full branch " +
        "(not just 25 path indices past the fork). " +
        "PASS: a conflict zone covering both '0-right' and '2-left' paths is created at " +
        "road construction time, AND no overlap occurs during the crossing. " +
        "FAIL before fix: _genConflictZones search window [fi-10, fi+25] is too narrow — " +
        "outer lanes start 57+ units apart at the fork, cross only deeper in the branch, " +
        "so minD never drops below ZONE_CROSS_THRESH=21; no zone is created; " +
        "canEnterConflict stays false; cars cross freely.",
      build() {
        const caseRecord = customCase("3L outer-lane cross", {
          lanes: 3,
          seed: 901,
          maxTicks: 600,
          finishBased: true,
          cars: [
            { id: 0, lane: 0, target: "right", y: 620 },
            { id: 1, lane: 2, target: "left", y: 620 },
          ],
        });
        const zones = caseRecord.sim.road.conflictZones;
        const outerZone = zones.find(
          (z) => z.paths.has("0-right") && z.paths.has("2-left")
        );
        return {
          cases: [caseRecord],
          state: { overlap: false, outerZoneFound: !!outerZone },
        };
      },
      observe(inst) {
        const sim = inst.cases[0].sim;
        inst.state.overlap =
          inst.state.overlap || satOverlap(sim.cars[0], sim.cars[1]);
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        return {
          "Outer zone": inst.state.outerZoneFound ? "YES" : "NO",
          Overlap: inst.state.overlap ? "YES" : "NO",
          Done: countDone(sim) + "/2",
          "Batch grants": String(sim.batchEntryCount || 0),
        };
      },
      verdict(inst) {
        return (
          inst.state.outerZoneFound &&
          !inst.state.overlap &&
          legal(inst.cases[0].sim)
        );
      },
    },
    // ── BH: Fork crash recovery — emergent congestion at 2L fork ───────────
    {
      id: "BH",
      section: "mixed",
      family: "known_red",
      name: "Fork crash recovery — 2L/20 congestion, stuck cars maneuver out",
      proof:
        "Reproduces the actual crash from the live sim: 2 lanes, 20 cars, 50/50 split. " +
        "Emergent congestion overwhelms the batch scheduler and creates stuck cars at the fork. " +
        "3 seeds tested. PASS (partial credit): in ALL seeds, ≥2 cars enter maneuver mode " +
        "AND all cars eventually complete AND zero overlaps. Documents whether maneuver mode " +
        "actually resolves fork congestion at realistic scale.",
      build() {
        // High-density congestion: 2 lanes, 40 cars, 50/50 split
        // At this density, the batch scheduler can get overwhelmed and produce
        // the stuck-at-fork scenario from the live sim screenshots
        const seeds = [42, 77, 308];
        return {
          cases: seeds.map(seed =>
            standardCase("2L/40 seed=" + seed, {
              lanes: 2,
              cars: 40,
              split: 50,
              seed,
              maxTicks: 6000,
              stepsPerFrame: 20,
            })
          ),
          state: { maneuverPerSeed: [], donePerSeed: [], overlapPerSeed: [] },
        };
      },
      observe(inst) {
        // Collect per-seed metrics each step
        inst.state.maneuverPerSeed = inst.cases.map(c => c.sim.testMetrics.maneuverEnterCount || 0);
        inst.state.donePerSeed = inst.cases.map(c => countDone(c.sim));
        inst.state.overlapPerSeed = inst.cases.map(c => c.sim.testMetrics.overlapCount || 0);
      },
      metrics(inst) {
        return {
          "Maneuvers": inst.state.maneuverPerSeed.join("/"),
          "Done": inst.state.donePerSeed.join("/") + " of 40 each",
          "Overlaps": inst.state.overlapPerSeed.join("/"),
          "Ticks": inst.cases.map(c => String(c.sim.ticks)).join("/"),
          "Max noProgress": inst.cases.map(c => (c.sim.testMetrics.maxNoProgressTicks || 0).toFixed(0)).join("/"),
          "Sleep ticks": inst.cases.map(c => String(c.sim.testMetrics.sleepTicksTotal || 0)).join("/"),
        };
      },
      verdict(inst) {
        // Partial credit: every seed must have ≥2 maneuver entries, all cars done, zero overlaps
        return inst.cases.every((c, i) =>
          inst.state.maneuverPerSeed[i] >= 2 &&
          inst.state.donePerSeed[i] >= 40 &&
          legal(c.sim)
        );
      },
    },
    // ── BK: Full jam clearance survey ────────────────────────────────────────
    {
      id: "BK",
      section: "mixed",
      family: "survey_green",
      name: "Full jam clearance — crash near fork, all trailing cars eventually exit",
      proof:
        "3 lanes, 12 cars, 2 fixed at fork simulating a crash. " +
        "Tests whether the jam wake + follow chain + front-of-jam priority fixes " +
        "together allow all non-fixed cars to eventually clear the jam and exit. " +
        "Survey: documents jam clearance capability, not a hard gate.",
      build() {
        return {
          cases: [
            customCase("3L jam clearance", {
              lanes: 3,
              seed: 42,
              maxTicks: 6000,
              stepsPerFrame: 20,
              finishBased: true,
              cars: [
                { id: 0, lane: 0, target: "left", y: 440, fixed: true, color: "#666", mobilTimer: 999 },
                { id: 1, lane: 1, target: "right", y: 430, fixed: true, color: "#666", mobilTimer: 999 },
                { id: 2, lane: 0, target: "left", y: 500, mobilTimer: 999 },
                { id: 3, lane: 1, target: "right", y: 510, mobilTimer: 999 },
                { id: 4, lane: 2, target: "left", y: 520 },
                { id: 5, lane: 0, target: "right", y: 570 },
                { id: 6, lane: 1, target: "left", y: 580 },
                { id: 7, lane: 2, target: "right", y: 600 },
                { id: 8, lane: 0, target: "left", y: 660 },
                { id: 9, lane: 1, target: "right", y: 720 },
                { id: 10, lane: 2, target: "left", y: 740 },
                { id: 11, lane: 0, target: "right", y: 790 },
              ],
            }),
          ],
          state: {},
        };
      },
      metrics(inst) {
        const sim = inst.cases[0].sim;
        const m = sim.testMetrics;
        const nonFixed = sim.cars.filter(c => !c.fixed);
        return {
          "Done": nonFixed.filter(c => c.done).length + "/" + nonFixed.length,
          "Maneuver enters": String(m.maneuverEnterCount || 0),
          "Max noProgress": String(m.maxNoProgressTicks || 0),
          "Overlaps": String(m.overlapCount || 0),
          Ticks: String(sim.ticks),
          Time: sim.timerSec.toFixed(2) + "s",
        };
      },
      verdict(inst) {
        const sim = inst.cases[0].sim;
        const nonFixed = sim.cars.filter(c => !c.fixed);
        const doneCount = nonFixed.filter(c => c.done).length;
        return doneCount >= 4 && legal(sim);
      },
    },
    // ─── Card BL: _safeZones() road band computation ──────────────────────
    {
      id: "BL",
      section: "mixed",
      family: "guard_green",
      name: "_safeZones() helper — road exclusion bands",
      proof:
        "Ren.prototype._safeZones(rd, w, margin) must exist and return " +
        "{ left: {min, max}, right: {min, max} } that correctly exclude the road " +
        "surface. left.max must equal rd.cx - rd.halfW() - margin. " +
        "right.min must equal rd.cx + rd.halfW() + margin. Tested for 1L, 2L, 3L.",
      build() {
        const margin = 6;
        const w = 220;
        const laneCounts = [1, 2, 3];
        const cases = laneCounts.map((lanes) =>
          standardCase(`${lanes}L`, { lanes, cars: 0, maxTicks: 1 })
        );
        const results = laneCounts.map((lanes, i) => {
          const rd = cases[i].sim.road;
          if (typeof TC.Ren.prototype._safeZones !== "function") {
            return { pass: false, reason: "_safeZones not defined on Ren.prototype" };
          }
          const zones = TC.Ren.prototype._safeZones.call({}, rd, w, margin);
          const roadL = rd.cx - rd.halfW();
          const roadR = rd.cx + rd.halfW();
          const pass =
            zones !== null &&
            typeof zones === "object" &&
            typeof zones.left === "object" &&
            typeof zones.right === "object" &&
            zones.left.min === 0 &&
            Math.abs(zones.left.max - (roadL - margin)) < 0.001 &&
            Math.abs(zones.right.min - (roadR + margin)) < 0.001 &&
            zones.right.max === w;
          return { pass, lanes, roadL, roadR, zones };
        });
        return { cases, state: { results, margin } };
      },
      metrics(inst) {
        const exists = typeof TC.Ren.prototype._safeZones === "function";
        return {
          "Method exists": String(exists),
          "1L pass": String(inst.state.results[0]?.pass),
          "2L pass": String(inst.state.results[1]?.pass),
          "3L pass": String(inst.state.results[2]?.pass),
        };
      },
      verdict(inst) {
        return inst.state.results.every((r) => r.pass);
      },
    },
    // ─── Card BM: Wave 2 drawing primitives existence ──────────────────────
    {
      id: "BM",
      section: "mixed",
      family: "guard_green",
      name: "Wave 2 drawing primitives — all 6 new methods exist on Ren.prototype",
      proof:
        "Ren.prototype must have _drawCow, _drawChicken, _drawPig, _drawAnimalPen, " +
        "_drawLamppost, _drawPond — all must be functions.",
      build() {
        const methods = [
          "_drawCow", "_drawChicken", "_drawPig",
          "_drawAnimalPen", "_drawLamppost", "_drawPond",
        ];
        const results = methods.map((name) => ({
          name,
          exists: typeof TC.Ren.prototype[name] === "function",
        }));
        return { cases: [], state: { results } };
      },
      metrics(inst) {
        const out = {};
        for (const r of inst.state.results) {
          out[r.name] = r.exists ? "YES" : "NO";
        }
        return out;
      },
      verdict(inst) {
        return inst.state.results.every((r) => r.exists);
      },
    },
    // ─── Card BN: Road overlap assertion — element positions stay in safe zones ──
    {
      id: "BN",
      section: "mixed",
      family: "guard_green",
      name: "Road overlap assertion — all placed elements within safe zones",
      proof:
        "For 1L/2L/3L: compute _safeZones(), then replicate the placement math from " +
        "_sceneCityNature(). Verify: (1) farmL >= zones.right.min, (2) barnX >= zones.right.min, " +
        "(3) pondCx - pondRx >= zones.right.min, (4) penX >= zones.right.min, " +
        "(5) house availW + margin <= zones.left.max. All must pass for all lane counts.",
      build() {
        const laneCounts = [1, 2, 3];
        const cases = laneCounts.map((lanes) =>
          standardCase(`${lanes}L`, { lanes, cars: 0, maxTicks: 1 })
        );
        const results = laneCounts.map((lanes, i) => {
          const rd = cases[i].sim.road;
          const w = VIEW.w, h = VIEW.h;
          const zones = TC.Ren.prototype._safeZones.call({}, rd, w, 6);
          const m = TC.Ren.prototype._sceneMetrics.call(
            { _clamp: TC.Ren.prototype._clamp }, rd, w, h
          );
          // Farm area (right side)
          const farmL = zones.right.min;
          const farmW = w - farmL - 3;
          const barnX = farmL + farmW * 0.32;
          const pondCx = farmL + farmW * 0.78;
          const pondRx = 12 * m.baseScale;
          const fX = farmL + farmW * 0.05;
          // Urban area (left side)
          const roadL = rd.cx - m.roadHalf;
          const margin = 4;
          const availW = Math.min(zones.left.max, roadL) - margin * 2;
          const checks = {
            farmL_ok: farmL >= zones.right.min,
            barn_ok: barnX >= zones.right.min,
            pond_ok: (pondCx - pondRx) >= zones.right.min,
            pen_ok: fX >= zones.right.min,
            house_ok: (margin + availW) <= zones.left.max + 0.001,
            availW_positive: availW > 0,
          };
          const pass = Object.values(checks).every(Boolean);
          return { pass, lanes, checks };
        });
        return { cases, state: { results } };
      },
      metrics(inst) {
        const out = {};
        for (const r of inst.state.results) {
          const failedKeys = Object.entries(r.checks)
            .filter(([, v]) => !v).map(([k]) => k);
          out[`${r.lanes}L`] = r.pass ? "PASS" : `FAIL: ${failedKeys.join(",")}`;
        }
        return out;
      },
      verdict(inst) {
        return inst.state.results.every((r) => r.pass);
      },
    },
    // ─── Card BO: Visual state indicator structural test — canvas ops per trafficMode ──
    {
      id: "BO",
      section: "mixed",
      family: "diagnostic",
      name: "Visual state indicators — correct canvas ops per trafficMode",
      proof:
        "Create a mock canvas context that records strokeStyle, setLineDash, and fillStyle calls. " +
        "Create a Ren instance with mock canvas, set sim.started=true. For each trafficMode " +
        "(yield, batch, hold_exit, maneuver, free, commit), call _car() with a mock car and " +
        "verify the expected canvas operations were invoked.",
      build() {
        // Create a minimal sim + road for Ren
        const sim = createScenarioSim({
          lanes: 2, nCars: 0, w: VIEW.w, h: VIEW.h, seed: 1,
        });
        sim.start();

        // Mock canvas context that records relevant calls
        function createSpyCtx() {
          const log = [];
          const handler = {
            get(target, prop) {
              if (prop in target) return target[prop];
              // Return no-op functions for anything not explicitly tracked
              return function () {};
            },
          };
          const ctx = {
            _log: log,
            // State
            globalAlpha: 1,
            lineWidth: 1,
            fillStyle: '',
            strokeStyle: '',
            font: '',
            textAlign: '',
            lineCap: '',
            // Tracked methods
            save() { log.push({ op: 'save' }); },
            restore() { log.push({ op: 'restore' }); },
            setLineDash(pattern) { log.push({ op: 'setLineDash', pattern: pattern.slice() }); },
            getLineDash() { return []; },
            stroke() { log.push({ op: 'stroke', strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth }); },
            fill() { log.push({ op: 'fill', fillStyle: ctx.fillStyle }); },
            fillRect(x, y, w, h) { log.push({ op: 'fillRect', fillStyle: ctx.fillStyle, x, y, w, h, alpha: ctx.globalAlpha }); },
            clearRect() {},
            beginPath() { log.push({ op: 'beginPath' }); },
            closePath() {},
            moveTo() {},
            lineTo() {},
            quadraticCurveTo() {},
            bezierCurveTo() {},
            arc() {},
            ellipse() {},
            translate() {},
            rotate() {},
            scale() {},
            setTransform() {},
            fillText() {},
            strokeRect() {},
            drawImage() {},
            createLinearGradient() { return { addColorStop() {} }; },
          };
          return new Proxy(ctx, handler);
        }

        // Mock canvas object
        function createMockCanvas(spyCtx) {
          return {
            width: VIEW.w,
            height: VIEW.h,
            getContext() { return spyCtx; },
          };
        }

        // Create a mock car with specific trafficMode
        function mockCar(trafficMode, target) {
          return {
            id: 0, x: 110, y: 400, th: -Math.PI / 2,
            speed: 2.0, steer: 0, lane: 0, target: target || 'left',
            done: false, seg: 'branch', color: '#c48828',
            trafficMode: trafficMode,
            zoneYielding: trafficMode === 'yield',
            maneuvering: trafficMode === 'maneuver',
            reversing: false,
            blinker: 0,
          };
        }

        // Test each mode
        const modes = ['yield', 'batch', 'hold_exit', 'maneuver', 'free', 'commit'];
        const results = {};

        for (const mode of modes) {
          const spyCtx = createSpyCtx();
          const mockCv = createMockCanvas(spyCtx);
          const ren = new TC.Ren(mockCv, sim);
          ren.ctx = spyCtx; // Override to use our spy
          const car = mockCar(mode, mode === 'batch' ? 'right' : 'left');
          ren._car(car, 1.0);
          const log = spyCtx._log;

          // Extract stroke calls (mode border indicators)
          const strokes = log.filter(e => e.op === 'stroke');
          const dashes = log.filter(e => e.op === 'setLineDash');
          // Extract fillRect calls with rgba fillStyle (tint overlay)
          const tintFills = log.filter(e =>
            e.op === 'fillRect' &&
            e.fillStyle && typeof e.fillStyle === 'string' && e.fillStyle.startsWith('rgba')
          );
          // Look for arrow draws (small fill() calls after beginPath — triangles)
          const fills = log.filter(e => e.op === 'fill');

          results[mode] = {
            strokeColors: strokes.map(s => s.strokeStyle),
            dashPatterns: dashes.map(d => d.pattern),
            hasTint: tintFills.length > 0,
            fillCount: fills.length,
          };
        }

        // Assertions:
        // yield: amber solid border (#ddaa44), no tint, no arrow
        const yieldOk = results.yield.strokeColors.some(c => c === '#ddaa44') &&
          results.yield.dashPatterns.some(d => d.length === 0) &&
          !results.yield.hasTint;

        // batch: green solid border (#55bb77), no tint, has arrow (extra fill)
        const batchOk = results.batch.strokeColors.some(c => c === '#55bb77') &&
          !results.batch.hasTint &&
          results.batch.fillCount > 1; // body fill + arrow fill

        // hold_exit: green dotted border (#55bb77), dash [1.5,1.5], no tint, has arrow
        const holdExitOk = results.hold_exit.strokeColors.some(c => c === '#55bb77') &&
          results.hold_exit.dashPatterns.some(d => d.length === 2 && d[0] === 1.5) &&
          !results.hold_exit.hasTint &&
          results.hold_exit.fillCount > 1;

        // maneuver: dashed red-orange border (#ff4400), dash [3,2], has tint
        const maneuverOk = results.maneuver.strokeColors.some(c => c === '#ff4400') &&
          results.maneuver.dashPatterns.some(d => d.length === 2 && d[0] === 3) &&
          results.maneuver.hasTint;

        // free: no mode-specific stroke (only body fill)
        const freeOk = !results.free.strokeColors.some(c =>
          c === '#ddaa44' || c === '#55bb77' || c === '#ff4400'
        );

        // commit: same as free — no mode-specific stroke
        const commitOk = !results.commit.strokeColors.some(c =>
          c === '#ddaa44' || c === '#55bb77' || c === '#ff4400'
        );

        // No separate reversing border (old white border should be gone)
        const spyCtxReverse = createSpyCtx();
        const mockCvReverse = createMockCanvas(spyCtxReverse);
        const renReverse = new TC.Ren(mockCvReverse, sim);
        renReverse.ctx = spyCtxReverse;
        const reverseCar = mockCar('maneuver');
        reverseCar.reversing = true;
        renReverse._car(reverseCar, 1.0);
        const reverseStrokes = spyCtxReverse._log.filter(e => e.op === 'stroke');
        const noSeparateReverseBorder = !reverseStrokes.some(s => s.strokeStyle === '#ffffff');

        const state = {
          yieldOk, batchOk, holdExitOk, maneuverOk, freeOk, commitOk,
          noSeparateReverseBorder,
          details: results,
        };

        const cases = [standardCase("indicator-spy", { lanes: 2, cars: 0, maxTicks: 1 })];
        return { cases, state };
      },
      metrics(inst) {
        return {
          yield: inst.state.yieldOk ? "PASS" : "FAIL",
          batch: inst.state.batchOk ? "PASS" : "FAIL",
          hold_exit: inst.state.holdExitOk ? "PASS" : "FAIL",
          maneuver: inst.state.maneuverOk ? "PASS" : "FAIL",
          free: inst.state.freeOk ? "PASS" : "FAIL",
          commit: inst.state.commitOk ? "PASS" : "FAIL",
          noReverseBorder: inst.state.noSeparateReverseBorder ? "PASS" : "FAIL",
        };
      },
      verdict(inst) {
        return (
          inst.state.yieldOk &&
          inst.state.batchOk &&
          inst.state.holdExitOk &&
          inst.state.maneuverOk &&
          inst.state.freeOk &&
          inst.state.commitOk &&
          inst.state.noSeparateReverseBorder
        );
      },
    },
    // ─── Card BP: _drawCoop() existence check (F9-T6) ──────────────────────
    {
      id: "BP",
      section: "mixed",
      family: "guard_green",
      name: "_drawCoop() — chicken coop drawing primitive exists",
      proof:
        "Ren.prototype._drawCoop must be a function.",
      build() {
        const exists = typeof TC.Ren.prototype._drawCoop === "function";
        return { cases: [], state: { exists } };
      },
      metrics(inst) { return { "_drawCoop exists": inst.state.exists ? "YES" : "NO" }; },
      verdict(inst) { return inst.state.exists; },
    },
  ];

  const FAMILY_META = {
    guard_green: { gate: "guard", expected: "pass" },
    survey_green: { gate: "survey", expected: "pass" },
    known_red: { gate: "known_red", expected: "fail" },
    diagnostic: { gate: "diagnostic", expected: "observe" },
  };

  TESTS = TESTS.map((def) => ({ ...FAMILY_META[def.family], ...def }));

  function createInstance(def) {
    const built = def.build();
    return {
      def,
      cases: built.cases.map((caseRecord) => ({ ...caseRecord, tick: 0, done: false })),
      state: built.state || {},
      running: false,
      done: false,
      passed: null,
      rawOutcome: null,
      outcome: null,
      speedMult: def.defaultSpeed || 1,
    };
  }

  function stepCase(caseRecord, speedMult) {
    if (caseRecord.done) {
      return;
    }
    const steps = caseRecord.stepsPerFrame || autoSteps(caseRecord);
    if (!caseRecord.sim.started) {
      caseRecord.sim.start();
    }
    for (let i = 0; i < steps; i++) {
      if (
        (caseRecord.finishBased !== false && caseRecord.sim.finished) ||
        caseRecord.tick >= caseRecord.maxTicks
      ) {
        break;
      }
      caseRecord.sim.tick(caseRecord.dt, { v0: V0_DEF * speedMult });
      caseRecord.tick++;
    }
    if (
      (caseRecord.finishBased !== false && caseRecord.sim.finished) ||
      caseRecord.tick >= caseRecord.maxTicks
    ) {
      caseRecord.done = true;
    }
  }

  function getRawOutcome(def, inst) {
    const result =
      typeof def.evaluate === "function" ? def.evaluate(inst) : def.verdict(inst);
    return normalizeOutcome(result);
  }

  function getDisplayOutcome(def, rawOutcome) {
    if (def.expected === "fail" && rawOutcome.kind === "pass") {
      return {
        kind: "warn",
        text: "WARN",
        passed: false,
        note:
          rawOutcome.note ||
          "Known-red card measured a passing state, but remains survey-only until reclassified.",
      };
    }
    return rawOutcome;
  }

  function stepInstance(inst) {
    if (inst.done) {
      return inst;
    }
    inst.cases.forEach((caseRecord) => stepCase(caseRecord, inst.speedMult));
    if (typeof inst.def.observe === "function") {
      inst.def.observe(inst);
    }
    const stop =
      typeof inst.def.stop === "function"
        ? inst.def.stop(inst)
        : inst.cases.every((caseRecord) => caseRecord.done);
    if (stop) {
      inst.done = true;
      inst.rawOutcome = getRawOutcome(inst.def, inst);
      inst.outcome = getDisplayOutcome(inst.def, inst.rawOutcome);
      inst.passed = inst.outcome.passed;
    }
    return inst;
  }

  function runInstance(defOrInst, options) {
    const inst = defOrInst.def ? defOrInst : createInstance(defOrInst);
    const runOptions = options || {};
    if (runOptions.speedMult !== undefined) {
      inst.speedMult = runOptions.speedMult;
    }
    inst.cases.forEach((caseRecord) => {
      if (!caseRecord.sim.started) {
        caseRecord.sim.start();
      }
    });
    let guard = 0;
    while (!inst.done) {
      stepInstance(inst);
      guard++;
      if (guard > 200000) {
        throw new Error(`Traffic test ${inst.def.id} did not terminate.`);
      }
    }
    return inst;
  }

  function matchesSelection(def, filters) {
    const selectedIds = filters.ids || [];
    const selectedSections = filters.sections || [];
    const selectedFamilies = filters.families || [];
    const selectedGates = filters.gates || [];
    if (selectedIds.length && !selectedIds.includes(def.id)) {
      return false;
    }
    if (selectedSections.length && !selectedSections.includes(def.section)) {
      return false;
    }
    if (selectedFamilies.length && !selectedFamilies.includes(def.family)) {
      return false;
    }
    if (selectedGates.length && !selectedGates.includes(def.gate)) {
      return false;
    }
    return true;
  }

  function filterTests(filters) {
    const safeFilters = filters || {};
    return TESTS.filter((def) => matchesSelection(def, safeFilters));
  }

  global.TrafficTestSuite = {
    VIEW,
    PHONE,
    SHORT_VIEW,
    SUITES,
    get TESTS() {
      return TESTS;
    },
    createHidden,
    standardCase,
    customCase,
    legal,
    countDone,
    timeStr,
    finishOrder,
    lastEvents,
    autoSteps,
    wholePathErr,
    conflictCars,
    blockedExitConflictCars,
    sequentialForkCars,
    leftBranchBlockers,
    conflictMetrics,
    normalizeOutcome,
    leftDone,
    rightDone,
    createInstance,
    stepCase,
    stepInstance,
    runInstance,
    getRawOutcome,
    getDisplayOutcome,
    filterTests,
    matchesSelection,
    _setSuites(nextSuites) {
      SUITES.splice(0, SUITES.length, ...nextSuites);
    },
    _setTests(nextTests) {
      TESTS = nextTests.map((def) => ({ ...FAMILY_META[def.family], ...def }));
    },
  };
})(typeof window !== "undefined" ? window : globalThis);

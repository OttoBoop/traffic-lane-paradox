#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function parseArgs(argv) {
  const out = {
    lanes: 3,
    cars: 40,
    split: 50,
    seed: 307,
    ticks: 400,
    dt: 1,
    width: 110,
    height: 700,
    topCars: 20,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) continue;
    if (!(key in out)) continue;
    out[key] = Number(next);
    i++;
  }
  return out;
}

function loadTrafficCore(root) {
  const sandbox = { console, Math };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.devicePixelRatio = 1;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "traffic_core.js"), "utf8"), sandbox, {
    filename: path.join(root, "traffic_core.js"),
  });
  return sandbox.TrafficCore;
}

function snapshotCars(sim) {
  const rd = sim.road;
  return sim.cars
    .filter((car) => !car.fixed && !car.done)
    .map((car) => ({
      pathKey: car.pathKey,
      id: car.id,
      seg: car.seg,
      lane: car.lane,
      target: car.target,
      x: Number(car.x.toFixed(2)),
      y: Number(car.y.toFixed(2)),
      speed: Number(car.speed.toFixed(2)),
      plannerMode: car.plannerMode,
      trafficMode: car.trafficMode,
      maneuvering: !!car.maneuvering,
      maneuverTimer: Number((car.maneuverTimer || 0).toFixed(0)),
      blockingKind: car.blockingKind,
      blockerId: car.primaryBlockerId,
      noProgressTicks: Number((car.noProgressTicks || 0).toFixed(0)),
      progressResumeTicks: Number((car.progressResumeTicks || 0).toFixed(0)),
      gap: car._gap == null ? null : Number(car._gap.toFixed(2)),
      merging: !!car.merging,
      commitUntilFork: !!car.commitUntilFork,
      roadClearance: Number(rd.roadClearance(car.x, car.y).toFixed(2)),
      boundary: (() => {
        const boundarySeg = rd.nearestBoundary(car.x, car.y, car.seg === "main" ? "main" : car.seg);
        return boundarySeg.seg
          ? {
              dist: Number(boundarySeg.dist.toFixed(2)),
              role: boundarySeg.seg.role,
              seg: boundarySeg.seg.seg,
              t0: Number((boundarySeg.seg.t0 || 0).toFixed(3)),
              t1: Number((boundarySeg.seg.t1 || 0).toFixed(3)),
            }
          : null;
      })(),
    }));
}

function sortCars(cars) {
  return [...cars].sort((a, b) => {
    const aTraffic = a.plannerMode === "traffic" ? 1 : 0;
    const bTraffic = b.plannerMode === "traffic" ? 1 : 0;
    if (aTraffic !== bTraffic) return bTraffic - aTraffic;
    if (a.maneuvering !== b.maneuvering) return Number(b.maneuvering) - Number(a.maneuvering);
    if (a.noProgressTicks !== b.noProgressTicks) return b.noProgressTicks - a.noProgressTicks;
    return a.id - b.id;
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = __dirname;
  const TC = loadTrafficCore(root);
  const sim = TC.createScenarioSim({
    lanes: opts.lanes,
    nCars: opts.cars,
    splitPct: opts.split,
    seed: opts.seed,
    w: opts.width,
    h: opts.height,
  });
  sim.start();

  let slowest = null;
  for (let tick = 0; tick < opts.ticks && !sim.finished; tick++) {
    const start = process.hrtime.bigint();
    sim.tick(opts.dt, { v0: TC.V0_DEF });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const cars = snapshotCars(sim);
    if (!slowest || elapsedMs > slowest.elapsedMs) {
      slowest = {
        tick: sim.ticks,
        elapsedMs,
        maneuversEntered: sim.testMetrics.maneuverEnterCount,
        maxNoProgressTicks: sim.testMetrics.maxNoProgressTicks,
        cars,
      };
    }
  }

  if (!slowest) {
    console.log("No ticks captured.");
    return;
  }

  const sortedCars = sortCars(slowest.cars).slice(0, opts.topCars);
  const trafficCars = slowest.cars.filter((car) => car.plannerMode === "traffic");
  const interestingTypes = new Set([
    "maneuver_enter",
    "maneuver_exit",
    "yield_enter",
    "hold_exit_enter",
    "batch_grant",
    "merge_accept",
    "merge_reject_unsafe",
  ]);
  const recentEvents = sim.testEvents.filter(
    (event) => interestingTypes.has(event.type) && Math.abs(event.tick - slowest.tick) <= 40
  );
  const recentCounts = {
    maneuverProgress: recentEvents.filter((event) => event.type === "maneuver_enter" && event.reason === "progress").length,
    maneuverCascade: recentEvents.filter((event) => event.type === "maneuver_enter" && event.reason === "cascade").length,
    maneuverExit: recentEvents.filter((event) => event.type === "maneuver_exit").length,
    mergeRejectUnsafe: recentEvents.filter((event) => event.type === "merge_reject_unsafe").length,
    mergeAccept: recentEvents.filter((event) => event.type === "merge_accept").length,
    holdExit: recentEvents.filter((event) => event.type === "hold_exit_enter").length,
    yieldEnter: recentEvents.filter((event) => event.type === "yield_enter").length,
  };

  console.log(
    `Slowest tick ${slowest.tick} | ${slowest.elapsedMs.toFixed(3)} ms | ` +
      `active=${slowest.cars.length} traffic=${trafficCars.length} maneuvers=${slowest.maneuversEntered} ` +
      `maxNoProgress=${slowest.maxNoProgressTicks.toFixed(0)}`
  );
  console.log("Top cars:");
  for (const car of sortedCars) {
    console.log(
      `- car=${car.id} planner=${car.plannerMode} traffic=${car.trafficMode} maneuver=${car.maneuvering ? "yes" : "no"} ` +
        `timer=${car.maneuverTimer} block=${car.blockingKind} blocker=${car.blockerId ?? "-"} ` +
        `merge=${car.merging ? "yes" : "no"} commit=${car.commitUntilFork ? "yes" : "no"} ` +
        `gap=${car.gap == null ? "-" : car.gap.toFixed(2)} noProg=${car.noProgressTicks} clearance=${car.roadClearance.toFixed(2)} ` +
        `boundary=${car.boundary ? `${car.boundary.seg}/${car.boundary.role}@${car.boundary.dist.toFixed(2)}` : "-"} ` +
        `path=${car.pathKey} pos=(${car.x.toFixed(2)},${car.y.toFixed(2)})`
    );
  }

  if (recentEvents.length) {
    console.log(
      `Recent event counts: progress=${recentCounts.maneuverProgress} cascade=${recentCounts.maneuverCascade} ` +
        `exit=${recentCounts.maneuverExit} mergeReject=${recentCounts.mergeRejectUnsafe} mergeAccept=${recentCounts.mergeAccept} ` +
        `hold=${recentCounts.holdExit} yield=${recentCounts.yieldEnter}`
    );
    console.log("Recent events near slowest tick:");
    for (const event of recentEvents) {
      const details = Object.entries(event)
        .filter(([key]) => key !== "tick" && key !== "type")
        .map(([key, value]) => `${key}=${value}`)
        .join(" ");
      console.log(`- tick=${event.tick} type=${event.type}${details ? ` ${details}` : ""}`);
    }
  }
}

main();
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
    repeat: 1,
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

function makeStatBucket() {
  return { calls: 0, ns: 0, totalCandidates: 0 };
}

function instrumentPlanner(TC) {
  const proto = TC.Sim.prototype;
  const stats = {
    candidateSet: makeStatBucket(),
    chooseBest: makeStatBucket(),
    hasForward: makeStatBucket(),
    legalPose: makeStatBucket(),
    legalPoseNeighbors: makeStatBucket(),
  };
  const originals = {
    _candidateSet: proto._candidateSet,
    _chooseBestLegalCandidate: proto._chooseBestLegalCandidate,
    _hasLegalForwardProgressMove: proto._hasLegalForwardProgressMove,
    _isLegalPose: proto._isLegalPose,
    _isLegalPoseNeighbors: proto._isLegalPoseNeighbors,
  };

  if (originals._candidateSet) {
    proto._candidateSet = function (...args) {
      const start = process.hrtime.bigint();
      const result = originals._candidateSet.apply(this, args);
      const elapsed = process.hrtime.bigint() - start;
      stats.candidateSet.calls++;
      stats.candidateSet.ns += Number(elapsed);
      stats.candidateSet.totalCandidates += result.length;
      return result;
    };
  }

  if (originals._chooseBestLegalCandidate) {
    proto._chooseBestLegalCandidate = function (...args) {
      const start = process.hrtime.bigint();
      const result = originals._chooseBestLegalCandidate.apply(this, args);
      const elapsed = process.hrtime.bigint() - start;
      stats.chooseBest.calls++;
      stats.chooseBest.ns += Number(elapsed);
      return result;
    };
  }

  if (originals._hasLegalForwardProgressMove) {
    proto._hasLegalForwardProgressMove = function (...args) {
      const start = process.hrtime.bigint();
      const result = originals._hasLegalForwardProgressMove.apply(this, args);
      const elapsed = process.hrtime.bigint() - start;
      stats.hasForward.calls++;
      stats.hasForward.ns += Number(elapsed);
      return result;
    };
  }

  if (originals._isLegalPose) {
    proto._isLegalPose = function (...args) {
      const start = process.hrtime.bigint();
      const result = originals._isLegalPose.apply(this, args);
      const elapsed = process.hrtime.bigint() - start;
      stats.legalPose.calls++;
      stats.legalPose.ns += Number(elapsed);
      return result;
    };
  }

  if (originals._isLegalPoseNeighbors) {
    proto._isLegalPoseNeighbors = function (...args) {
      const start = process.hrtime.bigint();
      const result = originals._isLegalPoseNeighbors.apply(this, args);
      const elapsed = process.hrtime.bigint() - start;
      stats.legalPoseNeighbors.calls++;
      stats.legalPoseNeighbors.ns += Number(elapsed);
      return result;
    };
  }

  return {
    stats,
    restore() {
      Object.entries(originals).forEach(([key, fn]) => {
        if (fn) proto[key] = fn;
      });
    },
  };
}

function nsToMs(ns) {
  return ns / 1e6;
}

function createModeStats() {
  return {
    peakTrafficPlanner: 0,
    peakTrafficPlannerFreeMode: 0,
    peakTrafficPlannerManeuver: 0,
    peakTrafficPlannerYield: 0,
    peakTrafficPlannerBatch: 0,
    peakTrafficPlannerHoldExit: 0,
    peakTrafficPlannerMerging: 0,
    peakTrafficPlannerConflict: 0,
    peakTrafficPlannerWall: 0,
    peakTrafficPlannerFollow: 0,
    peakTrafficPlannerParallel: 0,
  };
}

function summarizeTrafficPlannerModes(cars) {
  const summary = {
    trafficPlanner: 0,
    trafficPlannerFreeMode: 0,
    trafficPlannerManeuver: 0,
    trafficPlannerYield: 0,
    trafficPlannerBatch: 0,
    trafficPlannerHoldExit: 0,
    trafficPlannerMerging: 0,
    trafficPlannerConflict: 0,
    trafficPlannerWall: 0,
    trafficPlannerFollow: 0,
    trafficPlannerParallel: 0,
  };
  for (const car of cars) {
    if (car.fixed || car.done || car.plannerMode !== "traffic") continue;
    summary.trafficPlanner++;
    if (car.trafficMode === "free") summary.trafficPlannerFreeMode++;
    if (car.maneuvering) summary.trafficPlannerManeuver++;
    if (car.trafficMode === "yield") summary.trafficPlannerYield++;
    if (car.trafficMode === "batch") summary.trafficPlannerBatch++;
    if (car.trafficMode === "hold_exit") summary.trafficPlannerHoldExit++;
    if (car.merging) summary.trafficPlannerMerging++;
    if (car.blockingKind === "conflict") summary.trafficPlannerConflict++;
    if (car.blockingKind === "wall") summary.trafficPlannerWall++;
    if (car.blockingKind === "follow") summary.trafficPlannerFollow++;
    if (car.blockingKind === "parallel") summary.trafficPlannerParallel++;
  }
  return summary;
}

function formatBucket(bucket, extra = "") {
  const avgMs = bucket.calls ? nsToMs(bucket.ns) / bucket.calls : 0;
  const totalMs = nsToMs(bucket.ns);
  return `${bucket.calls} calls | ${totalMs.toFixed(2)} ms total | ${avgMs.toFixed(4)} ms avg${extra}`;
}

function runScenario(TC, opts) {
  const sim = TC.createScenarioSim({
    lanes: opts.lanes,
    nCars: opts.cars,
    splitPct: opts.split,
    seed: opts.seed,
    w: opts.width,
    h: opts.height,
  });
  sim.start();
  const modeStats = createModeStats();
  const start = process.hrtime.bigint();
  for (let tick = 0; tick < opts.ticks && !sim.finished; tick++) {
    sim.tick(opts.dt, { v0: TC.V0_DEF });
    const modeSummary = summarizeTrafficPlannerModes(sim.cars);
    for (const [key, value] of Object.entries(modeSummary)) {
      const peakKey = `peak${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      modeStats[peakKey] = Math.max(modeStats[peakKey] || 0, value);
    }
  }
  const elapsedMs = nsToMs(Number(process.hrtime.bigint() - start));
  return {
    sim,
    elapsedMs,
    fastPathHits: sim.fastPathHits || 0,
    fastPathMisses: sim.fastPathMisses || 0,
    nominalFastPathHits: sim.nominalFastPathHits || 0,
    trafficFastPathHits: sim.trafficFastPathHits || 0,
    modeStats,
  };
}

function printRunSummary(label, result, stats) {
  const avgCandidates = stats.candidateSet.calls
    ? stats.candidateSet.totalCandidates / stats.candidateSet.calls
    : 0;
  const totalFastPath = result.fastPathHits + result.fastPathMisses;
  const fastPathRate = totalFastPath ? (result.fastPathHits / totalFastPath) * 100 : 0;
  console.log(`\n[${label}] ${result.elapsedMs.toFixed(2)} ms wall-clock`);
  console.log(
    `Sim: ticks=${result.sim.ticks.toFixed(0)} finished=${result.sim.finished ? "yes" : "no"} ` +
      `maneuvers=${result.sim.testMetrics.maneuverEnterCount} maxNoProgress=${result.sim.testMetrics.maxNoProgressTicks.toFixed(1)}`
  );
  console.log(
    `Fast path: hits=${result.fastPathHits} misses=${result.fastPathMisses} ` +
      `hitRate=${fastPathRate.toFixed(1)}% nominalHits=${result.nominalFastPathHits} trafficHits=${result.trafficFastPathHits}`
  );
  console.log(
    `Traffic planner peaks: total=${result.modeStats.peakTrafficPlanner} free=${result.modeStats.peakTrafficPlannerFreeMode} ` +
      `maneuver=${result.modeStats.peakTrafficPlannerManeuver} yield=${result.modeStats.peakTrafficPlannerYield} ` +
      `batch=${result.modeStats.peakTrafficPlannerBatch} hold=${result.modeStats.peakTrafficPlannerHoldExit} merge=${result.modeStats.peakTrafficPlannerMerging}`
  );
  console.log(
    `Traffic blocker peaks: conflict=${result.modeStats.peakTrafficPlannerConflict} wall=${result.modeStats.peakTrafficPlannerWall} ` +
      `follow=${result.modeStats.peakTrafficPlannerFollow} parallel=${result.modeStats.peakTrafficPlannerParallel}`
  );
  console.log(`_candidateSet: ${formatBucket(stats.candidateSet, ` | ${avgCandidates.toFixed(2)} avg candidates`)}`);
  console.log(`_chooseBestLegalCandidate: ${formatBucket(stats.chooseBest)}`);
  console.log(`_hasLegalForwardProgressMove: ${formatBucket(stats.hasForward)}`);
  console.log(`_isLegalPose: ${formatBucket(stats.legalPose)}`);
  console.log(`_isLegalPoseNeighbors: ${formatBucket(stats.legalPoseNeighbors)}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = __dirname;
  const TC = loadTrafficCore(root);

  console.log(
    `Profiling planner hotspots: ${opts.lanes}L/${opts.cars} cars split=${opts.split}% seed=${opts.seed} ticks=${opts.ticks} dt=${opts.dt} ` +
      `size=${opts.width}x${opts.height} repeat=${opts.repeat}`
  );

  let totalWallMs = 0;
  for (let run = 1; run <= opts.repeat; run++) {
    const instrumented = instrumentPlanner(TC);
    const result = runScenario(TC, opts);
    totalWallMs += result.elapsedMs;
    printRunSummary(`run ${run}`, result, instrumented.stats);
    instrumented.restore();
  }

  if (opts.repeat > 1) {
    console.log(`\nAverage wall-clock per run: ${(totalWallMs / opts.repeat).toFixed(2)} ms`);
  }
}

main();
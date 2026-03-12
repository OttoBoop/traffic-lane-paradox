#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function parseArgs(argv) {
  const out = {
    ticks: 300,
    dt: 1,
    width: 110,
    height: 700,
    repeat: 1,
    seeds: "307,309,311",
    preset: "default",
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) continue;
    if (!(key in out)) continue;
    if (["ticks", "dt", "width", "height", "repeat"].includes(key)) out[key] = Number(next);
    else out[key] = next;
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

function splitCsv(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));
}

function presets() {
  return {
    tiny: [
      { name: "1L-4cars", lanes: 1, cars: 4, split: 50 },
      { name: "2L-6cars", lanes: 2, cars: 6, split: 50 },
    ],
    default: [
      { name: "1L-10cars", lanes: 1, cars: 10, split: 50 },
      { name: "2L-20cars", lanes: 2, cars: 20, split: 50 },
      { name: "3L-20cars", lanes: 3, cars: 20, split: 50 },
      { name: "3L-40cars", lanes: 3, cars: 40, split: 50 },
    ],
    stress: [
      { name: "2L-30cars", lanes: 2, cars: 30, split: 50 },
      { name: "3L-40cars", lanes: 3, cars: 40, split: 50 },
      { name: "4L-40cars", lanes: 4, cars: 40, split: 50 },
      { name: "5L-40cars", lanes: 5, cars: 40, split: 50 },
    ],
    paradox: [
      { name: "1L-10cars-5050", lanes: 1, cars: 10, split: 50 },
      { name: "2L-10cars-5050", lanes: 2, cars: 10, split: 50 },
      { name: "3L-10cars-5050", lanes: 3, cars: 10, split: 50 },
    ],
  };
}

function nsToMs(ns) {
  return ns / 1e6;
}

function makeBucket() {
  return { calls: 0, ns: 0, totalCandidates: 0 };
}

function instrument(TC) {
  const proto = TC.Sim.prototype;
  const stats = {
    chooseBest: makeBucket(),
    candidateSet: makeBucket(),
    hasForward: makeBucket(),
    legalPose: makeBucket(),
    legalPoseNeighbors: makeBucket(),
  };
  const originals = {
    _chooseBestLegalCandidate: proto._chooseBestLegalCandidate,
    _candidateSet: proto._candidateSet,
    _hasLegalForwardProgressMove: proto._hasLegalForwardProgressMove,
    _isLegalPose: proto._isLegalPose,
    _isLegalPoseNeighbors: proto._isLegalPoseNeighbors,
  };

  const wrap = (key, after) => {
    const original = originals[key];
    if (!original) return;
    proto[key] = function (...args) {
      const start = process.hrtime.bigint();
      const result = original.apply(this, args);
      const elapsed = process.hrtime.bigint() - start;
      after(result, Number(elapsed));
      return result;
    };
  };

  wrap("_chooseBestLegalCandidate", (_result, ns) => {
    stats.chooseBest.calls++;
    stats.chooseBest.ns += ns;
  });
  wrap("_candidateSet", (result, ns) => {
    stats.candidateSet.calls++;
    stats.candidateSet.ns += ns;
    stats.candidateSet.totalCandidates += result.length;
  });
  wrap("_hasLegalForwardProgressMove", (_result, ns) => {
    stats.hasForward.calls++;
    stats.hasForward.ns += ns;
  });
  wrap("_isLegalPose", (_result, ns) => {
    stats.legalPose.calls++;
    stats.legalPose.ns += ns;
  });
  wrap("_isLegalPoseNeighbors", (_result, ns) => {
    stats.legalPoseNeighbors.calls++;
    stats.legalPoseNeighbors.ns += ns;
  });

  return {
    stats,
    restore() {
      Object.entries(originals).forEach(([key, fn]) => {
        if (fn) proto[key] = fn;
      });
    },
  };
}

function summarizeBucket(bucket) {
  return {
    calls: bucket.calls,
    totalMs: Number(nsToMs(bucket.ns).toFixed(2)),
    avgMs: Number((bucket.calls ? nsToMs(bucket.ns) / bucket.calls : 0).toFixed(4)),
  };
}

function runScenario(TC, scenario, options, seed) {
  const sim = TC.createScenarioSim({
    lanes: scenario.lanes,
    nCars: scenario.cars,
    splitPct: scenario.split,
    seed,
    w: options.width,
    h: options.height,
  });
  sim.start();

  let peakManeuvering = 0;
  let peakYielding = 0;
  let peakBatch = 0;
  const startedAt = process.hrtime.bigint();
  for (let tick = 0; tick < options.ticks && !sim.finished; tick++) {
    sim.tick(options.dt, { v0: TC.V0_DEF });
    let maneuvering = 0;
    let yielding = 0;
    let batching = 0;
    for (const car of sim.cars) {
      if (car.done || car.fixed) continue;
      if (car.maneuvering) maneuvering++;
      if (car.trafficMode === "yield") yielding++;
      if (car.trafficMode === "batch") batching++;
    }
    if (maneuvering > peakManeuvering) peakManeuvering = maneuvering;
    if (yielding > peakYielding) peakYielding = yielding;
    if (batching > peakBatch) peakBatch = batching;
  }

  return {
    elapsedMs: Number(nsToMs(Number(process.hrtime.bigint() - startedAt)).toFixed(2)),
    ticks: sim.ticks,
    finished: sim.finished,
    timerSec: Number(sim.timerSec.toFixed(2)),
    peakManeuvering,
    peakYielding,
    peakBatch,
    maneuvers: sim.testMetrics.maneuverEnterCount,
    yields: sim.testMetrics.yieldEnterCount,
    maxNoProgress: Number(sim.testMetrics.maxNoProgressTicks.toFixed(1)),
    overlapCount: sim.testMetrics.overlapCount,
    wallEscapeCount: sim.testMetrics.wallEscapeCount,
  };
}

function aggregateRuns(runs, scenarioName) {
  const avg = (key) => runs.reduce((sum, run) => sum + run[key], 0) / runs.length;
  const max = (key) => runs.reduce((best, run) => Math.max(best, run[key]), -Infinity);
  const min = (key) => runs.reduce((best, run) => Math.min(best, run[key]), Infinity);
  return {
    scenario: scenarioName,
    runs: runs.length,
    avgElapsedMs: Number(avg("elapsedMs").toFixed(2)),
    bestElapsedMs: Number(min("elapsedMs").toFixed(2)),
    worstElapsedMs: Number(max("elapsedMs").toFixed(2)),
    avgPeakManeuvering: Number(avg("peakManeuvering").toFixed(2)),
    avgPeakYielding: Number(avg("peakYielding").toFixed(2)),
    avgPeakBatch: Number(avg("peakBatch").toFixed(2)),
    avgManeuvers: Number(avg("maneuvers").toFixed(2)),
    avgMaxNoProgress: Number(avg("maxNoProgress").toFixed(2)),
    anyOverlap: runs.some((run) => run.overlapCount > 0),
    anyWallEscape: runs.some((run) => run.wallEscapeCount > 0),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = __dirname;
  const TC = loadTrafficCore(root);
  const suite = presets()[options.preset] || presets().default;
  const seeds = splitCsv(options.seeds);
  const instrumented = instrument(TC);
  const scenarioResults = [];

  for (const scenario of suite) {
    const runs = [];
    for (const seed of seeds) {
      for (let repeat = 0; repeat < options.repeat; repeat++) {
        runs.push(runScenario(TC, scenario, options, seed + repeat));
      }
    }
    scenarioResults.push({
      summary: aggregateRuns(runs, scenario.name),
      runs,
    });
  }

  const plannerStats = {
    chooseBest: summarizeBucket(instrumented.stats.chooseBest),
    candidateSet: {
      ...summarizeBucket(instrumented.stats.candidateSet),
      avgCandidates: Number(
        (
          instrumented.stats.candidateSet.calls
            ? instrumented.stats.candidateSet.totalCandidates / instrumented.stats.candidateSet.calls
            : 0
        ).toFixed(2)
      ),
    },
    hasForward: summarizeBucket(instrumented.stats.hasForward),
    legalPose: summarizeBucket(instrumented.stats.legalPose),
    legalPoseNeighbors: summarizeBucket(instrumented.stats.legalPoseNeighbors),
  };
  instrumented.restore();

  if (options.json) {
    console.log(JSON.stringify({ options, plannerStats, scenarios: scenarioResults }, null, 2));
    return;
  }

  console.log(
    `Lag debug matrix | preset=${options.preset} ticks=${options.ticks} dt=${options.dt} size=${options.width}x${options.height} seeds=${seeds.join(",")}`
  );
  console.log("\nPlanner totals:");
  Object.entries(plannerStats).forEach(([name, stats]) => {
    const extra = stats.avgCandidates !== undefined ? ` | avgCandidates=${stats.avgCandidates}` : "";
    console.log(`- ${name}: calls=${stats.calls} totalMs=${stats.totalMs} avgMs=${stats.avgMs}${extra}`);
  });

  console.log("\nScenario summary:");
  scenarioResults.forEach(({ summary }) => {
    console.log(
      `- ${summary.scenario}: avg=${summary.avgElapsedMs}ms best=${summary.bestElapsedMs}ms worst=${summary.worstElapsedMs}ms ` +
        `peakM=${summary.avgPeakManeuvering} peakY=${summary.avgPeakYielding} peakB=${summary.avgPeakBatch} ` +
        `maneuvers=${summary.avgManeuvers} maxNoProgress=${summary.avgMaxNoProgress} ` +
        `overlap=${summary.anyOverlap ? "YES" : "NO"} wall=${summary.anyWallEscape ? "YES" : "NO"}`
    );
  });
}

main();
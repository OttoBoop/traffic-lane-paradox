#!/usr/bin/env node
/**
 * F3-T7: Capture baseline testMetrics before lazy lifecycle changes.
 * Runs multiple configs headlessly and saves metrics to test_baseline.json.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadBrowserBundle(files) {
  const sandbox = { console, Math };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.devicePixelRatio = 1;
  vm.createContext(sandbox);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  });
  return sandbox;
}

const root = __dirname;
const sandbox = loadBrowserBundle([path.join(root, "traffic_core.js")]);
const { Sim, V0_DEF } = sandbox.TrafficCore;

const configs = [
  { lanes: 2, nCars: 10, seed: 42, label: "2L-10C" },
  { lanes: 3, nCars: 20, seed: 42, label: "3L-20C" },
  { lanes: 3, nCars: 30, seed: 42, label: "3L-30C" },
];

const W = 220, H = 760;
const MAX_TICKS = 300000;
const P = { v0: V0_DEF };

const results = {};

for (const cfg of configs) {
  const sim = new Sim(cfg.lanes, cfg.nCars, 50, cfg.seed);
  sim.init(W, H);
  sim.start();

  let ticks = 0;
  while (!sim.finished && ticks < MAX_TICKS) {
    sim.tick(1, P);
    ticks++;
  }

  results[cfg.label] = {
    config: cfg,
    finished: sim.finished,
    timerSec: sim.timerSec,
    totalTicks: ticks,
    carsArrayLength: sim.cars.length,
    metrics: {
      finishTimes: sim.testMetrics.finishTimes,
      finishOrder: sim.testMetrics.finishOrder,
      overlapCount: sim.testMetrics.overlapCount,
      wallEscapeCount: sim.testMetrics.wallEscapeCount,
      maneuverEnterCount: sim.testMetrics.maneuverEnterCount,
      conflictEnterCount: sim.testMetrics.conflictEnterCount,
      sleepTicksTotal: sim.testMetrics.sleepTicksTotal,
      awakeTicksTotal: sim.testMetrics.awakeTicksTotal,
      maxNoProgressTicks: sim.testMetrics.maxNoProgressTicks,
      minBranchRectGap: sim.testMetrics.minBranchRectGap,
      maxLaneCenterDrift: sim.testMetrics.maxLaneCenterDrift,
      maxYawDrift: sim.testMetrics.maxYawDrift,
    },
  };

  console.log(
    `${cfg.label}: ${sim.finished ? "DONE" : "TIMEOUT"} in ${ticks} ticks (${sim.timerSec.toFixed(1)}s sim-time)`
  );
}

const outPath = path.join(root, "test_baseline.json");
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\nBaseline saved to ${outPath}`);

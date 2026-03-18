#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function parseArgs(argv) {
  const out = {
    lanes: 3,
    cars: 20,
    split: 50,
    seed: 307,
    ticks: 250,
    dt: 1,
    width: 110,
    height: 700,
    top: 12,
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
    out[key] = Number.isNaN(Number(next)) ? next : Number(next);
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

function nsToMs(ns) {
  return ns / 1e6;
}

function makeCounterMap() {
  return {
    chooseBest: 0,
    candidateSet: 0,
    hasForward: 0,
    legalPose: 0,
    legalPoseNeighbors: 0,
  };
}

function instrumentPerTick(TC) {
  const proto = TC.Sim.prototype;
  const originals = {
    _chooseBestLegalCandidate: proto._chooseBestLegalCandidate,
    _candidateSet: proto._candidateSet,
    _hasLegalForwardProgressMove: proto._hasLegalForwardProgressMove,
    _isLegalPose: proto._isLegalPose,
    _isLegalPoseNeighbors: proto._isLegalPoseNeighbors,
  };
  let currentTick = makeCounterMap();
  const counterKeyMap = {
    _chooseBestLegalCandidate: "chooseBest",
    _candidateSet: "candidateSet",
    _hasLegalForwardProgressMove: "hasForward",
    _isLegalPose: "legalPose",
    _isLegalPoseNeighbors: "legalPoseNeighbors",
  };

  const wrap = (key) => {
    const original = originals[key];
    if (!original) return;
    proto[key] = function (...args) {
      currentTick[counterKeyMap[key]]++;
      return original.apply(this, args);
    };
  };

  wrap("_chooseBestLegalCandidate");
  wrap("_candidateSet");
  wrap("_hasLegalForwardProgressMove");
  wrap("_isLegalPose");
  wrap("_isLegalPoseNeighbors");

  return {
    snapshotAndReset() {
      const snap = currentTick;
      currentTick = makeCounterMap();
      return snap;
    },
    restore() {
      Object.entries(originals).forEach(([key, fn]) => {
        if (fn) proto[key] = fn;
      });
    },
  };
}

function summarizeModes(cars) {
  let maneuvering = 0;
  let yielding = 0;
  let batching = 0;
  let holdExit = 0;
  let trafficPlanner = 0;
  let nominalPlanner = 0;
  let trafficPlannerFreeMode = 0;
  let trafficPlannerManeuver = 0;
  let trafficPlannerYield = 0;
  let trafficPlannerBatch = 0;
  let trafficPlannerHoldExit = 0;
  let trafficPlannerMerging = 0;
  let trafficPlannerConflict = 0;
  let trafficPlannerWall = 0;
  let trafficPlannerFollow = 0;
  let trafficPlannerParallel = 0;
  let blockingFollow = 0;
  let blockingConflict = 0;
  let blockingWall = 0;
  let blockingParallel = 0;
  let merging = 0;
  for (const car of cars) {
    if (car.fixed || car.done) continue;
    if (car.maneuvering) maneuvering++;
    if (car.trafficMode === "yield") yielding++;
    if (car.trafficMode === "batch") batching++;
    if (car.trafficMode === "hold_exit") holdExit++;
    if (car.plannerMode === "traffic") {
      trafficPlanner++;
      if (car.trafficMode === "free") trafficPlannerFreeMode++;
      if (car.maneuvering) trafficPlannerManeuver++;
      if (car.trafficMode === "yield") trafficPlannerYield++;
      if (car.trafficMode === "batch") trafficPlannerBatch++;
      if (car.trafficMode === "hold_exit") trafficPlannerHoldExit++;
      if (car.merging) trafficPlannerMerging++;
      if (car.blockingKind === "conflict") trafficPlannerConflict++;
      if (car.blockingKind === "wall") trafficPlannerWall++;
      if (car.blockingKind === "follow") trafficPlannerFollow++;
      if (car.blockingKind === "parallel") trafficPlannerParallel++;
    } else {
      nominalPlanner++;
    }
    if (car.blockingKind === "follow") blockingFollow++;
    if (car.blockingKind === "conflict") blockingConflict++;
    if (car.blockingKind === "wall") blockingWall++;
    if (car.blockingKind === "parallel") blockingParallel++;
    if (car.merging) merging++;
  }
  return {
    maneuvering,
    yielding,
    batching,
    holdExit,
    trafficPlanner,
    nominalPlanner,
    trafficPlannerFreeMode,
    trafficPlannerManeuver,
    trafficPlannerYield,
    trafficPlannerBatch,
    trafficPlannerHoldExit,
    trafficPlannerMerging,
    trafficPlannerConflict,
    trafficPlannerWall,
    trafficPlannerFollow,
    trafficPlannerParallel,
    blockingFollow,
    blockingConflict,
    blockingWall,
    blockingParallel,
    merging,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = __dirname;
  const TC = loadTrafficCore(root);
  const sim = TC.createScenarioSim({
    lanes: options.lanes,
    nCars: options.cars,
    splitPct: options.split,
    seed: options.seed,
    w: options.width,
    h: options.height,
  });
  sim.start();

  const instrumented = instrumentPerTick(TC);
  const rows = [];

  for (let tick = 0; tick < options.ticks && !sim.finished; tick++) {
    const start = process.hrtime.bigint();
    sim.tick(options.dt, { v0: TC.V0_DEF });
    const elapsedMs = Number(nsToMs(Number(process.hrtime.bigint() - start)).toFixed(3));
    const methodCalls = instrumented.snapshotAndReset();
    const modeCounts = summarizeModes(sim.cars);
    rows.push({
      tick: sim.ticks,
      elapsedMs,
      activeCars: sim.cars.filter((car) => !car.fixed && !car.done).length,
      maneuversEntered: sim.testMetrics.maneuverEnterCount,
      maxNoProgress: Number(sim.testMetrics.maxNoProgressTicks.toFixed(1)),
      ...modeCounts,
      ...methodCalls,
    });
  }

  instrumented.restore();
  rows.sort((a, b) => b.elapsedMs - a.elapsedMs);
  const topRows = rows.slice(0, options.top);

  if (options.json) {
    console.log(JSON.stringify({ options, topRows, totalRows: rows.length }, null, 2));
    return;
  }

  console.log(
    `Lag spike trace | ${options.lanes}L/${options.cars} cars split=${options.split}% seed=${options.seed} ticks=${options.ticks} dt=${options.dt}`
  );
  console.log("Top slow ticks:");
  topRows.forEach((row) => {
    console.log(
      `- tick=${row.tick} ${row.elapsedMs}ms active=${row.activeCars} traffic=${row.trafficPlanner} freeTraffic=${row.trafficPlannerFreeMode} ` +
        `man=${row.maneuvering} y=${row.yielding} b=${row.batching} hold=${row.holdExit} ` +
        `trafficReasons[m=${row.trafficPlannerManeuver} y=${row.trafficPlannerYield} b=${row.trafficPlannerBatch} hold=${row.trafficPlannerHoldExit} merge=${row.trafficPlannerMerging} conflict=${row.trafficPlannerConflict} wall=${row.trafficPlannerWall} follow=${row.trafficPlannerFollow} parallel=${row.trafficPlannerParallel}] ` +
        `follow=${row.blockingFollow} conflict=${row.blockingConflict} wall=${row.blockingWall} parallel=${row.blockingParallel} merge=${row.merging} ` +
        `choose=${row.chooseBest} cand=${row.candidateSet} forward=${row.hasForward} ` +
        `legal=${row.legalPose} legalN=${row.legalPoseNeighbors} maxNoProgress=${row.maxNoProgress}`
    );
  });
}

main();
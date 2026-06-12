#!/usr/bin/env node
// Unified traffic-event timeline. Runs a scenario with the flight recorder on
// (sim.debugTrace) and prints testEvents + traceEvents merged, sorted by tick,
// with filters. Read-only diagnostic — the sim is untouched beyond the trace
// flag, which only enables logging.
//
// Usage:
//   node trace_traffic_events.js --lanes 3 --cars 12 --split 50 --seed 307 --ticks 2000
//   node trace_traffic_events.js --lanes 2 --cars 10 --seed 302 --ticks 6000 \
//     --type premature_yield,yield_exit [--car 3,7] [--from 100] [--to 900] \
//     [--trace-cap 200000] [--json]
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a.startsWith("--")) { out[a.slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

function loadCore() {
  const sandbox = { console, Math, Date };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.devicePixelRatio = 1;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "traffic_core.js"), "utf8"), sandbox, { filename: "traffic_core.js" });
  return sandbox.TrafficCore;
}

const args = parseArgs(process.argv.slice(2));
const lanes = Number(args.lanes ?? 3);
const cars = Number(args.cars ?? 12);
const split = Number(args.split ?? 50);
const seed = Number(args.seed ?? 307);
const ticks = Number(args.ticks ?? 2000);
const fromTick = Number(args.from ?? 0);
const toTick = Number(args.to ?? Infinity);
const carFilter = args.car ? new Set(args.car.split(",").map(Number)) : null;
const typeFilter = args.type ? new Set(args.type.split(",")) : null;

const TC = loadCore();
const sim = TC.createScenarioSim({ lanes, nCars: cars, splitPct: split, w: 220, h: 760, seed, dt: 1 });
sim.debugTrace = true;
if (args["trace-cap"]) sim.traceCap = Number(args["trace-cap"]);
sim.start();
for (let t = 0; t < ticks && !sim.finished; t++) sim.tick(1, { v0: TC.V0_DEF });

const merged = [...sim.testEvents, ...sim.traceEvents].sort((a, b) => a.tick - b.tick);
const rows = merged.filter((e) => {
  if (e.tick < fromTick || e.tick > toTick) return false;
  if (typeFilter && !typeFilter.has(e.type)) return false;
  if (carFilter) {
    const ids = [e.carId, e.aId, e.bId].filter((v) => v !== undefined);
    if (ids.length && !ids.some((id) => carFilter.has(id))) return false;
  }
  return true;
});

function fmt(e) {
  const t = `[t${String(Math.round(e.tick)).padStart(5, "0")}]`;
  if (e.type === "mode_change") {
    return `${t} mode_change car=${e.carId} ${e.prev}→${e.next} reason=${e.reason}` +
      (e.dp !== null && e.dp !== undefined ? ` dp=${e.dp}` : "") +
      (e.batchId !== null && e.batchId !== undefined ? ` batch=${e.batchId}` : "") +
      (e.npt ? ` npt=${e.npt}` : "") +
      (e.blockerId !== null && e.blockerId !== undefined ? ` blocker=${e.blockerId}` : "");
  }
  const rest = Object.entries(e)
    .filter(([k]) => k !== "tick" && k !== "type")
    .map(([k, v]) => `${k}=${typeof v === "number" ? +v.toFixed?.(2) || v : v}`)
    .join(" ");
  return `${t} ${e.type} ${rest}`;
}

if (args.json) {
  console.log(JSON.stringify({ config: { lanes, cars, split, seed, ticks }, events: rows, summary: summarize() }, null, 1));
} else {
  for (const e of rows) console.log(fmt(e));
  const s = summarize();
  console.log("─".repeat(72));
  console.log(`sim: ticks=${Math.round(sim.ticks)} finished=${sim.finished} timer=${sim.timerSec.toFixed(2)}s | events shown=${rows.length}/${merged.length} traceDropped=${sim.traceDroppedCount}`);
  console.log(`detectors: prematureYield=${s.prematureYieldCount} batchManHybrid=${s.batchManeuverTickCount} reverseInZone=${s.batchManeuverReverseInZoneCount} aggrSteer=${s.zoneAggressiveSteerCount} grantedNearMiss=${s.grantedNearMissCount}`);
  console.log(`yield: enters=${s.yieldEnterCount} exits=${s.yieldExitCount} maxDur=${Math.round(s.maxYieldDurationTicks)} maxIdle=${Math.round(s.maxYieldIdleTicks)} | overlaps=${s.overlapCount} wallEscapes=${s.wallEscapeCount} maneuvers=${s.maneuverEnterCount}`);
}

function summarize() {
  const m = sim.testMetrics;
  return {
    prematureYieldCount: m.prematureYieldCount,
    batchManeuverTickCount: m.batchManeuverTickCount,
    batchManeuverReverseInZoneCount: m.batchManeuverReverseInZoneCount,
    zoneAggressiveSteerCount: m.zoneAggressiveSteerCount,
    grantedNearMissCount: m.grantedNearMissCount,
    yieldEnterCount: m.yieldEnterCount,
    yieldExitCount: m.yieldExitCount,
    maxYieldDurationTicks: m.maxYieldDurationTicks,
    maxYieldIdleTicks: m.maxYieldIdleTicks,
    overlapCount: m.overlapCount,
    wallEscapeCount: m.wallEscapeCount,
    maneuverEnterCount: m.maneuverEnterCount,
  };
}

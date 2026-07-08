#!/usr/bin/env node
// Snapshot → repro generator. Runs a scenario to --tick and prints a ready-to-
// paste customCase block (the card-BI pattern) with the full state of the cars
// at that moment, so a wild bug becomes a deterministic suite scenario.
//
// Usage:
//   node extract_repro.js --lanes 3 --cars 10 --split 50 --seed 303 --tick 845 \
//     [--focus-car 7 --radius 150] [--label "premature yield repro"]
//
// NOTE: batch grant state is NOT snapshotted — it lives on the zone and the
// scheduler rebuilds it within ~1 tick of resuming, which is usually enough.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { out[a.slice(2)] = argv[i + 1]; i++; }
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
const tick = Number(args.tick ?? 600);
const focusCar = args["focus-car"] !== undefined ? Number(args["focus-car"]) : null;
const radius = Number(args.radius ?? 150);
const label = args.label || `repro ${lanes}L/${cars} seed ${seed} @t${tick}`;

const TC = loadCore();
const sim = TC.createScenarioSim({ lanes, nCars: cars, splitPct: split, w: 220, h: 760, seed, dt: 1 });
sim.start();
for (let t = 0; t < tick && !sim.finished; t++) sim.tick(1, { v0: TC.V0_DEF });

let live = sim.cars.filter((c) => !c.done);
if (focusCar !== null) {
  const f = live.find((c) => c.id === focusCar);
  if (!f) {
    console.error(`focus car ${focusCar} not found among ${live.length} live cars`);
    process.exit(1);
  }
  live = live.filter((c) => Math.hypot(c.x - f.x, c.y - f.y) <= radius);
}

const num = (v, d = 3) => +v.toFixed(d);
const lines = live.map((c) => {
  const fields = [
    `id: ${c.id}`,
    `x: ${num(c.x)}`, `y: ${num(c.y)}`, `th: ${num(c.th)}`,
    `lane: ${c.lane}`, `target: "${c.target}"`,
    `pathKey: "${c.pathKey}"`, `seg: "${c.seg}"`,
    `speed: ${num(c.speed)}`, `steer: ${num(c.steer)}`,
    `trafficMode: "${c.trafficMode}"`,
    `zoneYielding: ${!!c.zoneYielding}`,
    `merging: ${!!c.merging}`,
    `maneuvering: ${!!c.maneuvering}`,
    `commitUntilFork: ${!!c.commitUntilFork}`,
    `mobilTimer: ${Math.round(c.mobilTimer)}`,
    `noProgressTicks: ${num(c.noProgressTicks, 1)}`,
    `progressResumeTicks: ${num(c.progressResumeTicks, 1)}`,
  ];
  if (c.maneuvering) {
    fields.push(`maneuverTimer: ${num(c.maneuverTimer, 1)}`);
    fields.push(`maneuverPerpDir: { x: ${num(c.maneuverPerpDir.x)}, y: ${num(c.maneuverPerpDir.y)} }`);
  }
  return `        { ${fields.join(", ")} },`;
});

console.log(`// Extracted by extract_repro.js — ${lanes}L/${cars} split=${split} seed=${seed} tick=${tick}` +
  (focusCar !== null ? ` focus=${focusCar} r=${radius}` : ""));
console.log(`      customCase("${label}", {`);
console.log(`        lanes: ${lanes},`);
console.log(`        seed: 1,`);
console.log(`        maxTicks: 600,`);
console.log(`        stepsPerFrame: 5,`);
console.log(`        cars: [`);
for (const l of lines) console.log(l);
console.log(`        ],`);
console.log(`      })`);
console.log(`// NOT reproducible: batchId/zone grant state (lives on the zone; the`);
console.log(`// scheduler rebuilds it within ~1 tick). ${live.length} cars captured.`);

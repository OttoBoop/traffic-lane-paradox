#!/usr/bin/env node
// Paradox parameter sweep — searches fork-scheduler constants for a configuration
// where card Q goes green (1L strictly fastest at 50/50) without touching the
// same-target baselines (H/I must stay byte-identical — schedulerEnabled never
// fires for one-sided demand, so any drift there flags a leak).
//
// Usage:
//   node sweep_paradox_params.js                 # stage 1 grid
//   node sweep_paradox_params.js --hold 48 --batch 1 --exit 44   # single config
//   node sweep_paradox_params.js --seeds         # rerun finalists on alt seeds
//
// Reads traffic_core.js as TEXT, regex-replaces the const declarations per config,
// loads core+suite in a vm sandbox (same pattern as run_traffic_suite.js), then
// runs cards Q, R, H, I via TrafficTestSuite.runInstance. Stdout only.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const CORE_SRC = fs.readFileSync(path.join(root, "traffic_core.js"), "utf8");
const SUITE_SRC = fs.readFileSync(path.join(root, "traffic_test_suite.js"), "utf8");

const BASELINE = { H: "7.40", I: "6.75" };

function patchCore(src, cfg) {
  let out = src;
  const subs = [
    [/const BATCH_HOLD_TICKS = \d+;/, `const BATCH_HOLD_TICKS = ${cfg.hold};`],
    [/const MAX_BATCH_SIZE = \d+;/, `const MAX_BATCH_SIZE = ${cfg.batch};`],
    [/const EXIT_CLEARANCE = [^;]+;/, `const EXIT_CLEARANCE = ${cfg.exit};`],
    [/const CONFLICT_CROSS_SPEED = [^;]+;/, `const CONFLICT_CROSS_SPEED = ${cfg.cross};`],
    [/const CONFLICT_GUARD_SPAN = [^;]+;/, `const CONFLICT_GUARD_SPAN = ${cfg.span};`],
    [/const COMMIT_DIST = \d+;/, `const COMMIT_DIST = ${cfg.commit};`],
  ];
  for (const [re, rep] of subs) {
    if (!re.test(out)) throw new Error(`patch failed: ${re}`);
    out = out.replace(re, rep);
  }
  return out;
}

function loadSandbox(coreSrc) {
  const sandbox = { console, Math, Date };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.devicePixelRatio = 1;
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox, { filename: "traffic_core.js" });
  vm.runInContext(SUITE_SRC, sandbox, { filename: "traffic_test_suite.js" });
  return sandbox;
}

function runCard(suite, id) {
  const def = suite.filterTests({ ids: [id] })[0];
  if (!def) throw new Error(`card ${id} not found`);
  const inst = suite.runInstance(def, {});
  const times = inst.cases.map((k) => k.sim.timerSec.toFixed(2));
  const maneuvers = inst.cases.reduce(
    (s, k) => s + (k.sim.testMetrics.maneuverEnterCount || 0), 0);
  const grants = inst.cases.map((k) => k.sim.testMetrics.batchGrantCount || 0);
  return { verdict: inst.rawOutcome.kind, times, maneuvers, grants };
}

function evalConfig(cfg) {
  const t0 = Date.now();
  const sandbox = loadSandbox(patchCore(CORE_SRC, cfg));
  const suite = sandbox.TrafficTestSuite;
  const q = runCard(suite, "Q");
  const r = runCard(suite, "R");
  const h = runCard(suite, "H");
  const i = runCard(suite, "I");
  const wall = ((Date.now() - t0) / 1000).toFixed(0);
  const qTimes = q.times.map(Number);
  const qGreen = q.verdict === "pass";
  const hOk = h.times[0] === BASELINE.H;
  const iOk = i.times[0] === BASELINE.I;
  const accept = qGreen && r.verdict === "pass" && hOk && iOk;
  return { cfg, q, r, h, i, wall, accept, qTimes };
}

function row(res) {
  const c = res.cfg;
  return [
    `hold=${String(c.hold).padEnd(3)} batch=${c.batch} exit=${String(c.exit).padEnd(3)} cross=${String(c.cross).padEnd(4)} span=${String(c.span).padEnd(3)}`,
    `Q=${res.q.verdict.padEnd(4)} [${res.q.times.join("/")}] grants[${res.q.grants.join("/")}]`,
    `R=${res.r.verdict.padEnd(4)}`,
    `H=${res.h.times[0]}${res.h.times[0] === BASELINE.H ? "" : "(DRIFT!)"}`,
    `I=${res.i.times[0]}${res.i.times[0] === BASELINE.I ? "" : "(DRIFT!)"}`,
    `man=${String(res.q.maneuvers).padEnd(4)}`,
    `${res.wall}s`,
    res.accept ? "<<< ACCEPT" : "",
  ].join(" | ");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seeds") out.seeds = true;
    else if (a.startsWith("--")) { out[a.slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const DEFAULT_EXIT = 44; // CAR_L * 2
const DEFAULT_SPAN = 66; // CAR_L * 3

function cfgFromArgs(a) {
  return {
    hold: Number(a.hold ?? 24),
    batch: Number(a.batch ?? 2),
    exit: Number(a.exit ?? DEFAULT_EXIT),
    cross: Number(a.cross ?? 1),
    span: Number(a.span ?? DEFAULT_SPAN),
    commit: Number(a.commit ?? 90),
  };
}

// Finalist mode: alternate-seed Q-shaped races + full guard suite per config.
if (args.seeds) {
  const finalists = [
    { hold: 24, batch: 2, exit: 44, cross: 1, span: 66, commit: 300 },
    { hold: 24, batch: 2, exit: 44, cross: 1, span: 66, commit: 420 },
  ];
  for (const cfg of finalists) {
    const sandbox = loadSandbox(patchCore(CORE_SRC, cfg));
    const TC = sandbox.TrafficCore;
    const suite = sandbox.TrafficTestSuite;
    console.log(`\n=== commit=${cfg.commit} ===`);
    for (const seedBase of [301, 311, 321, 331]) {
      const times = [];
      let allDone = true;
      for (let lanes = 1; lanes <= 3; lanes++) {
        const sim = TC.createScenarioSim({
          lanes, nCars: 10, splitPct: 50, w: 220, h: 760,
          seed: seedBase + lanes - 1, dt: 1,
        });
        sim.start();
        for (let t = 0; t < 6000 && !sim.finished; t++) sim.tick(1, { v0: TC.V0_DEF });
        if (!sim.finished) allDone = false;
        times.push(sim.finished ? sim.timerSec : Infinity);
      }
      const paradox = allDone && times[0] < times[1] && times[0] < times[2];
      console.log(`seeds ${seedBase}+: [${times.map((x) => (x === Infinity ? "DNF" : x.toFixed(2))).join("/")}] ${paradox ? "PARADOX OK" : "NO PARADOX"}`);
    }
    for (const id of ["S", "X", "AA", "AH", "G"]) {
      const r = runCard(suite, id);
      console.log(`guard ${id}: ${r.verdict} [${r.times.join("/")}]`);
    }
  }
  process.exit(0);
}

if (args.hold || args.batch || args.exit || args.cross || args.span || args.commit) {
  console.log(row(evalConfig(cfgFromArgs(args))));
  process.exit(0);
}

// Sweep history:
// Stage 1 (scheduler constants: hold 24-96, batch 1, exit 44-88) — Q times
//   byte-identical across the board; grants[0/1/1] showed the batch scheduler
//   engages exactly ONCE per Q run. Scheduler constants are dead levers.
// Stage 2 (crossing-caution cap 0.3-0.7 × span 66/99) — byte-identical again.
//   Root cause (diagnostic): MOBIL demand balancing pre-sorts cars into their
//   target's lane; in the whole 2L run only 16 ticks had ANY car near the
//   crossing point and ZERO ticks had both sides simultaneously. No crossings,
//   no conflict, no paradox.
// Stage 3 (COMMIT_DIST): lock lane choice earlier so wrong-lane cars must
//   actually cross at the fork — creates the conflict the premise needs.
//   BATCH_APPROACH_DIST derives from COMMIT_DIST (+80) automatically.
const stage3 = [
  { hold: 24, batch: 2, exit: 44, cross: 1, span: 66, commit: 90 },   // baseline sanity
  { hold: 24, batch: 2, exit: 44, cross: 1, span: 66, commit: 150 },
  { hold: 24, batch: 2, exit: 44, cross: 1, span: 66, commit: 220 },
  { hold: 24, batch: 2, exit: 44, cross: 1, span: 66, commit: 300 },
  { hold: 24, batch: 2, exit: 44, cross: 1, span: 66, commit: 420 },
  { hold: 24, batch: 2, exit: 44, cross: 0.55, span: 66, commit: 220 },
  { hold: 24, batch: 2, exit: 44, cross: 0.55, span: 66, commit: 300 },
];

console.log("Stage 3 — COMMIT_DIST sweep (baseline Q=[10.00/7.33/6.75], H=7.40, I=6.75)");
for (const cfg of stage3) {
  try {
    console.log(row(evalConfig(cfg)));
  } catch (e) {
    console.log(`commit=${cfg.commit} cross=${cfg.cross} | ERROR: ${e.message}`);
  }
}

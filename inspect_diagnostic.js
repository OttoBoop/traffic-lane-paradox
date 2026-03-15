#!/usr/bin/env node
/**
 * inspect_diagnostic.js — Standalone diagnostic inspector for card BE
 *
 * Loads traffic_core.js + traffic_test_suite.js via vm (same as run_traffic_suite.js),
 * runs card BE to completion, and prints detailed diagnostic metrics.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ── Load modules (same pattern as run_traffic_suite.js) ──────────────
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
const sandbox = loadBrowserBundle([
  path.join(root, "traffic_core.js"),
  path.join(root, "traffic_test_suite.js"),
]);

const suite = sandbox.TrafficTestSuite;

// ── Find card BE ─────────────────────────────────────────────────────
const allTests = suite.filterTests({ ids: ["BE"] });
if (!allTests.length) {
  console.error("Card BE not found in test suite.");
  process.exit(1);
}
const def = allTests[0];

// ── Run card BE ──────────────────────────────────────────────────────
console.log("=== Running Card BE: " + def.name + " ===\n");
const inst = suite.runInstance(def);

// ── Gather per-seed metrics ──────────────────────────────────────────
const allNearMisses = [];
const allOverlaps = [];
const perSeedOverlapCounts = [];

for (const c of inst.cases) {
  const m = c.sim.testMetrics;
  if (Array.isArray(m.nearMissLog)) allNearMisses.push(...m.nearMissLog);
  if (Array.isArray(m.overlapEventLog)) allOverlaps.push(...m.overlapEventLog);
  perSeedOverlapCounts.push(m.overlapCount);
}

// ── Summary stats ────────────────────────────────────────────────────
console.log("─── Summary Stats ───────────────────────────────────────");
console.log("Seeds run:              " + inst.cases.length);
console.log("Total near-miss events: " + allNearMisses.length);
console.log("Total overlap events:   " + allOverlaps.length);

const zeroMargin = allOverlaps.filter((e) => e.zeroMarginOverlap);
const marginOnly = allOverlaps.filter((e) => !e.zeroMarginOverlap);
console.log("  Zero-margin overlaps: " + zeroMargin.length);
console.log("  Margin-only overlaps: " + marginOnly.length);

const withManeuver = allOverlaps.filter((e) => e.aManeuver || e.bManeuver);
console.log("Overlaps involving maneuvering car: " + withManeuver.length);

if (allOverlaps.length > 0) {
  const ticks = allOverlaps.map((e) => e.tick);
  console.log("Overlap tick range:     " + Math.min(...ticks) + " – " + Math.max(...ticks));
} else {
  console.log("Overlap tick range:     (none)");
}

console.log("Existing overlapCount (old SAT monitor): " + perSeedOverlapCounts.join("/"));

// ── First 5 overlap events with full details ─────────────────────────
console.log("\n─── First 5 Overlap Events (full details) ──────────────");
const first5 = allOverlaps.slice(0, 5);
if (first5.length === 0) {
  console.log("  (no overlap events recorded)");
} else {
  for (let i = 0; i < first5.length; i++) {
    const e = first5[i];
    console.log(`  [${i}] tick=${e.tick}  cars=${e.aId},${e.bId}`);
    console.log(`      posA=(${e.ax.toFixed(2)}, ${e.ay.toFixed(2)}, th=${e.ath.toFixed(3)})`);
    console.log(`      posB=(${e.bx.toFixed(2)}, ${e.by.toFixed(2)}, th=${e.bth.toFixed(3)})`);
    console.log(`      gap=${e.gap.toFixed(3)}  margin=${e.margin}  zeroMargin=${e.zeroMarginOverlap}`);
    console.log(`      maneuver: A=${e.aManeuver} B=${e.bManeuver}  seg: A=${e.aSeg} B=${e.bSeg}  speed: A=${typeof e.aSpeed === 'number' ? e.aSpeed.toFixed(2) : e.aSpeed} B=${typeof e.bSpeed === 'number' ? e.bSpeed.toFixed(2) : e.bSpeed}`);
  }
}

// ── Performance comparison ───────────────────────────────────────────
console.log("\n─── Performance Comparison ──────────────────────────────");

// Timed run WITH diagnostic (already done, but re-time it)
function timeRun() {
  const t0 = process.hrtime.bigint();
  suite.runInstance(def);
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6; // ms
}

const withDiag = timeRun();
console.log("Card BE with diagnostic:    " + withDiag.toFixed(1) + " ms");

// Timed run WITHOUT diagnostic — patch _diagnosticOverlapCheck to no-op
const simClass = inst.cases[0].sim.constructor;
const origMethod = simClass.prototype._diagnosticOverlapCheck;
simClass.prototype._diagnosticOverlapCheck = function () {}; // no-op

const withoutDiag = timeRun();
console.log("Card BE without diagnostic: " + withoutDiag.toFixed(1) + " ms");

// Restore
simClass.prototype._diagnosticOverlapCheck = origMethod;

const overhead = withDiag - withoutDiag;
const pct = withoutDiag > 0 ? ((overhead / withoutDiag) * 100).toFixed(1) : "N/A";
console.log("Diagnostic overhead:        " + overhead.toFixed(1) + " ms (" + pct + "%)");

console.log("\nDone.");

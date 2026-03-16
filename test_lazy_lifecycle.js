#!/usr/bin/env node
/**
 * TDD tests for Car Lazy Lifecycle (F1-T1 + F2-T4)
 * RED phase: these tests describe expected behavior that doesn't exist yet.
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

let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ name, status: "PASS" });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    results.push({ name, status: "FAIL", error: e.message });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed");
}

const W = 220, H = 760;
const P = { v0: V0_DEF };

// ============================================================
// F1-T1: Lazy Init — pre-fill visible queue only
// ============================================================
console.log("\n— F1-T1: Lazy Init Tests —");

test("init() should create fewer cars than nC at tick 0", () => {
  const sim = new Sim(3, 20, 50, 42);
  sim.init(W, H);
  // With 3 lanes and 20 cars, only ~1-2 per lane should be visible
  // (canvas height ~760, stopY ~547, SPAWN_SPACING ~40)
  // At most nLanes * 3 cars should be pre-filled
  assert(
    sim.cars.length < sim.nC,
    `Expected fewer than ${sim.nC} cars at init, got ${sim.cars.length}`
  );
});

test("init() should populate _spawnQueue with remaining targets", () => {
  const sim = new Sim(3, 20, 50, 42);
  sim.init(W, H);
  assert(
    sim._spawnQueue !== undefined && sim._spawnQueue !== null,
    "_spawnQueue should exist after init()"
  );
  assert(
    Array.isArray(sim._spawnQueue),
    "_spawnQueue should be an array"
  );
  assert(
    sim._spawnQueue.length > 0,
    "_spawnQueue should have remaining targets to spawn"
  );
  assert(
    sim._spawnQueue.length + sim.cars.length === sim.nC,
    `_spawnQueue (${sim._spawnQueue.length}) + cars (${sim.cars.length}) should equal nC (${sim.nC})`
  );
});

test("init() should set _spawnedCount to number of pre-filled cars", () => {
  const sim = new Sim(3, 20, 50, 42);
  sim.init(W, H);
  assert(
    sim._spawnedCount !== undefined,
    "_spawnedCount should exist after init()"
  );
  assert(
    sim._spawnedCount === sim.cars.length,
    `_spawnedCount (${sim._spawnedCount}) should equal cars.length (${sim.cars.length})`
  );
});

test("all pre-filled cars should have Y <= canvas height + margin", () => {
  const sim = new Sim(3, 20, 50, 42);
  sim.init(W, H);
  const margin = 20; // generous margin
  for (const c of sim.cars) {
    assert(
      c.y <= H + margin,
      `Car ${c.id} at Y=${c.y.toFixed(1)} exceeds canvas height + margin (${H + margin})`
    );
  }
});

test("all pre-filled cars should have valid paths assigned", () => {
  const sim = new Sim(3, 20, 50, 42);
  sim.init(W, H);
  for (const c of sim.cars) {
    assert(c.path !== null && c.path !== undefined, `Car ${c.id} has null path`);
    assert(c.pathKey !== '', `Car ${c.id} has empty pathKey`);
    assert(c.path.length > 0, `Car ${c.id} has empty path array`);
  }
});

// ============================================================
// F2-T4: Early Despawn — splice done cars + update finish check
// ============================================================
console.log("\n— F2-T4: Early Despawn Tests —");

test("done cars should be removed from this.cars[] after metrics are recorded", () => {
  const sim = new Sim(3, 20, 50, 42);
  sim.init(W, H);
  sim.start();
  // Run until at least one car finishes
  for (let t = 0; t < 50000 && Object.keys(sim.testMetrics.finishTimes).length === 0; t++) {
    sim.tick(1, P);
  }
  const finishedCount = Object.keys(sim.testMetrics.finishTimes).length;
  assert(finishedCount > 0, "No car finished within 50000 ticks");
  // After a car finishes, it should NOT remain in this.cars[]
  const doneInArray = sim.cars.filter(c => c.done);
  assert(
    doneInArray.length === 0,
    `Found ${doneInArray.length} done cars still in this.cars[] (should be 0 after splice)`
  );
});

test("finishTimes should have entries for all finished cars after splice", () => {
  const sim = new Sim(2, 10, 50, 42);
  sim.init(W, H);
  sim.start();
  // Run to completion
  for (let t = 0; t < 100000 && !sim.finished; t++) {
    sim.tick(1, P);
  }
  assert(sim.finished, "Simulation did not finish within 100000 ticks");
  const finishedIds = Object.keys(sim.testMetrics.finishTimes).map(Number);
  assert(
    finishedIds.length === sim.nC,
    `finishTimes has ${finishedIds.length} entries, expected ${sim.nC}`
  );
});

test("finish check should work with _spawnedCount instead of cars.every(done)", () => {
  const sim = new Sim(2, 10, 50, 42);
  sim.init(W, H);
  sim.start();
  for (let t = 0; t < 100000 && !sim.finished; t++) {
    sim.tick(1, P);
  }
  assert(sim.finished, "Simulation did not finish");
  // With splice, cars array should be empty when finished
  assert(
    sim.cars.length === 0,
    `After finish, cars array should be empty (got ${sim.cars.length})`
  );
  assert(
    sim._spawnedCount === sim.nC,
    `_spawnedCount (${sim._spawnedCount}) should equal nC (${sim.nC})`
  );
});

// ============================================================
// Summary
// ============================================================
console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) {
  console.log("\nFailed tests:");
  results.filter(r => r.status === "FAIL").forEach(r => {
    console.log(`  ✗ ${r.name}: ${r.error}`);
  });
}
process.exit(failed > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * measure_render_perf.js
 *
 * Measures the cost of Ren.draw() at a 3-lane / 40-car scenario.
 * Run with: node measure_render_perf.js
 *
 * Uses the classic theme (scene:'classic') so _ensureSceneBuf() returns early
 * and never calls document.createElement — no DOM needed.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---------------------------------------------------------------------------
// 1. Load traffic_core.js into a vm sandbox (same pattern as run_traffic_suite.js)
// ---------------------------------------------------------------------------

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

const root = path.dirname(__filename);
const sandbox = loadBrowserBundle([path.join(root, "traffic_core.js")]);
const { Sim, Ren, createScenarioSim, V0_DEF } = sandbox.TrafficCore;

// ---------------------------------------------------------------------------
// 2. Build a mock CanvasRenderingContext2D
//    Uses a Proxy so every property access returns a no-op function.
//    Methods that must return objects get special handling.
// ---------------------------------------------------------------------------

function makeMockGradient() {
  return { addColorStop: () => {} };
}

function makeMockPattern() {
  return {};
}

const ctx2dHandler = {
  get(target, prop) {
    // Allow reading/writing plain value properties (fillStyle, strokeStyle, etc.)
    if (prop in target) return target[prop];

    // Methods that return a sub-object
    if (prop === "createLinearGradient" || prop === "createRadialGradient") {
      return () => makeMockGradient();
    }
    if (prop === "createPattern") {
      return () => makeMockPattern();
    }
    if (prop === "getLineDash") {
      return () => [];
    }
    if (prop === "measureText") {
      return () => ({ width: 0 });
    }
    if (prop === "getImageData") {
      return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
    }
    if (prop === "createImageData") {
      return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
    }

    // All other methods: no-op
    return () => {};
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  },
};

function makeMockContext2D() {
  const base = {
    // Writable properties that the renderer may read back
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    globalAlpha: 1,
    font: "10px sans-serif",
    textAlign: "left",
    textBaseline: "alphabetic",
    lineCap: "butt",
    lineJoin: "miter",
    shadowBlur: 0,
    shadowColor: "transparent",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalCompositeOperation: "source-over",
    imageSmoothingEnabled: true,
  };
  return new Proxy(base, ctx2dHandler);
}

// ---------------------------------------------------------------------------
// 3. Build a mock canvas element
// ---------------------------------------------------------------------------

function makeMockCanvas(width, height) {
  const ctx = makeMockContext2D();
  return {
    width,
    height,
    getContext(type) {
      return type === "2d" ? ctx : null;
    },
    // _context exposed for convenience
    _context: ctx,
  };
}

// ---------------------------------------------------------------------------
// 4. Create the simulation: 3 lanes, 40 cars, 220×760
// ---------------------------------------------------------------------------

const LANES = 3;
const N_CARS = 40;
const WIDTH = 220;
const HEIGHT = 760;
const WARM_UP_TICKS = 50;
const MEASURE_FRAMES = 200;

console.log(`\nTraffic Lane Paradox — Render Performance Baseline`);
console.log(`===================================================`);
console.log(`Scenario  : ${LANES} lanes, ${N_CARS} cars`);
console.log(`Canvas    : ${WIDTH}×${HEIGHT}`);
console.log(`Warm-up   : ${WARM_UP_TICKS} ticks`);
console.log(`Measured  : ${MEASURE_FRAMES} draw() calls\n`);

const sim = createScenarioSim({
  lanes: LANES,
  nCars: N_CARS,
  w: WIDTH,
  h: HEIGHT,
  seed: 1,
  started: true,
});

// Run warm-up ticks to get cars into various positions / modes
// Pass dt=1, { v0: V0_DEF } — same convention as traffic_test_suite.js line 42
const P = { v0: V0_DEF };
for (let i = 0; i < WARM_UP_TICKS; i++) {
  sim.tick(1, P);
}

const visibleBefore = sim.cars.filter((c) => !c.done).length;
const modeCount = {};
for (const car of sim.cars) {
  const mode = car.trafficMode || "free";
  modeCount[mode] = (modeCount[mode] || 0) + 1;
}

console.log(`Cars visible (not done): ${visibleBefore}/${N_CARS}`);
console.log(`Traffic mode breakdown:`);
for (const [mode, count] of Object.entries(modeCount)) {
  console.log(`  ${mode.padEnd(12)}: ${count}`);
}
console.log(``);

// ---------------------------------------------------------------------------
// 5. Create Ren with mock canvas (classic theme avoids document.createElement)
// ---------------------------------------------------------------------------

const mockCanvas = makeMockCanvas(WIDTH, HEIGHT);
const ren = new Ren(mockCanvas, sim, { theme: "classic" });

// ---------------------------------------------------------------------------
// 6. Measure: call draw() MEASURE_FRAMES times
// ---------------------------------------------------------------------------

// Prime the renderer once outside the measurement window
ren.draw();

const t0 = process.hrtime.bigint();
for (let i = 0; i < MEASURE_FRAMES; i++) {
  ren.draw();
}
const t1 = process.hrtime.bigint();

const totalMs = Number(t1 - t0) / 1e6;
const avgMs = totalMs / MEASURE_FRAMES;
const fps = 1000 / avgMs;

console.log(`Results`);
console.log(`-------`);
console.log(`Total time   : ${totalMs.toFixed(2)} ms  (${MEASURE_FRAMES} frames)`);
console.log(`Avg per frame: ${avgMs.toFixed(4)} ms`);
console.log(`FPS equivalent: ${fps.toFixed(1)}`);
console.log(``);
console.log(`Baseline recorded. Update PLAN_Visual_State_Indicators.md § 9 with:`);
console.log(`  ${avgMs.toFixed(4)} ms / frame  (${fps.toFixed(1)} FPS eq.) — Node.js mock canvas, ${LANES}L/${N_CARS} cars`);

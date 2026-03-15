#!/usr/bin/env node
/**
 * brute_overlap_check.js
 *
 * Brute-force overlap detection using independent OBB check.
 * Tests both fixed dt=1 AND variable dt (browser-like frame jitter).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load traffic_core.js the same way run_traffic_suite.js does
const sandbox = { console, Math };
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.globalThis = sandbox;
sandbox.devicePixelRatio = 1;
vm.createContext(sandbox);

const coreFile = path.join(__dirname, 'traffic_core.js');
vm.runInContext(fs.readFileSync(coreFile, 'utf8'), sandbox, { filename: coreFile });

const TC = sandbox.TrafficCore;
const { createScenarioSim, CAR_L, CAR_W, V0_DEF, satOverlap } = TC;
const CAR_HALF_DIAG = Math.hypot(CAR_L / 2, CAR_W / 2);

const PHONE = { w: 110, h: 700 };
const MAX_TICKS = 600;

console.log('=== BRUTE-FORCE OVERLAP CHECK ===');
console.log(`CAR_L=${CAR_L}, CAR_W=${CAR_W}, CAR_HALF_DIAG=${CAR_HALF_DIAG.toFixed(2)}`);
console.log(`Canvas: ${PHONE.w}x${PHONE.h}, MaxTicks: ${MAX_TICKS}\n`);

// Independent OBB overlap (same algorithm as satOverlap but standalone)
function obbOverlap(ax, ay, ath, bx, by, bth) {
  const cornersOf = (x, y, th) => {
    const c = Math.cos(th), s = Math.sin(th);
    const hl = CAR_L / 2, hw = CAR_W / 2;
    return [
      { x: x + c * hl - s * hw, y: y + s * hl + c * hw },
      { x: x + c * hl + s * hw, y: y + s * hl - c * hw },
      { x: x - c * hl + s * hw, y: y - s * hl - c * hw },
      { x: x - c * hl - s * hw, y: y - s * hl + c * hw },
    ];
  };
  const cA = cornersOf(ax, ay, ath), cB = cornersOf(bx, by, bth);
  const axes = [
    { x: Math.cos(ath), y: Math.sin(ath) }, { x: -Math.sin(ath), y: Math.cos(ath) },
    { x: Math.cos(bth), y: Math.sin(bth) }, { x: -Math.sin(bth), y: Math.cos(bth) },
  ];
  for (const ax2 of axes) {
    let aMin = 1e9, aMax = -1e9, bMin = 1e9, bMax = -1e9;
    for (const c of cA) { const p = c.x * ax2.x + c.y * ax2.y; aMin = Math.min(aMin, p); aMax = Math.max(aMax, p); }
    for (const c of cB) { const p = c.x * ax2.x + c.y * ax2.y; bMin = Math.min(bMin, p); bMax = Math.max(bMax, p); }
    if (aMax <= bMin || bMax <= aMin) return false;
  }
  return true;
}

function obbPenetration(ax, ay, ath, bx, by, bth) {
  const cornersOf = (x, y, th) => {
    const c = Math.cos(th), s = Math.sin(th);
    const hl = CAR_L / 2, hw = CAR_W / 2;
    return [
      { x: x + c * hl - s * hw, y: y + s * hl + c * hw },
      { x: x + c * hl + s * hw, y: y + s * hl - c * hw },
      { x: x - c * hl + s * hw, y: y - s * hl - c * hw },
      { x: x - c * hl - s * hw, y: y - s * hl + c * hw },
    ];
  };
  const cA = cornersOf(ax, ay, ath), cB = cornersOf(bx, by, bth);
  const axes = [
    { x: Math.cos(ath), y: Math.sin(ath) }, { x: -Math.sin(ath), y: Math.cos(ath) },
    { x: Math.cos(bth), y: Math.sin(bth) }, { x: -Math.sin(bth), y: Math.cos(bth) },
  ];
  let minPen = Infinity;
  for (const ax2 of axes) {
    let aMin = 1e9, aMax = -1e9, bMin = 1e9, bMax = -1e9;
    for (const c of cA) { const p = c.x * ax2.x + c.y * ax2.y; aMin = Math.min(aMin, p); aMax = Math.max(aMax, p); }
    for (const c of cB) { const p = c.x * ax2.x + c.y * ax2.y; bMin = Math.min(bMin, p); bMax = Math.max(bMax, p); }
    if (aMax <= bMin || bMax <= aMin) return 0;
    minPen = Math.min(minPen, Math.min(aMax - bMin, bMax - aMin));
  }
  return minPen;
}

// Simple seeded RNG for variable dt
function mkRng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; };
}

function runScenario(sc, variableDt) {
  const sim = createScenarioSim({
    lanes: sc.lanes, nCars: sc.cars, splitPct: sc.split,
    w: PHONE.w, h: PHONE.h, seed: sc.seed, dt: 1, maxTicks: MAX_TICKS,
  });
  sim.start();

  const rng = mkRng(sc.seed + 9999);
  let overlapEvents = [];
  let maxPenetration = 0;
  let totalOverlapTicks = 0;

  for (let tick = 0; tick < MAX_TICKS && !sim.finished; tick++) {
    const dt = variableDt ? (0.85 + rng() * 0.5) : 1.0;
    sim.tick(dt, { v0: V0_DEF });

    const cars = sim.cars.filter(c => !c.done);
    let tickHasOverlap = false;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy > (CAR_L * 2) * (CAR_L * 2)) continue;

        const bruteHit = obbOverlap(a.x, a.y, a.th, b.x, b.y, b.th);
        const engineHit = satOverlap(a, b);

        if (bruteHit || engineHit) {
          tickHasOverlap = true;
          const pen = obbPenetration(a.x, a.y, a.th, b.x, b.y, b.th);
          maxPenetration = Math.max(maxPenetration, pen);
          if (overlapEvents.length < 30) {
            overlapEvents.push({
              tick, aId: a.id, bId: b.id,
              ax: a.x.toFixed(2), ay: a.y.toFixed(2), ath: (a.th * 180 / Math.PI).toFixed(1),
              bx: b.x.toFixed(2), by: b.y.toFixed(2), bth: (b.th * 180 / Math.PI).toFixed(1),
              pen: pen.toFixed(2),
              bruteHit, engineHit,
              aMan: !!a.maneuvering, bMan: !!b.maneuvering,
              aSeg: a.seg, bSeg: b.seg,
            });
          }
        }
      }
    }
    if (tickHasOverlap) totalOverlapTicks++;
  }

  return { overlapEvents, maxPenetration, totalOverlapTicks, sim };
}

// ─── Part 1: Fixed dt=1.0 ───────────────────────────
console.log('═══ PART 1: FIXED dt=1.0 (same as current tests) ═══\n');

const fixedScenarios = [
  { label: '3L/40 seed=42',   lanes: 3, cars: 40, split: 50, seed: 42 },
  { label: '3L/40 seed=777',  lanes: 3, cars: 40, split: 50, seed: 777 },
  { label: '3L/40 seed=123',  lanes: 3, cars: 40, split: 50, seed: 123 },
  { label: '2L/40 seed=42',   lanes: 2, cars: 40, split: 50, seed: 42 },
  { label: '2L/40 seed=777',  lanes: 2, cars: 40, split: 50, seed: 777 },
  { label: '2L/40 seed=99',   lanes: 2, cars: 40, split: 50, seed: 99 },
  { label: '3L/40 seed=1',    lanes: 3, cars: 40, split: 50, seed: 1 },
  { label: '3L/40 seed=999',  lanes: 3, cars: 40, split: 50, seed: 999 },
];

for (const sc of fixedScenarios) {
  const r = runScenario(sc, false);
  const total = r.overlapEvents.length >= 30 ? '30+ (capped)' : r.overlapEvents.length;
  console.log(`  ${sc.label}: overlaps=${total}  maxPen=${r.maxPenetration.toFixed(2)}px  overlapTicks=${r.totalOverlapTicks}  engineCount=${r.sim.testMetrics.overlapCount}  maneuvers=${r.sim.testMetrics.maneuverEnterCount}`);
  if (r.overlapEvents.length > 0) {
    for (let k = 0; k < Math.min(3, r.overlapEvents.length); k++) {
      const e = r.overlapEvents[k];
      console.log(`    [${k}] tick=${e.tick} cars=${e.aId},${e.bId} pen=${e.pen}px man=${e.aMan}/${e.bMan} seg=${e.aSeg}/${e.bSeg}`);
    }
  }
}

// ─── Part 2: Variable dt (browser-like) ──────────────
console.log('\n═══ PART 2: VARIABLE dt (browser-like frame jitter) ═══\n');

for (const sc of fixedScenarios) {
  const r = runScenario(sc, true);
  const total = r.overlapEvents.length >= 30 ? '30+ (capped)' : r.overlapEvents.length;
  console.log(`  ${sc.label}: overlaps=${total}  maxPen=${r.maxPenetration.toFixed(2)}px  overlapTicks=${r.totalOverlapTicks}  engineCount=${r.sim.testMetrics.overlapCount}  maneuvers=${r.sim.testMetrics.maneuverEnterCount}`);
  if (r.overlapEvents.length > 0) {
    for (let k = 0; k < Math.min(3, r.overlapEvents.length); k++) {
      const e = r.overlapEvents[k];
      console.log(`    [${k}] tick=${e.tick} cars=${e.aId},${e.bId} pen=${e.pen}px man=${e.aMan}/${e.bMan} seg=${e.aSeg}/${e.bSeg}`);
    }
  }
}

console.log('\nDone.');

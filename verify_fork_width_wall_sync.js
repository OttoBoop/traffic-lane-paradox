const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = global;
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'traffic_core.js'), 'utf8'));

const TC = global.TrafficCore;
const {
  MAIN_LANE_SCALE,
  BRANCH_LANE_SCALE,
  SPLIT_WALL_GAP,
  V0_DEF,
  Road,
  createScenarioSim
} = TC;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

function runScenario(spec) {
  const sim = createScenarioSim(spec);
  sim.start();
  const maxTicks = spec.maxTicks || 0;
  for (let i = 0; i < maxTicks && !sim.finished; i++) sim.tick(spec.dt || 1, { v0: V0_DEF });
  return sim;
}

function sequentialForkCars(lanes, leftCount, rightCount) {
  const cars = [];
  const total = leftCount + rightCount;
  for (let i = 0; i < total; i++) {
    cars.push({
      id: i,
      lane: i % lanes,
      target: i < leftCount ? 'left' : 'right',
      mobilTimer: 999
    });
  }
  return cars;
}

function checkGeometry() {
  const results = [];
  const layouts = [
    { label: 'desktop', w: 220, h: 760 },
    { label: 'short', w: 220, h: 260 },
    { label: 'landscape', w: 320, h: 180 },
  ];
  for (const layout of layouts) {
    for (const lanes of [1, 2, 3]) {
      const rd = new Road(lanes, layout.w, layout.h);
      assert(approx(rd.mainLw, rd.baseLw * MAIN_LANE_SCALE), `${layout.label} ${lanes}L main width drifted from base*1.10`);
      assert(approx(rd.branchLw, rd.baseLw * BRANCH_LANE_SCALE), `${layout.label} ${lanes}L branch width drifted from base*1.25`);
      assert(rd.preSplitInnerBoundarySampleCount === 0, `${layout.label} ${lanes}L emitted pre-split inner samples`);
      assert(rd.splitGapAt(rd.splitWallStartT) >= SPLIT_WALL_GAP, `${layout.label} ${lanes}L split wall starts before the configured gap`);

      const settleT = rd.branchWidthSettledT();
      let prev = rd.branchHalfW('left', settleT);
      let maxHalf = prev;
      for (let i = 1; i <= 100; i++) {
        const t = settleT + (1 - settleT) * (i / 100);
        const half = rd.branchHalfW('left', t);
        assert(half + 1e-6 >= prev, `${layout.label} ${lanes}L branch width shrank after the settle point`);
        prev = half;
        maxHalf = Math.max(maxHalf, half);
      }
      assert(maxHalf <= rd.branchHalfW('left', 1) + 1, `${layout.label} ${lanes}L branch width overshot the steady-state width`);

      const prematureInnerSegments = rd.boundary.filter(seg =>
        seg.role === 'branch_inner' && Math.min(seg.t0, seg.t1) < rd.splitWallStartT - 1e-6
      ).length;
      assert(prematureInnerSegments === 0, `${layout.label} ${lanes}L created inner wall segments before split start`);

      const boundarySamples = [
        ...rd.sampleMainEdge(-1, 8),
        ...rd.sampleMainEdge(1, 8),
        ...rd.sampleBranchEdge('left', 'outer', 12, 0),
        ...rd.sampleBranchEdge('right', 'outer', 12, 0),
        ...rd.sampleBranchEdge('left', 'inner', 12),
        ...rd.sampleBranchEdge('right', 'inner', 12)
      ];
      for (const sample of boundarySamples) {
        const clearance = rd.roadClearance(sample.x, sample.y);
        assert(Math.abs(clearance) <= 0.9, `${layout.label} ${lanes}L boundary and legality drifted apart by ${clearance.toFixed(2)}px`);
      }

      results.push({
        layout: layout.label,
        lanes,
        base: rd.baseLw.toFixed(2),
        main: rd.mainLw.toFixed(2),
        branch: rd.branchLw.toFixed(2),
        split: rd.splitWallStartT.toFixed(3)
      });
    }
  }
  return results;
}

function checkSafetyScenarios() {
  const laneHold = runScenario({
    lanes: 2,
    seed: 501,
    maxTicks: 160,
    cars: [
      { id: 0, lane: 0, target: 'left', y: 640 },
      { id: 1, lane: 1, target: 'left', y: 640 }
    ]
  });
  assert(laneHold.testMetrics.overlapCount === 0, 'Lane-hold scenario overlapped');
  assert(laneHold.testMetrics.wallEscapeCount === 0, 'Lane-hold scenario hit a wall');

  const baseline1L = runScenario({
    lanes: 1,
    nCars: 10,
    splitPct: 100,
    seed: 502,
    maxTicks: 2400
  });
  assert(baseline1L.finished, '1L same-target baseline did not finish');
  assert(baseline1L.testMetrics.overlapCount === 0, '1L same-target baseline overlapped');
  assert(baseline1L.testMetrics.wallEscapeCount === 0, '1L same-target baseline escaped the road');

  const sanity2L = runScenario({
    lanes: 2,
    nCars: 10,
    splitPct: 100,
    seed: 503,
    maxTicks: 3600
  });
  assert(sanity2L.finished, '2L same-target sanity run did not finish');
  assert(sanity2L.testMetrics.overlapCount === 0, '2L same-target sanity run overlapped');
  assert(sanity2L.testMetrics.wallEscapeCount === 0, '2L same-target sanity run escaped the road');

  const sequential = runScenario({
    lanes: 3,
    seed: 504,
    maxTicks: 9000,
    cars: sequentialForkCars(3, 6, 6)
  });
  assert(sequential.finished, 'Sequential fork replay did not finish');
  assert(sequential.testMetrics.overlapCount === 0, 'Sequential fork replay overlapped');
  assert(sequential.testMetrics.wallEscapeCount === 0, 'Sequential fork replay escaped the road');
  assert(sequential.testMetrics.prematureSplitWallContactCount === 0, 'Sequential fork replay touched a premature split wall');

  const shortView = runScenario({
    lanes: 3,
    nCars: 6,
    splitPct: 50,
    seed: 505,
    w: 220,
    h: 260,
    maxTicks: 5000
  });
  assert(shortView.finished, 'Short-view 3L replay did not finish');
  assert(shortView.testMetrics.overlapCount === 0, 'Short-view 3L replay overlapped');
  assert(shortView.testMetrics.wallEscapeCount === 0, 'Short-view 3L replay escaped the road');

  return {
    laneHoldDone: laneHold.testMetrics.doneCount,
    baseline1LTime: baseline1L.timerSec.toFixed(2),
    sanity2LTime: sanity2L.timerSec.toFixed(2),
    sequentialTime: sequential.timerSec.toFixed(2),
    shortViewTime: shortView.timerSec.toFixed(2)
  };
}

function main() {
  const geometry = checkGeometry();
  const safety = checkSafetyScenarios();
  console.log('Fork width and wall sync checks passed.');
  console.log(JSON.stringify({ geometry, safety }, null, 2));
}

try {
  main();
} catch (error) {
  console.error('Fork width and wall sync verification failed.');
  console.error(error.message);
  process.exit(1);
}

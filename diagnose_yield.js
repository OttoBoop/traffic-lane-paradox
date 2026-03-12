// Diagnostic script: find a scenario where yield→maneuver triggers before the 8-second threshold
const fs = require('fs'), vm = require('vm'), path = require('path');
const NO_PROGRESS_THRESH_YIELD = 480;
const root = __dirname;
const sandbox = { console, Math };
sandbox.window = sandbox; sandbox.global = sandbox; sandbox.globalThis = sandbox;
sandbox.devicePixelRatio = 1;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'traffic_core.js'), 'utf8'), sandbox);
const TC = sandbox.TrafficCore;

function runScenario(lanes, nCars, seed, maxTicks) {
  const sim = TC.createScenarioSim({ lanes, nCars, splitPct: 50, seed, w: 220, h: 760 });
  sim.start();
  let yieldHistory = {};
  let maneuverFromYield = [];
  const seenManeuver = new Set();
  const t0 = Date.now();
  for (let t = 0; t < maxTicks && !sim.finished; t++) {
    sim.tick(1, { v0: TC.V0_DEF });
    for (const car of sim.cars) {
      if (car.fixed || car.done) continue;
      if (car.trafficMode === 'yield' && !(car.id in yieldHistory)) {
        yieldHistory[car.id] = t;
      }
      if (car.maneuvering && !seenManeuver.has(car.id)) {
        seenManeuver.add(car.id);
        if (car.id in yieldHistory) {
          const delta = t - yieldHistory[car.id];
          maneuverFromYield.push({ carId: car.id, t, delta });
          if (delta < NO_PROGRESS_THRESH_YIELD) {
            console.log(`VIOLATION: ${lanes}L/${nCars}c/seed${seed}: car${car.id} yield@${yieldHistory[car.id]} maneuver@${t} delta=${delta} (${Date.now()-t0}ms elapsed)`);
          }
        }
      }
    }
  }
  const elapsed = Date.now() - t0;
  const violations = maneuverFromYield.filter(v => v.delta < NO_PROGRESS_THRESH_YIELD).length;
  console.log(`${lanes}L/${nCars}c/seed${seed}/${maxTicks}t: ${elapsed}ms | yields=${Object.keys(yieldHistory).length} maneuvers=${sim.testMetrics.maneuverEnterCount} violations=${violations} maxNoProgress=${sim.testMetrics.maxNoProgressTicks.toFixed(0)}`);
  return violations;
}

// Try various configs
console.log('--- Searching for yield->maneuver violations ---');
runScenario(2, 6, 307, 200);
runScenario(2, 8, 307, 200);
runScenario(3, 8, 307, 200);
runScenario(3, 10, 307, 200);
runScenario(3, 12, 307, 200);
runScenario(3, 12, 309, 200);
runScenario(3, 12, 310, 200);
runScenario(3, 12, 311, 200);

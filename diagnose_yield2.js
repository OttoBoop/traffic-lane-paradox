// Diagnose: track per-car noProgressTicks while in yield mode
const fs = require('fs'), vm = require('vm'), path = require('path');
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
  let maxYieldNoProgress = 0;
  let yieldNoProgressHistory = {}; // carId -> max noProgressTicks while in yield

  for (let t = 0; t < maxTicks && !sim.finished; t++) {
    sim.tick(1, { v0: TC.V0_DEF });
    for (const car of sim.cars) {
      if (car.fixed || car.done) continue;
      if (car.trafficMode === 'yield') {
        const curr = car.noProgressTicks;
        if (!(car.id in yieldNoProgressHistory)) yieldNoProgressHistory[car.id] = 0;
        yieldNoProgressHistory[car.id] = Math.max(yieldNoProgressHistory[car.id], curr);
        maxYieldNoProgress = Math.max(maxYieldNoProgress, curr);
      }
    }
  }
  console.log(`${lanes}L/${nCars}c/seed${seed}: yieldCars=${Object.keys(yieldNoProgressHistory).length} maxYieldNoProgress=${maxYieldNoProgress.toFixed(1)} yields=${sim.testMetrics.yieldEnterCount} maneuvers=${sim.testMetrics.maneuverEnterCount}`);
  for (const [id, maxNP] of Object.entries(yieldNoProgressHistory)) {
    if (maxNP > 5) console.log(`  car${id}: maxNoProgressTicks while in yield = ${maxNP.toFixed(1)}`);
  }
}

runScenario(2, 6, 307, 400);
runScenario(2, 8, 307, 400);
runScenario(3, 10, 307, 400);
runScenario(3, 12, 307, 400);
runScenario(3, 14, 307, 400);
runScenario(3, 14, 309, 400);
runScenario(3, 14, 310, 400);

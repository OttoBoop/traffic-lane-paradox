#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function parseArgs(argv) {
  const out = {
    id: "",
    section: "",
    family: "",
    gate: "",
    speed: "",
    strict: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--strict") {
      out.strict = true;
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function splitCsv(value) {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

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

function formatTime(inst) {
  return inst.cases.map((caseRecord) => caseRecord.sim.timerSec.toFixed(2)).join("/");
}

function expectationMismatch(def, rawOutcome) {
  if (def.expected === "pass") {
    return rawOutcome.kind !== "pass";
  }
  if (def.expected === "fail") {
    return rawOutcome.kind === "pass";
  }
  return false;
}

function summarizeRow(record) {
  return [
    record.id.padEnd(4),
    record.gate.padEnd(10),
    record.expected.padEnd(7),
    record.actual.padEnd(5),
    record.reported.padEnd(5),
    record.time.padEnd(14),
    record.note || "",
  ].join(" ");
}

const args = parseArgs(process.argv.slice(2));
const root = __dirname;
const sandbox = loadBrowserBundle([
  path.join(root, "traffic_core.js"),
  path.join(root, "traffic_test_suite.js"),
]);

const suite = sandbox.TrafficTestSuite;
const filters = {
  ids: splitCsv(args.id),
  sections: splitCsv(args.section),
  families: splitCsv(args.family),
  gates: splitCsv(args.gate),
};
const selected = suite.filterTests(filters);

if (!selected.length) {
  console.error("No traffic tests matched the provided filters.");
  process.exit(1);
}

const records = selected.map((def) => {
  const inst = suite.runInstance(def, {
    speedMult: args.speed ? Number(args.speed) : undefined,
  });
  return {
    id: def.id,
    name: def.name,
    section: def.section,
    family: def.family,
    gate: def.gate,
    expected: def.expected,
    verdict: inst.rawOutcome.kind,
    actual: inst.rawOutcome.kind,
    reported: inst.outcome.kind,
    passed: inst.rawOutcome.passed,
    time: formatTime(inst),
    note: inst.outcome.note || "",
    mismatch: expectationMismatch(def, inst.rawOutcome),
    metrics: def.metrics(inst),
  };
});

const guardFailures = records.filter((record) => record.gate === "guard" && record.actual !== "pass");
const strictFailures = args.strict
  ? records.filter((record) => record.actual !== "pass")
  : [];

if (args.json) {
  console.log(
    JSON.stringify(
      {
        strict: args.strict,
        selected: records.length,
        guardFailures: guardFailures.length,
        strictFailures: strictFailures.length,
        results: records,
      },
      null,
      2
    )
  );
} else {
  console.log("ID   GATE       EXPECT  ACT   SHOW  TIME           NOTE");
  records.forEach((record) => console.log(summarizeRow(record)));
  console.log(
    `Summary: ${records.length} selected, ${guardFailures.length} guard failure(s), ${strictFailures.length} strict failure(s).`
  );
}

if (strictFailures.length || guardFailures.length) {
  process.exit(1);
}

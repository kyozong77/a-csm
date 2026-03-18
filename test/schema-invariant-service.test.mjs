import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  demo_run_usci,
  validate_usci_output,
  validateUsciOutput
} from "../scripts/schema-invariant-service.mjs";

function validOutput() {
  return {
    schemaVersion: "1.0.0",
    ps: "ST_DEV",
    sub: "SUB_CA",
    f: false,
    e: "Short safe evidence summary.",
    vcd: {
      level: "V2",
      status: "MONITOR",
      trace: [{ step: "scan", message: "ok" }]
    },
    event_log: [
      { eventId: "CA_01@T1#1", axis: "CA", severity: "medium", turn_index: 1 },
      { eventId: "SR_01@T2#1", axis: "SR", severity: "low", turn_index: 2 }
    ]
  };
}

function hasFinding(result, code) {
  return result.findings.some((item) => item.code === code);
}

test("01 valid output passes", () => {
  const result = validateUsciOutput(validOutput());
  assert.equal(result.summary.decision, "PASS");
  assert.equal(result.summary.blockingFindings, 0);
});

test("02 alias validate_usci_output works", () => {
  const result = validate_usci_output(validOutput());
  assert.equal(result.summary.decision, "PASS");
});

test("03 non-object output fails", () => {
  const result = validateUsciOutput(null);
  assert.equal(result.summary.decision, "FAIL");
  assert.ok(hasFinding(result, "schema-output-invalid"));
});

test("04 missing required fields fail", () => {
  const result = validateUsciOutput({ schemaVersion: "1.0.0" });
  assert.ok(hasFinding(result, "schema-required-missing"));
});

test("05 invalid ps fails", () => {
  const data = validOutput();
  data.ps = "BAD";
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-ps-invalid"));
});

test("06 invalid sub fails", () => {
  const data = validOutput();
  data.sub = "SUB_BAD";
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-sub-invalid"));
});

test("07 non-boolean f fails", () => {
  const data = validOutput();
  data.f = "true";
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-f-invalid"));
});

test("08 empty e fails", () => {
  const data = validOutput();
  data.e = "";
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-e-invalid"));
});

test("09 too long evidence fails", () => {
  const data = validOutput();
  data.e = "x".repeat(321);
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-e-too-long"));
});

test("10 invalid vcd object fails", () => {
  const data = validOutput();
  data.vcd = [];
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-vcd-invalid"));
});

test("11 vcd missing trace fails", () => {
  const data = validOutput();
  data.vcd.trace = null;
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-vcd-trace-invalid"));
});

test("12 event_log must be array", () => {
  const data = validOutput();
  data.event_log = {};
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-event-log-invalid"));
});

test("13 event item must be object", () => {
  const data = validOutput();
  data.event_log = ["bad"];
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "event-item-invalid"));
});

test("14 event axis validation", () => {
  const data = validOutput();
  data.event_log[0].axis = "XX";
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "event-axis-invalid"));
});

test("15 event severity validation", () => {
  const data = validOutput();
  data.event_log[0].severity = "severe";
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "event-severity-invalid"));
});

test("16 event turn index validation", () => {
  const data = validOutput();
  data.event_log[0].turn_index = -1;
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "event-turn-index-invalid"));
});

test("17 turn order invariant", () => {
  const data = validOutput();
  data.event_log = [
    { eventId: "CA_01@T2#1", axis: "CA", severity: "medium", turn_index: 2 },
    { eventId: "SR_01@T1#1", axis: "SR", severity: "low", turn_index: 1 }
  ];
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "event-turn-order-violation"));
});

test("18 ST_ALM requires f=true", () => {
  const data = validOutput();
  data.ps = "ST_ALM";
  data.f = false;
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "inv-alarm-requires-flag"));
});

test("19 ST_NRM requires safe sub", () => {
  const data = validOutput();
  data.ps = "ST_NRM";
  data.sub = "SUB_CA";
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "inv-normal-safe-sub"));
});

test("20 VCD triggered requires trace", () => {
  const data = validOutput();
  data.vcd.status = "TRIGGERED";
  data.vcd.trace = [];
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "inv-vcd-triggered-trace"));
});

test("21 config can disable event id requirement", () => {
  const data = validOutput();
  delete data.event_log[0].eventId;
  const result = validateUsciOutput(data, { requireEventIds: false });
  assert.equal(hasFinding(result, "event-id-missing"), false);
});

test("22 config can relax evidence length", () => {
  const data = validOutput();
  data.e = "x".repeat(400);
  const result = validateUsciOutput(data, { maxEvidenceLength: 500 });
  assert.equal(hasFinding(result, "schema-e-too-long"), false);
});

test("23 demo_run_usci supports single case", () => {
  const report = demo_run_usci(validOutput());
  assert.equal(report.aggregate.totalCases, 1);
  assert.equal(report.aggregate.passCases, 1);
});

test("24 demo_run_usci supports array batch", () => {
  const failCase = validOutput();
  failCase.ps = "BAD";

  const report = demo_run_usci([validOutput(), failCase]);
  assert.equal(report.aggregate.totalCases, 2);
  assert.equal(report.aggregate.passCases, 1);
  assert.equal(report.aggregate.failCases, 1);
});

test("25 demo_run_usci supports cases wrapper", () => {
  const report = demo_run_usci({
    cases: [
      { id: "alpha", output: validOutput() },
      { id: "beta", output: { ...validOutput(), ps: "BAD" } }
    ]
  });
  assert.equal(report.results[0].id, "alpha");
  assert.equal(report.results[1].id, "beta");
});

test("26 trace always contains core steps", () => {
  const result = validateUsciOutput(validOutput());
  const steps = result.trace.map((item) => item.step);
  assert.deepEqual(steps, ["config", "schema", "event-log", "invariants"]);
});

test("27 CLI writes json output on pass", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-invariant-"));
  const inputPath = path.join(tmpDir, "input.json");
  const outputPath = path.join(tmpDir, "report.json");

  fs.writeFileSync(inputPath, JSON.stringify(validOutput(), null, 2));

  const result = spawnSync(process.execPath, [
    "scripts/schema-invariant-service.mjs",
    "--input",
    inputPath,
    "--output",
    outputPath,
    "--format",
    "json"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(report.aggregate.failCases, 0);
});

test("28 CLI returns non-zero when a case fails", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-invariant-"));
  const inputPath = path.join(tmpDir, "input.json");

  const broken = validOutput();
  broken.ps = "BAD";

  fs.writeFileSync(inputPath, JSON.stringify(broken, null, 2));

  const result = spawnSync(process.execPath, ["scripts/schema-invariant-service.mjs", "--input", inputPath], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
});

test("29 CLI emits markdown output", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-invariant-"));
  const inputPath = path.join(tmpDir, "input.json");
  const outputPath = path.join(tmpDir, "report.md");

  fs.writeFileSync(inputPath, JSON.stringify(validOutput(), null, 2));

  const result = spawnSync(process.execPath, [
    "scripts/schema-invariant-service.mjs",
    "--input",
    inputPath,
    "--output",
    outputPath,
    "--format",
    "markdown"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  const markdown = fs.readFileSync(outputPath, "utf8");
  assert.match(markdown, /# Schema \+ Invariant Validation Report/);
});

test("30 CLI emits both json and markdown", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-invariant-"));
  const inputPath = path.join(tmpDir, "input.json");
  const outputPath = path.join(tmpDir, "report.json");

  fs.writeFileSync(inputPath, JSON.stringify(validOutput(), null, 2));

  const result = spawnSync(process.execPath, [
    "scripts/schema-invariant-service.mjs",
    "--input",
    inputPath,
    "--output",
    outputPath,
    "--format",
    "both"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(fs.existsSync(`${outputPath}.md`), true);
});

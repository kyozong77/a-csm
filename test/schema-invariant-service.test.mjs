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

// --- mergeConfig edge cases ---

test("31 non-object config ignored, defaults used", () => {
  const result = validateUsciOutput(validOutput(), "bad");
  assert.equal(result.summary.decision, "PASS");
});

test("32 array config ignored, defaults used", () => {
  const result = validateUsciOutput(validOutput(), [1, 2]);
  assert.equal(result.summary.decision, "PASS");
});

test("33 null config ignored, defaults used", () => {
  const result = validateUsciOutput(validOutput(), null);
  assert.equal(result.summary.decision, "PASS");
});

// --- schemaVersion validation ---

test("34 numeric schemaVersion fails", () => {
  const data = validOutput();
  data.schemaVersion = 1;
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-version-invalid"));
});

test("35 empty schemaVersion fails", () => {
  const data = validOutput();
  data.schemaVersion = "";
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-version-invalid"));
});

// --- evidence boundary ---

test("36 evidence at exact max length passes", () => {
  const data = validOutput();
  data.e = "x".repeat(320);
  const result = validateUsciOutput(data);
  assert.equal(hasFinding(result, "schema-e-too-long"), false);
});

test("37 evidence one over max length fails", () => {
  const data = validOutput();
  data.e = "x".repeat(321);
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-e-too-long"));
});

// --- vcd level/status missing ---

test("38 vcd missing level fails", () => {
  const data = validOutput();
  delete data.vcd.level;
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-vcd-level-missing"));
});

test("39 vcd missing status fails", () => {
  const data = validOutput();
  delete data.vcd.status;
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-vcd-status-missing"));
});

// --- event_log eventId missing (default config requires it) ---

test("40 event missing eventId fails by default", () => {
  const data = validOutput();
  delete data.event_log[0].eventId;
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "event-id-missing"));
});

// --- turn order with equal indices (non-decreasing, should pass) ---

test("41 equal turn indices are valid (non-decreasing)", () => {
  const data = validOutput();
  data.event_log = [
    { eventId: "CA_01@T1#1", axis: "CA", severity: "medium", turn_index: 1 },
    { eventId: "SR_01@T1#2", axis: "SR", severity: "low", turn_index: 1 }
  ];
  const result = validateUsciOutput(data);
  assert.equal(hasFinding(result, "event-turn-order-violation"), false);
});

// --- invariant toggle tests ---

test("42 alarmRequiresFlag disabled skips alarm check", () => {
  const data = validOutput();
  data.ps = "ST_ALM";
  data.f = false;
  const result = validateUsciOutput(data, {
    invariantRules: { alarmRequiresFlag: false }
  });
  assert.equal(hasFinding(result, "inv-alarm-requires-flag"), false);
});

test("43 normalRequiresSafeSub disabled skips sub check", () => {
  const data = validOutput();
  data.ps = "ST_NRM";
  data.sub = "SUB_CA";
  const result = validateUsciOutput(data, {
    invariantRules: { normalRequiresSafeSub: false }
  });
  assert.equal(hasFinding(result, "inv-normal-safe-sub"), false);
});

test("44 requireTraceWhenVcdTriggered disabled skips trace check", () => {
  const data = validOutput();
  data.vcd.status = "TRIGGERED";
  data.vcd.trace = [];
  const result = validateUsciOutput(data, {
    invariantRules: { requireTraceWhenVcdTriggered: false }
  });
  assert.equal(hasFinding(result, "inv-vcd-triggered-trace"), false);
});

test("45 requireEventTurnOrder disabled skips order check", () => {
  const data = validOutput();
  data.event_log = [
    { eventId: "CA_01@T2#1", axis: "CA", severity: "medium", turn_index: 2 },
    { eventId: "SR_01@T1#1", axis: "SR", severity: "low", turn_index: 1 }
  ];
  const result = validateUsciOutput(data, {
    invariantRules: { requireEventTurnOrder: false }
  });
  assert.equal(hasFinding(result, "event-turn-order-violation"), false);
});

// --- ST_ALM with f=true passes ---

test("46 ST_ALM with f=true passes alarm invariant", () => {
  const data = validOutput();
  data.ps = "ST_ALM";
  data.f = true;
  const result = validateUsciOutput(data);
  assert.equal(hasFinding(result, "inv-alarm-requires-flag"), false);
});

// --- ST_NRM with SUB_NONE passes ---

test("47 ST_NRM with SUB_NONE passes normal-safe-sub invariant", () => {
  const data = validOutput();
  data.ps = "ST_NRM";
  data.sub = "SUB_NONE";
  const result = validateUsciOutput(data);
  assert.equal(hasFinding(result, "inv-normal-safe-sub"), false);
});

test("48 ST_NRM with SUB_SAFE_MODE passes normal-safe-sub invariant", () => {
  const data = validOutput();
  data.ps = "ST_NRM";
  data.sub = "SUB_SAFE_MODE";
  const result = validateUsciOutput(data);
  assert.equal(hasFinding(result, "inv-normal-safe-sub"), false);
});

// --- VCD triggered with non-empty trace passes ---

test("49 VCD TRIGGERED with non-empty trace passes", () => {
  const data = validOutput();
  data.vcd.status = "TRIGGERED";
  data.vcd.trace = [{ step: "scan", message: "ok" }];
  const result = validateUsciOutput(data);
  assert.equal(hasFinding(result, "inv-vcd-triggered-trace"), false);
});

// --- VCD status case insensitivity ---

test("50 VCD triggered status is case-insensitive", () => {
  const data = validOutput();
  data.vcd.status = "triggered";
  data.vcd.trace = [];
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "inv-vcd-triggered-trace"));
});

// --- normalizeBatchInput edge cases ---

test("51 demo_run_usci with empty array returns zero cases", () => {
  const report = demo_run_usci([]);
  assert.equal(report.aggregate.totalCases, 0);
  assert.equal(report.aggregate.passCases, 0);
  assert.equal(report.aggregate.failCases, 0);
});

test("52 demo_run_usci cases wrapper with missing id uses fallback", () => {
  const report = demo_run_usci({
    cases: [{ output: validOutput() }]
  });
  assert.equal(report.results[0].id, "case-1");
});

test("53 demo_run_usci cases wrapper with empty string id uses fallback", () => {
  const report = demo_run_usci({
    cases: [{ id: "  ", output: validOutput() }]
  });
  assert.equal(report.results[0].id, "case-1");
});

test("54 demo_run_usci cases wrapper item without output key uses item as payload", () => {
  const payload = validOutput();
  const report = demo_run_usci({
    cases: [{ id: "direct", ...payload }]
  });
  assert.equal(report.results[0].id, "direct");
});

// --- Multiple findings accumulation ---

test("55 multiple schema violations produce multiple findings", () => {
  const data = validOutput();
  data.ps = "BAD";
  data.sub = "BAD";
  data.f = "yes";
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-ps-invalid"));
  assert.ok(hasFinding(result, "schema-sub-invalid"));
  assert.ok(hasFinding(result, "schema-f-invalid"));
  assert.ok(result.summary.blockingFindings >= 3);
});

// --- Warning vs blocking counts ---

test("56 blocking findings increment blockingFindings count", () => {
  const data = validOutput();
  data.ps = "BAD";
  const result = validateUsciOutput(data);
  assert.equal(result.summary.blockingFindings >= 1, true);
  assert.equal(result.summary.warningFindings >= 0, true);
  assert.equal(result.summary.totalFindings, result.summary.blockingFindings + result.summary.warningFindings);
});

// --- Trace metadata ---

test("57 trace config step has metadata with field counts", () => {
  const result = validateUsciOutput(validOutput());
  const configStep = result.trace.find((t) => t.step === "config");
  assert.ok(configStep);
  assert.ok(configStep.metadata);
  assert.equal(typeof configStep.metadata.requiredTopLevelFields, "number");
  assert.equal(typeof configStep.metadata.allowedPs, "number");
  assert.equal(typeof configStep.metadata.allowedSub, "number");
});

test("58 trace steps have timestamps", () => {
  const result = validateUsciOutput(validOutput());
  for (const step of result.trace) {
    assert.ok(step.at);
    assert.match(step.at, /^\d{4}-\d{2}-\d{2}T/);
  }
});

// --- Result structure ---

test("59 result contains schemaVersion", () => {
  const result = validateUsciOutput(validOutput());
  assert.equal(result.schemaVersion, "1.0.0");
});

test("60 result contains generatedAt ISO timestamp", () => {
  const result = validateUsciOutput(validOutput());
  assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

// --- Config merge with custom arrays ---

test("61 custom allowedPs restricts valid values", () => {
  const data = validOutput();
  data.ps = "ST_DEV";
  const result = validateUsciOutput(data, { allowedPs: ["ST_NRM"] });
  assert.ok(hasFinding(result, "schema-ps-invalid"));
});

test("62 custom allowedSub restricts valid values", () => {
  const data = validOutput();
  data.sub = "SUB_CA";
  const result = validateUsciOutput(data, { allowedSub: ["SUB_NONE"] });
  assert.ok(hasFinding(result, "schema-sub-invalid"));
});

test("63 custom allowedEventAxis restricts valid values", () => {
  const data = validOutput();
  data.event_log = [
    { eventId: "CA_01@T1#1", axis: "CA", severity: "medium", turn_index: 1 }
  ];
  const result = validateUsciOutput(data, { allowedEventAxis: ["FR"] });
  assert.ok(hasFinding(result, "event-axis-invalid"));
});

test("64 custom allowedEventSeverity restricts valid values", () => {
  const data = validOutput();
  data.event_log = [
    { eventId: "CA_01@T1#1", axis: "CA", severity: "medium", turn_index: 1 }
  ];
  const result = validateUsciOutput(data, { allowedEventSeverity: ["high", "critical"] });
  assert.ok(hasFinding(result, "event-severity-invalid"));
});

// --- Completely empty output ---

test("65 completely empty object fails with missing fields", () => {
  const result = validateUsciOutput({});
  assert.ok(hasFinding(result, "schema-required-missing"));
  assert.equal(result.summary.decision, "FAIL");
});

// --- event_log with turn_index as string number ---

test("66 turn_index as string number is accepted", () => {
  const data = validOutput();
  data.event_log = [
    { eventId: "CA_01@T1#1", axis: "CA", severity: "medium", turn_index: "1" }
  ];
  const result = validateUsciOutput(data);
  assert.equal(hasFinding(result, "event-turn-index-invalid"), false);
});

// --- event_log with turn_index as non-numeric string ---

test("67 turn_index as non-numeric string fails", () => {
  const data = validOutput();
  data.event_log[0].turn_index = "abc";
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "event-turn-index-invalid"));
});

// --- Deterministic output ---

test("68 same input produces same findings", () => {
  const data = validOutput();
  data.ps = "BAD";
  const a = validateUsciOutput(data);
  const b = validateUsciOutput(data);
  assert.deepEqual(
    a.findings.map((f) => f.code),
    b.findings.map((f) => f.code)
  );
});

// --- demo_run_usci report structure ---

test("69 demo_run_usci report has schemaVersion and generatedAt", () => {
  const report = demo_run_usci(validOutput());
  assert.equal(report.schemaVersion, "1.0.0");
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

// --- CLI edge cases ---

test("70 CLI missing --input exits with code 2", () => {
  const result = spawnSync(process.execPath, [
    "scripts/schema-invariant-service.mjs"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 2);
});

test("71 CLI with --config merges config", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-invariant-"));
  const inputPath = path.join(tmpDir, "input.json");
  const configPath = path.join(tmpDir, "config.json");
  const outputPath = path.join(tmpDir, "report.json");

  const data = validOutput();
  data.e = "x".repeat(400);
  fs.writeFileSync(inputPath, JSON.stringify(data, null, 2));
  fs.writeFileSync(configPath, JSON.stringify({ maxEvidenceLength: 500 }, null, 2));

  const result = spawnSync(process.execPath, [
    "scripts/schema-invariant-service.mjs",
    "--input", inputPath,
    "--config", configPath,
    "--output", outputPath,
    "--format", "json"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(report.aggregate.passCases, 1);
});

// --- CLI batch input ---

test("72 CLI with array batch input processes multiple cases", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-invariant-"));
  const inputPath = path.join(tmpDir, "input.json");
  const outputPath = path.join(tmpDir, "report.json");

  const batch = [validOutput(), validOutput()];
  fs.writeFileSync(inputPath, JSON.stringify(batch, null, 2));

  const result = spawnSync(process.execPath, [
    "scripts/schema-invariant-service.mjs",
    "--input", inputPath,
    "--output", outputPath,
    "--format", "json"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(report.aggregate.totalCases, 2);
  assert.equal(report.aggregate.passCases, 2);
});

// --- Config array dedup ---

test("73 config arrays are deduped", () => {
  const data = validOutput();
  const result = validateUsciOutput(data, {
    allowedPs: ["ST_NRM", "ST_DEV", "ST_ALM", "ST_DEV"]
  });
  assert.equal(result.summary.decision, "PASS");
});

// --- Config arrays filter non-strings ---

test("74 config arrays filter out non-string values", () => {
  const data = validOutput();
  data.ps = "ST_DEV";
  const result = validateUsciOutput(data, {
    allowedPs: [null, 123, "ST_DEV", undefined]
  });
  assert.equal(hasFinding(result, "schema-ps-invalid"), false);
});

// --- Non-object event_log items continue processing ---

test("75 non-object event items do not block other items", () => {
  const data = validOutput();
  data.event_log = [
    "bad",
    { eventId: "CA_01@T1#1", axis: "CA", severity: "medium", turn_index: 1 }
  ];
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "event-item-invalid"));
  // The second valid item should still be processed (no early return)
  assert.equal(result.findings.filter((f) => f.code === "event-item-invalid").length, 1);
});

// --- f=true with ST_DEV is valid ---

test("76 f=true with ST_DEV passes", () => {
  const data = validOutput();
  data.ps = "ST_DEV";
  data.f = true;
  const result = validateUsciOutput(data);
  assert.equal(result.summary.decision, "PASS");
});

// --- Empty event_log is valid ---

test("77 empty event_log array is valid", () => {
  const data = validOutput();
  data.event_log = [];
  const result = validateUsciOutput(data);
  assert.equal(hasFinding(result, "schema-event-log-invalid"), false);
  assert.equal(result.summary.decision, "PASS");
});

// --- Config maxEvidenceLength must be positive integer ---

test("78 config maxEvidenceLength zero is ignored, default used", () => {
  const data = validOutput();
  data.e = "x".repeat(321);
  const result = validateUsciOutput(data, { maxEvidenceLength: 0 });
  // Zero is not > 0 so default 320 is used, 321 chars exceeds it
  assert.ok(hasFinding(result, "schema-e-too-long"));
});

test("79 config maxEvidenceLength fractional is ignored", () => {
  const data = validOutput();
  data.e = "x".repeat(321);
  const result = validateUsciOutput(data, { maxEvidenceLength: 400.5 });
  // 400.5 is not integer, so default 320 is used
  assert.ok(hasFinding(result, "schema-e-too-long"));
});

// --- Config requireEventIds boolean only ---

test("80 config requireEventIds non-boolean is ignored", () => {
  const data = validOutput();
  delete data.event_log[0].eventId;
  const result = validateUsciOutput(data, { requireEventIds: "false" });
  // String "false" is not boolean so default true is used
  assert.ok(hasFinding(result, "event-id-missing"));
});

// --- Markdown report structure from CLI ---

test("81 CLI markdown report contains case headers", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-invariant-"));
  const inputPath = path.join(tmpDir, "input.json");
  const outputPath = path.join(tmpDir, "report.md");

  const batch = {
    cases: [
      { id: "alpha", output: validOutput() },
      { id: "beta", output: validOutput() }
    ]
  };
  fs.writeFileSync(inputPath, JSON.stringify(batch, null, 2));

  const result = spawnSync(process.execPath, [
    "scripts/schema-invariant-service.mjs",
    "--input", inputPath,
    "--output", outputPath,
    "--format", "markdown"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  const md = fs.readFileSync(outputPath, "utf8");
  assert.match(md, /## alpha/);
  assert.match(md, /## beta/);
  assert.match(md, /Decision: \*\*PASS\*\*/);
});

// --- Finding path references ---

test("82 finding for missing field includes correct path", () => {
  const data = validOutput();
  delete data.ps;
  const result = validateUsciOutput(data);
  const finding = result.findings.find((f) => f.code === "schema-required-missing" && f.path === "$.ps");
  assert.ok(finding);
});

// --- Invariant checks on non-object skip gracefully ---

test("83 invariant validation skips non-object output", () => {
  const result = validateUsciOutput(null);
  // Should have schema-output-invalid but no invariant findings
  assert.ok(hasFinding(result, "schema-output-invalid"));
  assert.equal(hasFinding(result, "inv-alarm-requires-flag"), false);
  assert.equal(hasFinding(result, "inv-normal-safe-sub"), false);
  assert.equal(hasFinding(result, "inv-vcd-triggered-trace"), false);
});

// --- event_log validation skips non-array ---

test("84 event_log validation skips when not array", () => {
  const data = validOutput();
  data.event_log = {};
  const result = validateUsciOutput(data);
  assert.ok(hasFinding(result, "schema-event-log-invalid"));
  // Should not have individual event findings
  assert.equal(hasFinding(result, "event-item-invalid"), false);
});

// --- Config invariantRules merge is shallow ---

test("85 config invariantRules partially overrides defaults", () => {
  const data = validOutput();
  data.ps = "ST_ALM";
  data.f = false;
  // Only disable alarmRequiresFlag, others should remain enabled
  const result = validateUsciOutput(data, {
    invariantRules: { alarmRequiresFlag: false }
  });
  assert.equal(hasFinding(result, "inv-alarm-requires-flag"), false);
  // Other invariant rules should still work
  const data2 = validOutput();
  data2.vcd.status = "TRIGGERED";
  data2.vcd.trace = [];
  const result2 = validateUsciOutput(data2, {
    invariantRules: { alarmRequiresFlag: false }
  });
  assert.ok(hasFinding(result2, "inv-vcd-triggered-trace"));
});

// --- demo_run_usci passes config through ---

test("86 demo_run_usci passes config to each validation", () => {
  const data = validOutput();
  data.e = "x".repeat(400);
  const report = demo_run_usci(data, { maxEvidenceLength: 500 });
  assert.equal(report.aggregate.passCases, 1);
});

// --- Finding blocking flag ---

test("87 error severity findings are blocking by default", () => {
  const data = validOutput();
  data.ps = "BAD";
  const result = validateUsciOutput(data);
  const finding = result.findings.find((f) => f.code === "schema-ps-invalid");
  assert.ok(finding);
  assert.equal(finding.blocking, true);
  assert.equal(finding.severity, "error");
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { evaluateLedgerRepeat } from "../scripts/ledger-repeat-engine.mjs";

const baseConfig = {
  repeatWindowTurns: 8,
  escalateRepeatCount: 3,
  maxRangeSpan: 50,
  enforceMonotonicTurns: true,
  requirePayloadObject: false,
  allowCrossLedgerDuplicateKey: true
};

function event(overrides = {}) {
  return {
    ledgerType: "fact",
    entryKey: "k-1",
    turn_index: 1,
    turn_range: [1, 1],
    payload: { ok: true },
    ...overrides
  };
}

function run(events, config = baseConfig) {
  return evaluateLedgerRepeat({ events }, config);
}

function hasFinding(result, id) {
  return result.findings.some((item) => item.id === id);
}

test("01 accepts valid single event", () => {
  const result = run([event()]);
  assert.equal(result.summary.blockingFindings, 0);
  assert.equal(result.summary.totalEvents, 1);
});

test("02 routes fact events to fact ledger", () => {
  const result = run([event({ ledgerType: "fact" })]);
  assert.equal(result.ledger.fact.length, 1);
  assert.equal(result.ledger.commitment.length, 0);
  assert.equal(result.ledger.context.length, 0);
});

test("03 routes commitment events to commitment ledger", () => {
  const result = run([event({ ledgerType: "commitment" })]);
  assert.equal(result.ledger.commitment.length, 1);
});

test("04 routes context events to context ledger", () => {
  const result = run([event({ ledgerType: "context" })]);
  assert.equal(result.ledger.context.length, 1);
});

test("05 marks second close occurrence as REPEATED", () => {
  const result = run([
    event({ turn_index: 1, turn_range: [1, 1] }),
    event({ turn_index: 4, turn_range: [4, 4] })
  ]);
  assert.equal(result.ledger.fact[1].status, "REPEATED");
  assert.equal(result.summary.repeatedRows, 1);
});

test("06 marks third close occurrence as ESCALATED", () => {
  const result = run([
    event({ turn_index: 1, turn_range: [1, 1] }),
    event({ turn_index: 3, turn_range: [3, 3] }),
    event({ turn_index: 7, turn_range: [7, 7] })
  ]);
  assert.equal(result.ledger.fact[2].status, "ESCALATED");
  assert.equal(result.summary.escalatedRows, 1);
});

test("07 resets repeat chain when outside repeat window", () => {
  const result = run([
    event({ turn_index: 1, turn_range: [1, 1] }),
    event({ turn_index: 2, turn_range: [2, 2] }),
    event({ turn_index: 20, turn_range: [20, 20] })
  ]);
  assert.equal(result.ledger.fact[2].status, "NEW");
  assert.equal(result.ledger.fact[2].repeatCount, 1);
});

test("08 resolved event is marked RESOLVED", () => {
  const result = run([
    event({ turn_index: 1, turn_range: [1, 1] }),
    event({ turn_index: 2, turn_range: [2, 2], resolved: true })
  ]);
  assert.equal(result.ledger.fact[1].status, "RESOLVED");
  assert.equal(result.summary.resolvedRows, 1);
});

test("09 event after resolve starts from NEW", () => {
  const result = run([
    event({ turn_index: 1, turn_range: [1, 1] }),
    event({ turn_index: 2, turn_range: [2, 2], resolved: true }),
    event({ turn_index: 3, turn_range: [3, 3] })
  ]);
  assert.equal(result.ledger.fact[2].status, "NEW");
  assert.equal(result.ledger.fact[2].repeatCount, 1);
});

test("10 blocks non-array events input", () => {
  const result = evaluateLedgerRepeat({ events: null }, baseConfig);
  assert.ok(hasFinding(result, "input-events-invalid"));
  assert.equal(result.summary.blockingFindings > 0, true);
});

test("11 blocks non-object event item", () => {
  const result = evaluateLedgerRepeat({ events: ["x"] }, baseConfig);
  assert.ok(hasFinding(result, "input-event-invalid"));
});

test("12 blocks unknown ledger type", () => {
  const result = run([event({ ledgerType: "bad" })]);
  assert.ok(hasFinding(result, "input-event-ledgerType-invalid"));
});

test("13 blocks empty entryKey", () => {
  const result = run([event({ entryKey: "" })]);
  assert.ok(hasFinding(result, "input-event-entryKey-missing"));
});

test("14 blocks negative turn_index", () => {
  const result = run([event({ turn_index: -1 })]);
  assert.ok(hasFinding(result, "input-event-turn_index-invalid"));
});

test("15 blocks invalid turn_range shape", () => {
  const result = run([event({ turn_range: [1] })]);
  assert.ok(hasFinding(result, "input-event-turn_range-invalid"));
});

test("16 blocks reversed turn_range", () => {
  const result = run([event({ turn_range: [3, 2], turn_index: 3 })]);
  assert.ok(hasFinding(result, "input-event-turn_range-order-invalid"));
});

test("17 blocks turn_index outside turn_range", () => {
  const result = run([event({ turn_range: [1, 2], turn_index: 3 })]);
  assert.ok(hasFinding(result, "input-event-turn_index-out-of-range"));
});

test("18 blocks range span above maxRangeSpan", () => {
  const result = run([event({ turn_range: [1, 99], turn_index: 50 })], {
    ...baseConfig,
    maxRangeSpan: 10
  });
  assert.ok(hasFinding(result, "input-event-turn_range-span-exceeded"));
});

test("19 blocks invalid config repeatWindowTurns", () => {
  const result = run([event()], { ...baseConfig, repeatWindowTurns: -1 });
  assert.ok(hasFinding(result, "config-repeatWindowTurns-invalid"));
});

test("20 blocks invalid config escalateRepeatCount range", () => {
  const result = run([event()], { ...baseConfig, escalateRepeatCount: 0 });
  assert.ok(hasFinding(result, "config-escalateRepeatCount-range"));
});

test("21 blocks invalid config maxRangeSpan", () => {
  const result = run([event()], { ...baseConfig, maxRangeSpan: -3 });
  assert.ok(hasFinding(result, "config-maxRangeSpan-invalid"));
});

test("22 blocks invalid config boolean fields", () => {
  const result = run([event()], {
    ...baseConfig,
    enforceMonotonicTurns: "yes",
    requirePayloadObject: "yes",
    allowCrossLedgerDuplicateKey: "yes"
  });
  assert.ok(hasFinding(result, "config-enforceMonotonicTurns-invalid"));
  assert.ok(hasFinding(result, "config-requirePayloadObject-invalid"));
  assert.ok(hasFinding(result, "config-allowCrossLedgerDuplicateKey-invalid"));
});

test("23 blocks payload when object required", () => {
  const result = run([event({ payload: "text" })], { ...baseConfig, requirePayloadObject: true });
  assert.ok(hasFinding(result, "input-event-payload-invalid"));
});

test("24 blocks cross-ledger duplicate entryKey when disabled", () => {
  const result = run(
    [
      event({ ledgerType: "fact", entryKey: "dup", turn_index: 1, turn_range: [1, 1] }),
      event({ ledgerType: "context", entryKey: "dup", turn_index: 2, turn_range: [2, 2] })
    ],
    { ...baseConfig, allowCrossLedgerDuplicateKey: false }
  );
  assert.ok(hasFinding(result, "input-entryKey-cross-ledger-duplicate"));
});

test("25 calculates unique signatures across ledgers", () => {
  const result = run([
    event({ ledgerType: "fact", entryKey: "a", turn_index: 1, turn_range: [1, 1] }),
    event({ ledgerType: "commitment", entryKey: "b", turn_index: 2, turn_range: [2, 2] }),
    event({ ledgerType: "context", entryKey: "c", turn_index: 3, turn_range: [3, 3] })
  ]);
  assert.equal(result.summary.uniqueSignatures, 3);
});

test("26 preserves deterministic order by turn index", () => {
  const result = run([
    event({ eventId: "late", turn_index: 5, turn_range: [5, 5] }),
    event({ eventId: "early", turn_index: 1, turn_range: [1, 1] })
  ]);
  assert.equal(result.decisions[0].turn_index, 1);
  assert.equal(result.decisions[1].turn_index, 5);
});

test("27 trace includes input and ledger steps", () => {
  const result = run([event()]);
  assert.ok(result.trace.some((item) => item.step === "input"));
  assert.ok(result.trace.some((item) => item.step === "ledger"));
});

test("28 CLI writes json output", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-repeat-"));
  const inputPath = path.join(tmpDir, "input.json");
  const configPath = path.join(tmpDir, "config.json");
  const outputPath = path.join(tmpDir, "result.json");

  fs.writeFileSync(inputPath, JSON.stringify({ events: [event()] }, null, 2));
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2));

  execFileSync(
    "node",
    [
      "scripts/ledger-repeat-engine.mjs",
      "--input",
      inputPath,
      "--config",
      configPath,
      "--output",
      outputPath,
      "--format",
      "json"
    ],
    { stdio: "pipe" }
  );

  const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(output.summary.totalEvents, 1);
});

test("29 CLI writes both json and markdown", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-repeat-"));
  const inputPath = path.join(tmpDir, "input.json");
  const configPath = path.join(tmpDir, "config.json");
  const outputPath = path.join(tmpDir, "result.json");

  fs.writeFileSync(inputPath, JSON.stringify({ events: [event()] }, null, 2));
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2));

  execFileSync(
    "node",
    [
      "scripts/ledger-repeat-engine.mjs",
      "--input",
      inputPath,
      "--config",
      configPath,
      "--output",
      outputPath,
      "--format",
      "both"
    ],
    { stdio: "pipe" }
  );

  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(fs.existsSync(`${outputPath}.md`), true);
});

test("30 CLI exits non-zero when blocking findings exist", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-repeat-"));
  const inputPath = path.join(tmpDir, "input.json");
  const configPath = path.join(tmpDir, "config.json");

  fs.writeFileSync(inputPath, JSON.stringify({ events: [event({ ledgerType: "invalid" })] }, null, 2));
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2));

  let threw = false;
  try {
    execFileSync(
      "node",
      ["scripts/ledger-repeat-engine.mjs", "--input", inputPath, "--config", configPath],
      { stdio: "pipe" }
    );
  } catch (error) {
    threw = true;
    assert.equal(error.status, 1);
  }

  assert.equal(threw, true);
});

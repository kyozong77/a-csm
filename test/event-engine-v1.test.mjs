import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DEFAULT_RULES, runEventEngine } from "../scripts/event-engine-v1.mjs";

const baseConfig = {
  minSeverity: "low",
  enabledRuleIds: [],
  disabledRuleIds: [],
  dedupeByRulePerTurn: true,
  maxEventsPerRule: 5,
  excerptMaxLength: 140
};

function inputText(text) {
  return { text };
}

function inputTurns(turns) {
  return { turns };
}

function hasFinding(result, findingId) {
  return result.findings.some((item) => item.id === findingId);
}

test("001 default rules count is 43", () => {
  assert.equal(DEFAULT_RULES.length, 43);
});

test("002 detects FR event from text", () => {
  const result = runEventEngine(inputText("there is a fabricated citation in this answer"), baseConfig);
  assert.equal(result.summary.totalEvents, 1);
  assert.equal(result.events[0].axis, "FR");
});

test("003 detects CA event from text", () => {
  const result = runEventEngine(inputText("this has context drift issue"), baseConfig);
  assert.equal(result.events[0].axis, "CA");
});

test("004 detects SR event from text", () => {
  const result = runEventEngine(inputText("this contains violence instruction"), baseConfig);
  assert.equal(result.events[0].axis, "SR");
});

test("005 detects SA event from text", () => {
  const result = runEventEngine(inputText("service entered crash loop"), baseConfig);
  assert.equal(result.events[0].axis, "SA");
});

test("006 reports axis counts", () => {
  const result = runEventEngine(
    inputText("fabricated citation context drift violence instruction crash loop"),
    baseConfig
  );
  assert.equal(result.summary.axisCounts.FR, 1);
  assert.equal(result.summary.axisCounts.CA, 1);
  assert.equal(result.summary.axisCounts.SR, 1);
  assert.equal(result.summary.axisCounts.SA, 1);
});

test("007 applies minSeverity filter", () => {
  const result = runEventEngine(inputText("ambiguous reference fabricated citation"), {
    ...baseConfig,
    minSeverity: "high"
  });
  assert.equal(result.events.some((item) => item.ruleId === "CA_06"), false);
  assert.equal(result.events.some((item) => item.ruleId === "FR_01"), true);
});

test("008 enabledRuleIds restricts active rules", () => {
  const result = runEventEngine(inputText("fabricated citation context drift"), {
    ...baseConfig,
    enabledRuleIds: ["CA_01"]
  });
  assert.equal(result.summary.activeRules, 1);
  assert.equal(result.summary.totalEvents, 1);
  assert.equal(result.events[0].ruleId, "CA_01");
});

test("009 disabledRuleIds excludes rules", () => {
  const result = runEventEngine(inputText("fabricated citation"), {
    ...baseConfig,
    disabledRuleIds: ["FR_01"]
  });
  assert.equal(result.summary.totalEvents, 0);
});

test("010 maxEventsPerRule caps per rule", () => {
  const result = runEventEngine(
    inputTurns([
      { id: "T1", text: "fabricated citation" },
      { id: "T2", text: "fabricated citation" },
      { id: "T3", text: "fabricated citation" }
    ]),
    {
      ...baseConfig,
      maxEventsPerRule: 2
    }
  );
  assert.equal(result.summary.totalEvents, 2);
});

test("011 dedupeByRulePerTurn true emits one event in same turn", () => {
  const result = runEventEngine(inputText("fabricated citation and fabricated citation"), {
    ...baseConfig,
    dedupeByRulePerTurn: true
  });
  assert.equal(result.summary.totalEvents, 1);
});

test("012 dedupeByRulePerTurn false still deterministic per detection mode", () => {
  const result = runEventEngine(inputText("fabricated citation fabricated citation"), {
    ...baseConfig,
    dedupeByRulePerTurn: false
  });
  assert.equal(result.summary.totalEvents, 1);
});

test("013 text mode creates T1 event turn id", () => {
  const result = runEventEngine(inputText("fabricated citation"), baseConfig);
  assert.equal(result.events[0].turnId, "T1");
});

test("014 turns mode respects provided turn ids", () => {
  const result = runEventEngine(inputTurns([{ id: "X9", text: "fabricated citation" }]), baseConfig);
  assert.equal(result.events[0].turnId, "X9");
});

test("015 turns mode creates fallback ids", () => {
  const result = runEventEngine(inputTurns([{ text: "fabricated citation" }]), baseConfig);
  assert.equal(result.events[0].turnId, "T1");
});

test("016 invalid input blocks", () => {
  const result = runEventEngine(null, baseConfig);
  assert.ok(hasFinding(result, "input-turns-invalid"));
  assert.equal(result.summary.blockingFindings > 0, true);
});

test("017 invalid turn object blocks", () => {
  const result = runEventEngine(inputTurns(["bad"]), baseConfig);
  assert.ok(hasFinding(result, "input-turn-invalid"));
});

test("018 invalid turn text blocks", () => {
  const result = runEventEngine(inputTurns([{ id: "T1" }]), baseConfig);
  assert.ok(hasFinding(result, "input-turn-text-invalid"));
});

test("019 unknown enabled rule blocks", () => {
  const result = runEventEngine(inputText("fabricated citation"), {
    ...baseConfig,
    enabledRuleIds: ["NOPE"]
  });
  assert.ok(hasFinding(result, "config-enabled-rule-unknown"));
});

test("020 unknown disabled rule blocks", () => {
  const result = runEventEngine(inputText("fabricated citation"), {
    ...baseConfig,
    disabledRuleIds: ["NOPE"]
  });
  assert.ok(hasFinding(result, "config-disabled-rule-unknown"));
});

test("021 invalid minSeverity blocks", () => {
  const result = runEventEngine(inputText("fabricated citation"), {
    ...baseConfig,
    minSeverity: "urgent"
  });
  assert.ok(hasFinding(result, "config-min-severity-invalid"));
});

test("022 invalid dedupe flag blocks", () => {
  const result = runEventEngine(inputText("fabricated citation"), {
    ...baseConfig,
    dedupeByRulePerTurn: "yes"
  });
  assert.ok(hasFinding(result, "config-dedupe-by-rule-per-turn-invalid"));
});

test("023 invalid maxEventsPerRule blocks", () => {
  const result = runEventEngine(inputText("fabricated citation"), {
    ...baseConfig,
    maxEventsPerRule: 0
  });
  assert.ok(hasFinding(result, "config-max-events-per-rule-invalid"));
});

test("024 invalid excerptMaxLength blocks", () => {
  const result = runEventEngine(inputText("fabricated citation"), {
    ...baseConfig,
    excerptMaxLength: 0
  });
  assert.ok(hasFinding(result, "config-excerpt-max-length-invalid"));
});

test("025 no hit produces zero events", () => {
  const result = runEventEngine(inputText("all good and calm"), baseConfig);
  assert.equal(result.summary.totalEvents, 0);
});

test("026 severity counts are aggregated", () => {
  const result = runEventEngine(inputText("fabricated citation context drift self-harm hint"), baseConfig);
  assert.equal(result.summary.severityCounts.high >= 1, true);
  assert.equal(result.summary.severityCounts.critical >= 1, true);
});

test("027 excerpt field exists on event", () => {
  const result = runEventEngine(inputText("prefix fabricated citation suffix"), baseConfig);
  assert.equal(typeof result.events[0].excerpt, "string");
  assert.ok(result.events[0].excerpt.length > 0);
});

test("028 trace includes input step", () => {
  const result = runEventEngine(inputText("fabricated citation"), baseConfig);
  assert.ok(result.trace.some((item) => item.step === "input"));
});

test("029 events are deterministic for same input", () => {
  const input = inputText("fabricated citation context drift");
  const a = runEventEngine(input, baseConfig);
  const b = runEventEngine(input, baseConfig);
  assert.deepEqual(
    a.events.map((item) => item.eventId),
    b.events.map((item) => item.eventId)
  );
});

test("030 CLI writes json output", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-engine-"));
  const inputPath = path.join(tmpDir, "input.json");
  const configPath = path.join(tmpDir, "config.json");
  const outputPath = path.join(tmpDir, "output.json");

  fs.writeFileSync(inputPath, JSON.stringify(inputText("fabricated citation"), null, 2));
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2));

  execFileSync(
    "node",
    [
      "scripts/event-engine-v1.mjs",
      "--input",
      inputPath,
      "--config",
      configPath,
      "--output",
      outputPath
    ],
    { cwd: process.cwd(), stdio: "pipe" }
  );

  const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(output.summary.totalEvents, 1);
});

test("031 CLI non-zero on blocking findings", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-engine-"));
  const inputPath = path.join(tmpDir, "input.json");
  const configPath = path.join(tmpDir, "config.json");

  fs.writeFileSync(inputPath, JSON.stringify({}, null, 2));
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2));

  assert.throws(
    () =>
      execFileSync(
        "node",
        ["scripts/event-engine-v1.mjs", "--input", inputPath, "--config", configPath],
        { cwd: process.cwd(), stdio: "pipe" }
      ),
    /Command failed/
  );
});

test("032 CLI markdown output works", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-engine-"));
  const inputPath = path.join(tmpDir, "input.json");
  const outputPath = path.join(tmpDir, "output.md");

  fs.writeFileSync(inputPath, JSON.stringify(inputText("fabricated citation"), null, 2));

  execFileSync(
    "node",
    [
      "scripts/event-engine-v1.mjs",
      "--input",
      inputPath,
      "--format",
      "markdown",
      "--output",
      outputPath
    ],
    { cwd: process.cwd(), stdio: "pipe" }
  );

  const markdown = fs.readFileSync(outputPath, "utf8");
  assert.match(markdown, /# Event Engine Result/);
});

let caseIndex = 33;
for (const rule of DEFAULT_RULES) {
  test(`${String(caseIndex).padStart(3, "0")} rule ${rule.id} triggers detection`, () => {
    const phrase = rule.phrases[0];
    const result = runEventEngine(inputText(`this contains ${phrase}`), baseConfig);
    assert.equal(result.events.some((item) => item.ruleId === rule.id), true);
  });
  caseIndex += 1;
}

for (const rule of DEFAULT_RULES) {
  test(`${String(caseIndex).padStart(3, "0")} rule ${rule.id} disabled suppresses detection`, () => {
    const phrase = rule.phrases[0];
    const result = runEventEngine(
      inputText(`this contains ${phrase}`),
      { ...baseConfig, disabledRuleIds: [rule.id] }
    );
    assert.equal(result.events.some((item) => item.ruleId === rule.id), false);
  });
  caseIndex += 1;
}

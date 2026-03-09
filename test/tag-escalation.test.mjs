import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { evaluateTagEscalation } from "../scripts/tag-escalation.mjs";

const baseConfig = {
  weights: {
    TAG_FCT: 1.0,
    TAG_SAF: 1.4,
    TAG_CTX: 1.1,
    TAG_SYS: 0.9
  },
  severityScores: {
    low: 1,
    medium: 2,
    high: 4,
    critical: 6
  },
  thresholds: {
    medium: 4,
    deviate: 6,
    high: 8
  },
  conservativeRules: {
    multiAxisMediumToHigh: 2,
    freezeNoDowngrade: true,
    downgradeAfterStableRounds: 2
  }
};

function event(axis, severity, count = 1) {
  return { axis, severity, count };
}

function input(events, previousState = undefined) {
  return {
    events,
    ...(previousState ? { previousState } : {})
  };
}

function hasFinding(result, findingId) {
  return result.findings.some((item) => item.id === findingId);
}

test("01 computes LOW decision for low score", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), baseConfig);
  assert.equal(result.decisionLevel, "LOW");
});

test("02 computes MEDIUM decision for medium threshold", () => {
  const result = evaluateTagEscalation(input([event("TAG_SAF", "medium"), event("TAG_CTX", "medium")]), {
    ...baseConfig,
    conservativeRules: { ...baseConfig.conservativeRules, multiAxisMediumToHigh: 3 }
  });
  assert.equal(result.summary.baseLevel, "MEDIUM");
  assert.equal(result.decisionLevel, "MEDIUM");
});

test("03 computes HIGH decision for high threshold", () => {
  const result = evaluateTagEscalation(input([event("TAG_SAF", "high"), event("TAG_CTX", "high")]), baseConfig);
  assert.equal(result.summary.baseLevel, "HIGH");
  assert.equal(result.decisionLevel, "HIGH");
});

test("04 critical event escalates to HIGH", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "critical")]), {
    ...baseConfig,
    thresholds: { medium: 10, deviate: 30, high: 50 }
  });
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(result.trace.some((step) => step.step === "conservative-critical"));
});

test("05 multi-axis medium escalates to HIGH", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "medium"), event("TAG_CTX", "medium")]),
    {
      ...baseConfig,
      thresholds: { medium: 6, deviate: 9, high: 12 },
      conservativeRules: { ...baseConfig.conservativeRules, multiAxisMediumToHigh: 2 }
    }
  );
  assert.equal(result.summary.baseLevel, "LOW");
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(result.trace.some((step) => step.step === "conservative-multi-axis"));
});

test("06 single-axis medium does not trigger multi-axis rule", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "medium")]), {
    ...baseConfig,
    thresholds: { medium: 6, deviate: 9, high: 12 },
    conservativeRules: { ...baseConfig.conservativeRules, multiAxisMediumToHigh: 2 }
  });
  assert.equal(result.decisionLevel, "LOW");
});

test("07 conservative no-downgrade keeps previous HIGH level", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")], { level: "HIGH", stableRounds: 0 }), baseConfig);
  assert.equal(result.decisionLevel, "HIGH");
  assert.equal(result.summary.nextStableRounds, 1);
});

test("08 downgrade allowed after stable rounds threshold", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")], { level: "HIGH", stableRounds: 2 }), baseConfig);
  assert.equal(result.summary.baseLevel, "LOW");
  assert.equal(result.decisionLevel, "LOW");
});

test("09 no-downgrade disabled allows immediate downgrade", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")], { level: "HIGH", stableRounds: 0 }), {
    ...baseConfig,
    conservativeRules: { ...baseConfig.conservativeRules, freezeNoDowngrade: false }
  });
  assert.equal(result.decisionLevel, "LOW");
});

test("10 weighted score respects count multiplier", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "medium", 3)]), baseConfig);
  assert.equal(result.summary.totalScore, 6);
});

test("11 finds invalid events array", () => {
  const result = evaluateTagEscalation({ events: null }, baseConfig);
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(hasFinding(result, "input-events-invalid"));
});

test("12 finds invalid event object", () => {
  const result = evaluateTagEscalation({ events: ["bad"] }, baseConfig);
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(hasFinding(result, "input-event-invalid"));
});

test("13 finds invalid event axis", () => {
  const result = evaluateTagEscalation(input([{ axis: "TAG_X", severity: "low", count: 1 }]), baseConfig);
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(hasFinding(result, "input-event-axis-invalid"));
});

test("14 finds invalid event severity", () => {
  const result = evaluateTagEscalation(input([{ axis: "TAG_FCT", severity: "bad", count: 1 }]), baseConfig);
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(hasFinding(result, "input-event-severity-invalid"));
});

test("15 finds invalid event count", () => {
  const result = evaluateTagEscalation(input([{ axis: "TAG_FCT", severity: "low", count: 0 }]), baseConfig);
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(hasFinding(result, "input-event-count-invalid"));
});

test("16 invalid config threshold range is blocked", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), {
    ...baseConfig,
    thresholds: { medium: 9, deviate: 10, high: 8 }
  });
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(hasFinding(result, "config-thresholds-range-invalid"));
});

test("17 invalid config weight is blocked", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), {
    ...baseConfig,
    weights: { ...baseConfig.weights, TAG_FCT: -1 }
  });
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(hasFinding(result, "config-weights.TAG_FCT-invalid"));
});

test("18 invalid config severity score is blocked", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), {
    ...baseConfig,
    severityScores: { ...baseConfig.severityScores, low: -1 }
  });
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(hasFinding(result, "config-severityScores.low-invalid"));
});

test("19 invalid conservative integer config is blocked", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), {
    ...baseConfig,
    conservativeRules: { ...baseConfig.conservativeRules, downgradeAfterStableRounds: 1.5 }
  });
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(hasFinding(result, "config-conservativeRules.downgradeAfterStableRounds-invalid"));
});

test("20 trace is always present with input and scoring steps", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), baseConfig);
  assert.ok(result.trace.some((item) => item.step === "input"));
  assert.ok(result.trace.some((item) => item.step === "scoring"));
});

test("21 distinctAxes count is computed", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low"), event("TAG_SAF", "low")]), baseConfig);
  assert.equal(result.summary.distinctAxes, 2);
});

test("22 mediumOrAboveAxes count is computed", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "medium"), event("TAG_SAF", "low")]), baseConfig);
  assert.equal(result.summary.mediumOrAboveAxes, 1);
});

test("23 CLI writes json output on success", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tag-escalation-"));
  const inputPath = path.join(tmpDir, "input.json");
  const configPath = path.join(tmpDir, "config.json");
  const outputPath = path.join(tmpDir, "result.json");

  fs.writeFileSync(inputPath, JSON.stringify(input([event("TAG_FCT", "low")]), null, 2));
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2));

  execFileSync(
    "node",
    [
      "scripts/tag-escalation.mjs",
      "--input",
      inputPath,
      "--config",
      configPath,
      "--output",
      outputPath
    ],
    {
      cwd: process.cwd(),
      stdio: "pipe"
    }
  );

  const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(output.decisionLevel, "LOW");
});

test("24 CLI returns non-zero on blocking findings", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tag-escalation-"));
  const inputPath = path.join(tmpDir, "input.json");
  const configPath = path.join(tmpDir, "config.json");

  fs.writeFileSync(inputPath, JSON.stringify({ events: null }, null, 2));
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2));

  assert.throws(
    () =>
      execFileSync(
        "node",
        ["scripts/tag-escalation.mjs", "--input", inputPath, "--config", configPath],
        {
          cwd: process.cwd(),
          stdio: "pipe"
        }
      ),
    /Command failed/
  );
});

test("25 CLI emits markdown when format markdown is selected", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tag-escalation-"));
  const inputPath = path.join(tmpDir, "input.json");
  const configPath = path.join(tmpDir, "config.json");
  const outputPath = path.join(tmpDir, "result.md");

  fs.writeFileSync(inputPath, JSON.stringify(input([event("TAG_FCT", "low")]), null, 2));
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2));

  execFileSync(
    "node",
    [
      "scripts/tag-escalation.mjs",
      "--input",
      inputPath,
      "--config",
      configPath,
      "--output",
      outputPath,
      "--format",
      "markdown"
    ],
    {
      cwd: process.cwd(),
      stdio: "pipe"
    }
  );

  const markdown = fs.readFileSync(outputPath, "utf8");
  assert.ok(markdown.includes("# Tag Escalation Result"));
});

test("26 computes DEVIATE decision for deviate threshold", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "medium", 3)]),
    { ...baseConfig, conservativeRules: { ...baseConfig.conservativeRules, multiAxisMediumToHigh: 3 } }
  );
  assert.equal(result.summary.totalScore, 6);
  assert.equal(result.summary.baseLevel, "DEVIATE");
  assert.equal(result.decisionLevel, "DEVIATE");
});

test("27 DEVIATE is between MEDIUM and HIGH in rank", () => {
  const noMultiAxis = { ...baseConfig, conservativeRules: { ...baseConfig.conservativeRules, multiAxisMediumToHigh: 4 } };
  const resultMedium = evaluateTagEscalation(
    input([event("TAG_SAF", "medium"), event("TAG_CTX", "medium")]),
    noMultiAxis
  );
  const resultDeviate = evaluateTagEscalation(
    input([event("TAG_FCT", "medium", 3)]),
    noMultiAxis
  );
  const resultHigh = evaluateTagEscalation(
    input([event("TAG_SAF", "high"), event("TAG_CTX", "high")]),
    baseConfig
  );
  assert.equal(resultMedium.decisionLevel, "MEDIUM");
  assert.equal(resultDeviate.decisionLevel, "DEVIATE");
  assert.equal(resultHigh.decisionLevel, "HIGH");
});

test("28 conservative no-downgrade keeps DEVIATE from previous state", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "low")], { level: "DEVIATE", stableRounds: 0 }),
    baseConfig
  );
  assert.equal(result.decisionLevel, "DEVIATE");
  assert.equal(result.summary.nextStableRounds, 1);
});

test("29 transition from MEDIUM to DEVIATE on score increase", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "medium", 3)], { level: "MEDIUM", stableRounds: 0 }),
    { ...baseConfig, conservativeRules: { ...baseConfig.conservativeRules, multiAxisMediumToHigh: 3 } }
  );
  assert.equal(result.decisionLevel, "DEVIATE");
});

test("30 transition from DEVIATE to HIGH on further escalation", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_SAF", "high"), event("TAG_CTX", "high")], { level: "DEVIATE", stableRounds: 0 }),
    baseConfig
  );
  assert.equal(result.decisionLevel, "HIGH");
});

test("31 invalid deviate threshold range triggers finding", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), {
    ...baseConfig,
    thresholds: { medium: 4, deviate: 3, high: 8 }
  });
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(hasFinding(result, "config-thresholds-range-invalid"));
});

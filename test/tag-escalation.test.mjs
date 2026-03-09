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

// --- Per-axis weight verification ---

test("32 TAG_FCT weight 1.0 applied correctly", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), baseConfig);
  assert.equal(result.contributions[0].weight, 1.0);
  assert.equal(result.contributions[0].weightedScore, 1.0);
});

test("33 TAG_SAF weight 1.4 applied correctly", () => {
  const result = evaluateTagEscalation(input([event("TAG_SAF", "low")]), baseConfig);
  assert.equal(result.contributions[0].weight, 1.4);
  assert.equal(result.contributions[0].weightedScore, 1.4);
});

test("34 TAG_CTX weight 1.1 applied correctly", () => {
  const result = evaluateTagEscalation(input([event("TAG_CTX", "low")]), baseConfig);
  assert.equal(result.contributions[0].weight, 1.1);
  assert.equal(result.contributions[0].weightedScore, 1.1);
});

test("35 TAG_SYS weight 0.9 applied correctly", () => {
  const result = evaluateTagEscalation(input([event("TAG_SYS", "low")]), baseConfig);
  assert.equal(result.contributions[0].weight, 0.9);
  assert.equal(result.contributions[0].weightedScore, 0.9);
});

// --- Per-severity score verification ---

test("36 severity low scores 1", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), baseConfig);
  assert.equal(result.contributions[0].severityScore, 1);
});

test("37 severity medium scores 2", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "medium")]), baseConfig);
  assert.equal(result.contributions[0].severityScore, 2);
});

test("38 severity high scores 4", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "high")]), baseConfig);
  assert.equal(result.contributions[0].severityScore, 4);
});

test("39 severity critical scores 6", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "critical")]), baseConfig);
  assert.equal(result.contributions[0].severityScore, 6);
});

// --- Zero-weight axis ---

test("40 zero-weight axis produces zero contribution", () => {
  const result = evaluateTagEscalation(input([event("TAG_SYS", "high")]), {
    ...baseConfig,
    weights: { ...baseConfig.weights, TAG_SYS: 0 }
  });
  assert.equal(result.contributions[0].weightedScore, 0);
  assert.equal(result.summary.totalScore, 0);
});

// --- Empty events ---

test("41 empty events array returns LOW with zero score", () => {
  const result = evaluateTagEscalation(input([]), baseConfig);
  assert.equal(result.decisionLevel, "LOW");
  assert.equal(result.summary.totalScore, 0);
  assert.equal(result.summary.eventCount, 0);
});

// --- Default config fallback ---

test("42 null config uses defaults without error", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), null);
  assert.equal(result.decisionLevel, "LOW");
  assert.equal(result.findings.filter((item) => item.blocking).length, 0);
});

test("43 undefined config uses defaults without error", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]));
  assert.equal(result.decisionLevel, "LOW");
  assert.equal(result.findings.filter((item) => item.blocking).length, 0);
});

// --- Invalid previousState types handled gracefully ---

test("44 previousState as array is treated as no state", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")], []), baseConfig);
  assert.equal(result.decisionLevel, "LOW");
});

test("45 previousState as string is treated as no state", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")], "HIGH"), baseConfig);
  assert.equal(result.decisionLevel, "LOW");
});

test("46 previousState as number is treated as no state", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")], 42), baseConfig);
  assert.equal(result.decisionLevel, "LOW");
});

test("47 previousState as null is treated as no state", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")], null), baseConfig);
  assert.equal(result.decisionLevel, "LOW");
});

// --- Previous state edge cases ---

test("48 negative stableRounds clamped to 0", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "low")], { level: "HIGH", stableRounds: -5 }),
    baseConfig
  );
  assert.equal(result.decisionLevel, "HIGH");
  assert.equal(result.summary.nextStableRounds, 1);
});

test("49 unknown previousState level is ignored", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "low")], { level: "EXTREME", stableRounds: 0 }),
    baseConfig
  );
  assert.equal(result.decisionLevel, "LOW");
});

test("50 previousState level is case-insensitive", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "low")], { level: "high", stableRounds: 0 }),
    baseConfig
  );
  assert.equal(result.decisionLevel, "HIGH");
});

// --- Reason field preservation ---

test("51 reason field preserved in contributions", () => {
  const result = evaluateTagEscalation(
    { events: [{ axis: "TAG_FCT", severity: "low", count: 1, reason: "test reason" }] },
    baseConfig
  );
  assert.equal(result.contributions[0].reason, "test reason");
});

test("52 missing reason field becomes null", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), baseConfig);
  assert.equal(result.contributions[0].reason, null);
});

// --- Count defaults ---

test("53 event with undefined count defaults to 1", () => {
  const result = evaluateTagEscalation(
    { events: [{ axis: "TAG_FCT", severity: "low" }] },
    baseConfig
  );
  assert.equal(result.contributions[0].count, 1);
  assert.equal(result.summary.totalScore, 1.0);
});

// --- Multi-axis escalation boundary ---

test("54 multi-axis escalation with exactly threshold count triggers", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "medium"), event("TAG_CTX", "medium")]),
    {
      ...baseConfig,
      thresholds: { medium: 20, deviate: 30, high: 40 },
      conservativeRules: { ...baseConfig.conservativeRules, multiAxisMediumToHigh: 2 }
    }
  );
  assert.equal(result.decisionLevel, "HIGH");
});

test("55 multi-axis escalation below threshold does not trigger", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "medium")]),
    {
      ...baseConfig,
      thresholds: { medium: 20, deviate: 30, high: 40 },
      conservativeRules: { ...baseConfig.conservativeRules, multiAxisMediumToHigh: 2 }
    }
  );
  assert.equal(result.decisionLevel, "LOW");
});

test("56 multi-axis counts only medium-or-above severity axes", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "low"), event("TAG_CTX", "medium")]),
    {
      ...baseConfig,
      thresholds: { medium: 20, deviate: 30, high: 40 },
      conservativeRules: { ...baseConfig.conservativeRules, multiAxisMediumToHigh: 2 }
    }
  );
  assert.equal(result.decisionLevel, "LOW");
  assert.equal(result.summary.mediumOrAboveAxes, 1);
});

// --- Critical escalation when already at HIGH ---

test("57 critical escalation when already at HIGH is no-op", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_SAF", "critical"), event("TAG_CTX", "critical")]),
    baseConfig
  );
  assert.equal(result.decisionLevel, "HIGH");
});

// --- Contributions structure ---

test("58 contributions array has correct length and fields", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "low"), event("TAG_SAF", "high")]),
    baseConfig
  );
  assert.equal(result.contributions.length, 2);
  assert.equal(result.contributions[0].index, 0);
  assert.equal(result.contributions[0].axis, "TAG_FCT");
  assert.equal(result.contributions[1].index, 1);
  assert.equal(result.contributions[1].axis, "TAG_SAF");
});

// --- generatedAt format ---

test("59 generatedAt is ISO date string", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), baseConfig);
  assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

// --- Config field present ---

test("60 result contains config field", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), baseConfig);
  assert.ok(result.config);
  assert.equal(result.config.weights.TAG_FCT, 1.0);
});

// --- Deterministic output ---

test("61 same input produces identical output except timestamps", () => {
  const inp = input([event("TAG_FCT", "medium"), event("TAG_SAF", "high")]);
  const a = evaluateTagEscalation(inp, baseConfig);
  const b = evaluateTagEscalation(inp, baseConfig);
  assert.equal(a.decisionLevel, b.decisionLevel);
  assert.equal(a.summary.totalScore, b.summary.totalScore);
  assert.deepEqual(
    a.contributions.map((item) => item.weightedScore),
    b.contributions.map((item) => item.weightedScore)
  );
});

// --- Input validation edge cases ---

test("62 null event in array triggers invalid event finding", () => {
  const result = evaluateTagEscalation({ events: [null] }, baseConfig);
  assert.ok(hasFinding(result, "input-event-invalid"));
});

test("63 array event in events triggers invalid event finding", () => {
  const result = evaluateTagEscalation({ events: [[1, 2]] }, baseConfig);
  assert.ok(hasFinding(result, "input-event-invalid"));
});

test("64 non-string axis triggers axis invalid finding", () => {
  const result = evaluateTagEscalation({ events: [{ axis: 123, severity: "low", count: 1 }] }, baseConfig);
  assert.ok(hasFinding(result, "input-event-axis-invalid"));
});

test("65 non-string severity triggers severity invalid finding", () => {
  const result = evaluateTagEscalation({ events: [{ axis: "TAG_FCT", severity: 999, count: 1 }] }, baseConfig);
  assert.ok(hasFinding(result, "input-event-severity-invalid"));
});

test("66 fractional count triggers count invalid finding", () => {
  const result = evaluateTagEscalation({ events: [{ axis: "TAG_FCT", severity: "low", count: 1.5 }] }, baseConfig);
  assert.ok(hasFinding(result, "input-event-count-invalid"));
});

test("67 negative count triggers count invalid finding", () => {
  const result = evaluateTagEscalation({ events: [{ axis: "TAG_FCT", severity: "low", count: -1 }] }, baseConfig);
  assert.ok(hasFinding(result, "input-event-count-invalid"));
});

// --- Config validation edge cases ---

test("68 NaN weight triggers config invalid finding", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), {
    ...baseConfig,
    weights: { ...baseConfig.weights, TAG_SAF: "abc" }
  });
  assert.ok(hasFinding(result, "config-weights.TAG_SAF-invalid"));
});

test("69 Infinity threshold triggers config invalid finding", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), {
    ...baseConfig,
    thresholds: { medium: Infinity, deviate: 6, high: 8 }
  });
  assert.ok(hasFinding(result, "config-thresholds.medium-invalid"));
});

test("70 negative severity score triggers config invalid finding", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), {
    ...baseConfig,
    severityScores: { ...baseConfig.severityScores, medium: -2 }
  });
  assert.ok(hasFinding(result, "config-severityScores.medium-invalid"));
});

test("71 non-integer multiAxisMediumToHigh triggers config invalid finding", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), {
    ...baseConfig,
    conservativeRules: { ...baseConfig.conservativeRules, multiAxisMediumToHigh: 2.5 }
  });
  assert.ok(hasFinding(result, "config-conservativeRules.multiAxisMediumToHigh-invalid"));
});

// --- Blocking findings force safe HIGH ---

test("72 blocking finding from invalid events forces HIGH", () => {
  const result = evaluateTagEscalation({ events: null }, baseConfig);
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(result.trace.some((item) => item.step === "fallback-safe-level"));
});

// --- Score computation with multiple events ---

test("73 total score is sum of all weighted contributions", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "low"), event("TAG_SAF", "medium"), event("TAG_CTX", "high", 2)]),
    baseConfig
  );
  const expected = Number(((1.0 * 1 * 1) + (1.4 * 2 * 1) + (1.1 * 4 * 2)).toFixed(6));
  assert.equal(result.summary.totalScore, expected);
});

// --- Severity case insensitivity ---

test("74 severity is case-insensitive", () => {
  const result = evaluateTagEscalation(
    { events: [{ axis: "TAG_FCT", severity: "LOW", count: 1 }] },
    baseConfig
  );
  assert.equal(result.contributions.length, 1);
  assert.equal(result.contributions[0].severity, "low");
});

// --- All level transitions via thresholds ---

test("75 score at exact medium threshold produces MEDIUM", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "medium", 2)]), {
    ...baseConfig,
    conservativeRules: { ...baseConfig.conservativeRules, multiAxisMediumToHigh: 4 }
  });
  assert.equal(result.summary.totalScore, 4);
  assert.equal(result.summary.baseLevel, "MEDIUM");
});

test("76 score at exact high threshold produces HIGH", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "high", 2)]), baseConfig);
  assert.equal(result.summary.totalScore, 8);
  assert.equal(result.summary.baseLevel, "HIGH");
});

test("77 score just below medium threshold produces LOW", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low", 3)]), baseConfig);
  assert.equal(result.summary.totalScore, 3);
  assert.equal(result.summary.baseLevel, "LOW");
});

// --- stableRounds increment logic ---

test("78 stableRounds increments each frozen round", () => {
  const r1 = evaluateTagEscalation(
    input([event("TAG_FCT", "low")], { level: "HIGH", stableRounds: 0 }),
    baseConfig
  );
  assert.equal(r1.summary.nextStableRounds, 1);

  const r2 = evaluateTagEscalation(
    input([event("TAG_FCT", "low")], { level: "HIGH", stableRounds: 1 }),
    baseConfig
  );
  assert.equal(r2.summary.nextStableRounds, 2);
});

test("79 stableRounds resets to 0 when level matches or escalates", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_SAF", "high"), event("TAG_CTX", "high")], { level: "HIGH", stableRounds: 5 }),
    baseConfig
  );
  assert.equal(result.summary.nextStableRounds, 0);
});

// --- CLI edge cases ---

test("80 CLI with --format both writes json and markdown", () => {
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
      "--input", inputPath,
      "--config", configPath,
      "--output", outputPath,
      "--format", "both"
    ],
    { cwd: process.cwd(), stdio: "pipe" }
  );

  assert.ok(fs.existsSync(outputPath));
  assert.ok(fs.existsSync(`${outputPath}.md`));
  const json = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(json.decisionLevel, "LOW");
  const md = fs.readFileSync(`${outputPath}.md`, "utf8");
  assert.ok(md.includes("# Tag Escalation Result"));
});

test("81 CLI missing --input exits with code 2", () => {
  assert.throws(
    () => execFileSync("node", ["scripts/tag-escalation.mjs"], { cwd: process.cwd(), stdio: "pipe" }),
    (err) => err.status === 2
  );
});

// --- Summary field completeness ---

test("82 summary contains all expected fields", () => {
  const result = evaluateTagEscalation(input([event("TAG_FCT", "low")]), baseConfig);
  const keys = Object.keys(result.summary);
  assert.ok(keys.includes("eventCount"));
  assert.ok(keys.includes("distinctAxes"));
  assert.ok(keys.includes("criticalEvents"));
  assert.ok(keys.includes("mediumOrAboveAxes"));
  assert.ok(keys.includes("totalScore"));
  assert.ok(keys.includes("baseLevel"));
  assert.ok(keys.includes("finalLevel"));
  assert.ok(keys.includes("nextStableRounds"));
  assert.ok(keys.includes("blockingFindings"));
});

// --- Multiple blocking findings ---

test("83 multiple invalid events produce multiple findings", () => {
  const result = evaluateTagEscalation({ events: [null, "bad", { axis: "NOPE", severity: "low" }] }, baseConfig);
  assert.ok(result.findings.length >= 3);
});

// --- Mixed valid and invalid events ---

test("84 valid events processed despite some invalid ones", () => {
  const result = evaluateTagEscalation(
    { events: [{ axis: "TAG_FCT", severity: "low", count: 1 }, null] },
    baseConfig
  );
  assert.equal(result.contributions.length, 1);
  assert.equal(result.contributions[0].axis, "TAG_FCT");
});

// --- Axis trimming ---

test("85 axis with whitespace is trimmed", () => {
  const result = evaluateTagEscalation(
    { events: [{ axis: " TAG_FCT ", severity: "low", count: 1 }] },
    baseConfig
  );
  assert.equal(result.contributions.length, 1);
  assert.equal(result.contributions[0].axis, "TAG_FCT");
});

// --- Conservative freeze trace ---

test("86 conservative no-downgrade adds trace step", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "low")], { level: "HIGH", stableRounds: 0 }),
    baseConfig
  );
  assert.ok(result.trace.some((item) => item.step === "conservative-no-downgrade"));
});

test("87 conservative downgrade allowed adds trace step", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "low")], { level: "HIGH", stableRounds: 2 }),
    baseConfig
  );
  assert.ok(result.trace.some((item) => item.step === "conservative-downgrade-allowed"));
});

// --- Downgrade from MEDIUM after stable rounds ---

test("88 downgrade from MEDIUM after stable rounds", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "low")], { level: "MEDIUM", stableRounds: 2 }),
    baseConfig
  );
  assert.equal(result.decisionLevel, "LOW");
});

// --- HIGH events with multi-axis rule ---

test("89 multi-axis escalation with high severity events", () => {
  const result = evaluateTagEscalation(
    input([event("TAG_FCT", "high"), event("TAG_SAF", "high")]),
    {
      ...baseConfig,
      thresholds: { medium: 100, deviate: 200, high: 300 },
      conservativeRules: { ...baseConfig.conservativeRules, multiAxisMediumToHigh: 2 }
    }
  );
  assert.equal(result.decisionLevel, "HIGH");
  assert.ok(result.trace.some((item) => item.step === "conservative-multi-axis"));
});

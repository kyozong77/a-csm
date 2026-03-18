import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAcsmOrchestrator } from "../scripts/acsm-orchestrator.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(TEST_DIR, "fixtures", "ground-truth");
const CONFIG_PATH = path.join(TEST_DIR, "..", "config", "acsm-orchestrator.json");

const REPORT_STATUS_ORDER = Object.freeze({
  Normal: 1,
  Observe: 2,
  Deviate: 3,
  Alert: 4
});

const SEVERITY_ORDER = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const configTemplate = readJson(CONFIG_PATH);
const resultCache = new Map();
const inputCache = new Map();

function buildBaseConfig() {
  const config = clone(configTemplate);
  config.releaseGate.requiredChecks = ["tests"];
  config.releaseGate.requiredArtifacts = [];
  config.releaseGate.maxHighPriorityOpen = 99;
  config.releaseGate.maxCriticalSecurity = 99;
  config.releaseGate.maxOpenIncidents = 99;
  return config;
}

function loadFixtureInput(baseName) {
  if (!inputCache.has(baseName)) {
    inputCache.set(baseName, readJson(path.join(FIXTURE_DIR, `${baseName}.input.json`)));
  }
  return clone(inputCache.get(baseName));
}

function getFixtureResult(baseName) {
  if (!resultCache.has(baseName)) {
    resultCache.set(baseName, runAcsmOrchestrator(loadFixtureInput(baseName), buildBaseConfig()));
  }
  return resultCache.get(baseName);
}

function deriveStabilityIndex(turnCount, unifiedEvents, severityCounts, escalatedRows, blockingFindings) {
  const safeTurnCount = Math.max(1, turnCount);
  const eventPressure = (unifiedEvents / safeTurnCount) * 32;
  const severityPressure = severityCounts.high * 7 + severityCounts.critical * 12;
  const repeatPressure = escalatedRows * 10;
  const blockingPressure = blockingFindings * 8;
  const raw = 100 - eventPressure - severityPressure - repeatPressure - blockingPressure;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function deriveConfidenceInterval(score, eventCount) {
  const normalizedScore = Number.isFinite(score) ? score : 0;
  const margin = eventCount > 0
    ? Math.max(0.25, Math.min(1, 1 / Math.sqrt(eventCount)))
    : 0.25;

  return {
    lower: Number(Math.max(0, normalizedScore - margin).toFixed(2)),
    upper: Number(Math.min(4, normalizedScore + margin).toFixed(2)),
    unit: "risk_score_0_to_4"
  };
}

function mapPsToReportStatus(ps) {
  if (ps === "ST_ALM") {
    return "Alert";
  }
  if (ps === "ST_DEV") {
    return "Deviate";
  }
  return "Normal";
}

function mapTagLevelToReportStatus(level) {
  if (level === "HIGH") {
    return "Alert";
  }
  if (level === "MEDIUM") {
    return "Observe";
  }
  return "Normal";
}

function mapVcdToReportStatus(status) {
  if (status === "LOCKDOWN") {
    return "Alert";
  }
  if (status === "TRIGGERED") {
    return "Deviate";
  }
  if (status === "GUARDED") {
    return "Observe";
  }
  return "Normal";
}

function mapHighestSeverityToReportStatus(unifiedEvents) {
  const highestSeverity = unifiedEvents.reduce((current, event) => {
    const currentRank = SEVERITY_ORDER[current] ?? 0;
    const candidateRank = SEVERITY_ORDER[event.severity] ?? 0;
    return candidateRank > currentRank ? event.severity : current;
  }, "low");

  if (highestSeverity === "critical") {
    return "Alert";
  }
  if (highestSeverity === "high") {
    return "Deviate";
  }
  if ((highestSeverity === "medium" || highestSeverity === "low") && unifiedEvents.length > 0) {
    return "Observe";
  }
  return "Normal";
}

function maxReportStatus(...statuses) {
  return statuses.reduce((current, candidate) => {
    const currentRank = REPORT_STATUS_ORDER[current] ?? 0;
    const candidateRank = REPORT_STATUS_ORDER[candidate] ?? 0;
    return candidateRank > currentRank ? candidate : current;
  }, "Normal");
}

function computeRiskStatus(ps, tagLevel, vcdStatus, unifiedEvents) {
  let status = maxReportStatus(
    mapPsToReportStatus(ps),
    mapTagLevelToReportStatus(tagLevel),
    mapVcdToReportStatus(vcdStatus),
    mapHighestSeverityToReportStatus(unifiedEvents)
  );
  if (status === "Normal" && unifiedEvents.length > 0) {
    status = "Observe";
  }
  return status;
}

function computePeakStatus(riskStatus, unifiedEvents, escalatedRows) {
  return maxReportStatus(
    riskStatus,
    mapHighestSeverityToReportStatus(unifiedEvents),
    escalatedRows > 0 ? "Deviate" : "Normal"
  );
}

describe("stability_index", () => {
  const cases = [
    {
      name: "zero events returns 100",
      args: [2, 0, { high: 0, critical: 0 }, 0, 0],
      expected: 100
    },
    {
      name: "one event across one turn subtracts 32 points",
      args: [1, 1, { high: 0, critical: 0 }, 0, 0],
      expected: 68
    },
    {
      name: "ten events across five turns returns 36",
      args: [5, 10, { high: 0, critical: 0 }, 0, 0],
      expected: 36
    },
    {
      name: "one high severity event costs 7 points",
      args: [10, 0, { high: 1, critical: 0 }, 0, 0],
      expected: 93
    },
    {
      name: "one critical severity event costs 12 points",
      args: [10, 0, { high: 0, critical: 1 }, 0, 0],
      expected: 88
    },
    {
      name: "overflow clamps at zero",
      args: [1, 20, { high: 4, critical: 4 }, 3, 5],
      expected: 0
    },
    {
      name: "combined pressures round to the expected value",
      args: [4, 3, { high: 2, critical: 1 }, 1, 1],
      expected: 32
    },
    {
      name: "zero turns still uses safeTurnCount of one",
      args: [0, 1, { high: 0, critical: 0 }, 0, 0],
      expected: 68
    }
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      assert.equal(deriveStabilityIndex(...testCase.args), testCase.expected);
    });
  }
});

describe("confidence_interval", () => {
  const cases = [
    {
      name: "score 0 with no events stays within 0 to 0.25",
      args: [0, 0],
      expected: { lower: 0, upper: 0.25, unit: "risk_score_0_to_4" }
    },
    {
      name: "score 2 with one event expands to 1 through 3",
      args: [2, 1],
      expected: { lower: 1, upper: 3, unit: "risk_score_0_to_4" }
    },
    {
      name: "score 4 with one hundred events clamps the upper bound at 4",
      args: [4, 100],
      expected: { lower: 3.75, upper: 4, unit: "risk_score_0_to_4" }
    },
    {
      name: "score 0 with four events yields a 0.5 upper bound",
      args: [0, 4],
      expected: { lower: 0, upper: 0.5, unit: "risk_score_0_to_4" }
    },
    {
      name: "NaN score normalizes to zero",
      args: [Number.NaN, 2],
      expected: { lower: 0, upper: 0.71, unit: "risk_score_0_to_4" }
    },
    {
      name: "upper bound never exceeds four",
      args: [3.9, 16],
      expected: { lower: 3.65, upper: 4, unit: "risk_score_0_to_4" }
    }
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      assert.deepEqual(deriveConfidenceInterval(...testCase.args), testCase.expected);
    });
  }
});

describe("risk_status mapping", () => {
  const cases = [
    { name: "PS ST_ALM maps to Alert", actual: mapPsToReportStatus("ST_ALM"), expected: "Alert" },
    { name: "PS ST_DEV maps to Deviate", actual: mapPsToReportStatus("ST_DEV"), expected: "Deviate" },
    { name: "PS ST_NRM maps to Normal", actual: mapPsToReportStatus("ST_NRM"), expected: "Normal" },
    { name: "TAG HIGH maps to Alert", actual: mapTagLevelToReportStatus("HIGH"), expected: "Alert" },
    { name: "TAG MEDIUM maps to Observe", actual: mapTagLevelToReportStatus("MEDIUM"), expected: "Observe" },
    { name: "TAG unknown maps to Normal", actual: mapTagLevelToReportStatus("LOW"), expected: "Normal" },
    { name: "VCD LOCKDOWN maps to Alert", actual: mapVcdToReportStatus("LOCKDOWN"), expected: "Alert" },
    { name: "VCD TRIGGERED maps to Deviate", actual: mapVcdToReportStatus("TRIGGERED"), expected: "Deviate" },
    { name: "VCD GUARDED maps to Observe", actual: mapVcdToReportStatus("GUARDED"), expected: "Observe" },
    {
      name: "critical unified event maps to Alert",
      actual: mapHighestSeverityToReportStatus([{ severity: "critical" }]),
      expected: "Alert"
    },
    {
      name: "high unified event maps to Deviate",
      actual: mapHighestSeverityToReportStatus([{ severity: "high" }]),
      expected: "Deviate"
    },
    {
      name: "otherwise Normal with events uplifts to Observe",
      actual: computeRiskStatus("ST_NRM", "LOW", "CLEAR", [{ severity: "low" }]),
      expected: "Observe"
    }
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      assert.equal(testCase.actual, testCase.expected);
    });
  }
});

describe("peak_status", () => {
  const cases = [
    { name: "clean case remains Normal", baseName: "case-001-clean-faq" },
    { name: "observe case remains Observe", baseName: "case-005-mild-drift-context-shift" },
    { name: "alert case remains Alert", baseName: "case-019-mixed-multi-axis-alert" },
    { name: "repeat case matches computed peak", baseName: "case-020-mixed-gradual-drift-repeat" }
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = getFixtureResult(testCase.baseName);
      const expected = computePeakStatus(
        result.report.risk_status,
        result.derived.unifiedEvents,
        result.steps.ledger.summary?.escalatedRows ?? 0
      );
      assert.equal(result.report.peak_status, expected);
      assert.ok(
        REPORT_STATUS_ORDER[result.report.peak_status] >= REPORT_STATUS_ORDER[result.report.risk_status]
      );
    });
  }
});

describe("digital_fingerprint", () => {
  it("same input produces the same fingerprint", () => {
    const input = loadFixtureInput("case-001-clean-faq");
    const config = buildBaseConfig();
    const a = runAcsmOrchestrator(input, config);
    const b = runAcsmOrchestrator(loadFixtureInput("case-001-clean-faq"), buildBaseConfig());
    assert.equal(a.report.digital_fingerprint, b.report.digital_fingerprint);
  });

  it("different inputs produce different fingerprints", () => {
    const a = getFixtureResult("case-001-clean-faq");
    const b = getFixtureResult("case-002-clean-tech-support");
    assert.notEqual(a.report.digital_fingerprint, b.report.digital_fingerprint);
  });

  it("fingerprint format is 64-character hex", () => {
    const result = getFixtureResult("case-019-mixed-multi-axis-alert");
    assert.match(result.report.digital_fingerprint, /^[a-f0-9]{64}$/);
  });
});

describe("rule_version", () => {
  it("includes the schema version string", () => {
    const result = getFixtureResult("case-001-clean-faq");
    assert.equal(result.report.rule_version.schema, "1.0.0");
  });

  it("reports 43 event-engine rules", () => {
    const result = getFixtureResult("case-001-clean-faq");
    assert.equal(result.report.rule_version.event_engine_rules, 43);
  });

  it("reports 20 VCD matrix rules", () => {
    const result = getFixtureResult("case-001-clean-faq");
    assert.equal(result.report.rule_version.vcd_matrix_rules, 20);
  });
});

describe("human_review_note", () => {
  it("contains the Chinese human-review phrase", () => {
    const result = getFixtureResult("case-001-clean-faq");
    assert.ok(result.report.human_review_note.includes("人類專業者"));
  });

  it("contains the English qualified-professionals phrase", () => {
    const result = getFixtureResult("case-001-clean-faq");
    assert.ok(result.report.human_review_note.includes("qualified professionals"));
  });
});

describe("evidence_list", () => {
  it("is empty when no events are present", () => {
    const result = getFixtureResult("case-001-clean-faq");
    assert.deepEqual(result.report.evidence_list, []);
  });

  it("is sorted by severity with the critical item first", () => {
    const result = getFixtureResult("case-019-mixed-multi-axis-alert");
    assert.deepEqual(result.report.evidence_list.map((item) => item.axis), ["SR", "FR", "CA"]);
  });

  it("each evidence item exposes axis, turnId, and summary", () => {
    const result = getFixtureResult("case-011-boundary-role-conflict");
    for (const item of result.report.evidence_list) {
      assert.equal(typeof item.axis, "string");
      assert.equal(typeof item.turnId, "string");
      assert.equal(typeof item.summary, "string");
      assert.ok(item.summary.length > 0);
    }
  });

  it("count matches the unified event count", () => {
    const result = getFixtureResult("case-020-mixed-gradual-drift-repeat");
    assert.equal(result.report.evidence_list.length, result.derived.unifiedEvents.length);
  });
});

describe("event_evidence_map", () => {
  it("is empty when there are no events", () => {
    const result = getFixtureResult("case-001-clean-faq");
    assert.deepEqual(result.report.event_evidence_map, {});
  });

  it("keys match the unified event ids", () => {
    const result = getFixtureResult("case-019-mixed-multi-axis-alert");
    assert.deepEqual(
      Object.keys(result.report.event_evidence_map).sort(),
      result.derived.unifiedEvents.map((event) => event.eventId).sort()
    );
  });

  it("values reference evidence summaries from the report", () => {
    const result = getFixtureResult("case-011-boundary-role-conflict");
    const evidenceSummaries = new Set(result.report.evidence_list.map((item) => item.summary));
    for (const value of Object.values(result.report.event_evidence_map)) {
      assert.ok(evidenceSummaries.has(value.summary));
    }
  });
});

describe("false_positive_warnings", () => {
  it("is empty when no warnings are present", () => {
    const result = getFixtureResult("case-001-clean-faq");
    assert.deepEqual(result.report.false_positive_warnings, []);
  });

  it("only includes warning-level findings", () => {
    const config = buildBaseConfig();
    config.releaseGate.maxHighPriorityOpen = 2;
    config.releaseGate.warningHighPriorityOpenAt = 1;
    const result = runAcsmOrchestrator(loadFixtureInput("case-010-boundary-bypass-attempt"), config);
    assert.ok(result.report.false_positive_warnings.length > 0);
    assert.ok(result.report.false_positive_warnings.every((item) => item.severity === "warning"));
  });

  it("does not include error-level findings", () => {
    const config = buildBaseConfig();
    config.releaseGate.maxHighPriorityOpen = 0;
    const result = runAcsmOrchestrator(loadFixtureInput("case-010-boundary-bypass-attempt"), config);
    assert.equal(result.steps.releaseGate.findings.some((item) => item.id === "high-priority-open"), true);
    assert.equal(result.report.false_positive_warnings.some((item) => item.id === "high-priority-open"), false);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  REPORT_STATUS_ORDER,
  REPORT_STATUS_VALUES,
  validateReportConsistency
} from "../scripts/report-consistency-validator.mjs";

const HUMAN_REVIEW_NOTE =
  "所有風險判斷需人類專業者最終審查 / All risk assessments require final review by qualified professionals";

function buildValidReport() {
  return {
    risk_status: "Deviate",
    peak_status: "Alert",
    stability_index: 62,
    evidence_list: [
      {
        axis: "SR",
        turnId: "T2",
        summary: "self-harm hint detected"
      }
    ],
    false_positive_warnings: [],
    human_review_note: HUMAN_REVIEW_NOTE,
    event_evidence_map: {
      "SR_01@T2#1": {
        axis: "SR",
        severity: "critical",
        turn_id: "T2",
        turn_index: 1,
        source: "event-engine",
        rule_id: "SR_01",
        summary: "self-harm hint detected"
      }
    },
    confidence_interval: {
      lower: 2.75,
      upper: 3.25,
      unit: "risk_score_0_to_4"
    },
    digital_fingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    rule_version: {
      schema: "1.0.0",
      event_engine_rules: 43,
      vcd_matrix_rules: 20,
      mappings_version: "1.0.0"
    }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectError(report, pattern) {
  const result = validateReportConsistency(report);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((item) => item.includes(pattern)),
    `Expected an error containing "${pattern}", got: ${result.errors.join(" | ")}`
  );
}

describe("validateReportConsistency", () => {
  it("accepts a fully valid report", () => {
    const result = validateReportConsistency(buildValidReport());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects non-object report payloads", () => {
    const result = validateReportConsistency(null);
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, ["report must be an object"]);
  });

  it("exports frozen status helpers", () => {
    assert.equal(Object.isFrozen(REPORT_STATUS_ORDER), true);
    assert.equal(Object.isFrozen(REPORT_STATUS_VALUES), true);
    assert.deepEqual(REPORT_STATUS_VALUES, ["Normal", "Observe", "Deviate", "Alert"]);
  });

  it("rejects peak_status lower than risk_status", () => {
    const report = buildValidReport();
    report.risk_status = "Alert";
    report.peak_status = "Observe";
    expectError(report, "peak_status");
  });

  it("rejects stability_index above 100", () => {
    const report = buildValidReport();
    report.stability_index = 101;
    expectError(report, "stability_index");
  });

  it("rejects stability_index below 0", () => {
    const report = buildValidReport();
    report.stability_index = -1;
    expectError(report, "stability_index");
  });

  it("rejects non-integer stability_index", () => {
    const report = buildValidReport();
    report.stability_index = 62.5;
    expectError(report, "stability_index");
  });

  it("rejects invalid risk_status value", () => {
    const report = buildValidReport();
    report.risk_status = "Escalated";
    expectError(report, "risk_status");
  });

  it("rejects invalid peak_status value", () => {
    const report = buildValidReport();
    report.peak_status = "Escalated";
    expectError(report, "peak_status");
  });

  it("rejects lower greater than upper in confidence_interval", () => {
    const report = buildValidReport();
    report.confidence_interval.lower = 3.5;
    report.confidence_interval.upper = 2.5;
    expectError(report, "confidence_interval.lower must be <=");
  });

  it("rejects confidence_interval.lower below 0", () => {
    const report = buildValidReport();
    report.confidence_interval.lower = -0.1;
    expectError(report, "confidence_interval.lower");
  });

  it("rejects confidence_interval.upper above 4", () => {
    const report = buildValidReport();
    report.confidence_interval.upper = 4.1;
    expectError(report, "confidence_interval.upper");
  });

  it("rejects invalid confidence_interval unit", () => {
    const report = buildValidReport();
    report.confidence_interval.unit = "risk_score";
    expectError(report, "confidence_interval.unit");
  });

  it("rejects non-array evidence_list", () => {
    const report = buildValidReport();
    report.evidence_list = {};
    expectError(report, "evidence_list must be an array");
  });

  it("rejects non-array false_positive_warnings", () => {
    const report = buildValidReport();
    report.false_positive_warnings = {};
    expectError(report, "false_positive_warnings");
  });

  it("rejects human_review_note without required phrase", () => {
    const report = buildValidReport();
    report.human_review_note = "Need review";
    expectError(report, "human_review_note");
  });

  it("rejects digital_fingerprint with non-hex characters", () => {
    const report = buildValidReport();
    report.digital_fingerprint = `${"g".repeat(63)}z`;
    expectError(report, "digital_fingerprint");
  });

  it("rejects digital_fingerprint with wrong length", () => {
    const report = buildValidReport();
    report.digital_fingerprint = "abcd";
    expectError(report, "digital_fingerprint");
  });

  it("rejects rule_version without required fields", () => {
    const report = buildValidReport();
    report.rule_version = { schema: "", mappings_version: "1.0.0" };
    expectError(report, "rule_version");
  });

  it("accepts legacy rule_version field names", () => {
    const report = buildValidReport();
    report.rule_version = {
      schemaVersion: "1.0.0",
      eventEngineRules: 43,
      vcdRules: 20
    };

    const result = validateReportConsistency(report);
    assert.equal(result.valid, true);
  });

  it("rejects non-object event_evidence_map", () => {
    const report = buildValidReport();
    report.event_evidence_map = [];
    expectError(report, "event_evidence_map");
  });

  it("rejects Normal risk_status with more than minimal evidence", () => {
    const report = buildValidReport();
    report.risk_status = "Normal";
    report.peak_status = "Normal";
    report.evidence_list.push({
      axis: "CA",
      turnId: "T3",
      summary: "second evidence"
    });
    report.event_evidence_map["CA_01@T3#1"] = {
      axis: "CA",
      severity: "medium",
      turn_id: "T3",
      turn_index: 2,
      source: "event-engine",
      rule_id: "CA_01",
      summary: "second evidence"
    };
    expectError(report, "more than minimal evidence");
  });

  it("rejects Alert risk_status with stability_index >= 70", () => {
    const report = buildValidReport();
    report.risk_status = "Alert";
    report.stability_index = 70;
    expectError(report, "stability_index < 70");
  });

  it("rejects any evidence_list when risk_status is Normal", () => {
    const report = buildValidReport();
    report.risk_status = "Normal";
    report.peak_status = "Normal";
    expectError(report, "non-empty");
  });

  it("rejects mismatched evidence_list and event_evidence_map counts", () => {
    const report = buildValidReport();
    report.event_evidence_map = {};
    expectError(report, "entry count");
  });

  it("accumulates multiple consistency errors in a single result", () => {
    const report = clone(buildValidReport());
    report.peak_status = "Normal";
    report.risk_status = "Alert";
    report.confidence_interval.upper = 4.5;

    const result = validateReportConsistency(report);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 2);
  });
});

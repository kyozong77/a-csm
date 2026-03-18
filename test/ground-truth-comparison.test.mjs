import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAcsmOrchestrator } from "../scripts/acsm-orchestrator.mjs";
import { validateReportConsistency } from "../scripts/report-consistency-validator.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const GT_DIR = path.join(TEST_DIR, "fixtures", "ground-truth");
const CONFIG_PATH = path.join(TEST_DIR, "..", "config", "acsm-orchestrator.json");
const HUMAN_REVIEW_NOTE_FRAGMENT = "人類專業者";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function inspectGroundTruthCases() {
  if (!fs.existsSync(GT_DIR)) {
    return {
      ready: false,
      reason: "ground-truth directory does not exist yet",
      cases: []
    };
  }

  const entries = fs.readdirSync(GT_DIR).sort();
  const inputFiles = entries.filter((file) => file.endsWith(".input.json"));
  const expectedFiles = new Set(entries.filter((file) => file.endsWith(".expected.json")));
  const missingExpected = [];

  const cases = inputFiles.map((file) => {
    const baseName = file.slice(0, -".input.json".length);
    const expectedFile = `${baseName}.expected.json`;
    if (!expectedFiles.has(expectedFile)) {
      missingExpected.push(expectedFile);
      return null;
    }

    return {
      baseName,
      input: readJson(path.join(GT_DIR, file)),
      expected: readJson(path.join(GT_DIR, expectedFile))
    };
  }).filter(Boolean);

  if (inputFiles.length < 20) {
    return {
      ready: false,
      reason: `ground-truth inputs pending: found ${inputFiles.length}/20 input files`,
      cases
    };
  }

  if (missingExpected.length > 0) {
    return {
      ready: false,
      reason: `ground-truth expected files pending: missing ${missingExpected.join(", ")}`,
      cases
    };
  }

  return {
    ready: true,
    reason: null,
    cases
  };
}

const groundTruthState = inspectGroundTruthCases();

if (!groundTruthState.ready) {
  test("Ground Truth Comparison pending Stream A fixtures", { skip: groundTruthState.reason }, () => {});
} else {
  const config = readJson(CONFIG_PATH);
  const cases = groundTruthState.cases;
  const resultCache = new Map();

  function getResult(baseName, input) {
    if (!resultCache.has(baseName)) {
      resultCache.set(baseName, runAcsmOrchestrator(input, config));
    }
    return resultCache.get(baseName);
  }

  describe("Ground Truth Comparison", () => {
    for (const { baseName, input, expected } of cases) {
      const expectedReport = expected.expected ?? {};

      describe(baseName, () => {
        it("risk_status matches expected", () => {
          const result = getResult(baseName, input);
          assert.equal(result.report.risk_status, expectedReport.risk_status);
        });

        it("peak_status matches expected when declared", () => {
          if (expectedReport.peak_status === undefined) {
            return;
          }

          const result = getResult(baseName, input);
          assert.equal(result.report.peak_status, expectedReport.peak_status);
        });

        it("stability_index stays inside the expected range", () => {
          const result = getResult(baseName, input);
          assert.ok(
            result.report.stability_index >= expectedReport.stability_index_min,
            `stability_index ${result.report.stability_index} < min ${expectedReport.stability_index_min}`
          );
          assert.ok(
            result.report.stability_index <= expectedReport.stability_index_max,
            `stability_index ${result.report.stability_index} > max ${expectedReport.stability_index_max}`
          );
        });

        it("evidence count matches expected when declared", () => {
          if (expectedReport.evidence_count === undefined) {
            return;
          }

          const result = getResult(baseName, input);
          assert.equal(result.report.evidence_list.length, expectedReport.evidence_count);
        });

        it("false-positive warning count matches expected when declared", () => {
          const result = getResult(baseName, input);

          if (expectedReport.false_positive_count !== undefined) {
            assert.equal(result.report.false_positive_warnings.length, expectedReport.false_positive_count);
          }

          if (expectedReport.false_positive_count_max !== undefined) {
            assert.ok(
              result.report.false_positive_warnings.length <= expectedReport.false_positive_count_max,
              `false_positive_warnings ${result.report.false_positive_warnings.length} > max ${expectedReport.false_positive_count_max}`
            );
          }
        });

        it("confidence_interval stays within expected bounds when declared", () => {
          const result = getResult(baseName, input);

          if (expectedReport.confidence_interval_lower_max !== undefined) {
            assert.ok(
              result.report.confidence_interval.lower <= expectedReport.confidence_interval_lower_max,
              `confidence_interval.lower ${result.report.confidence_interval.lower} > max ${expectedReport.confidence_interval_lower_max}`
            );
          }

          if (expectedReport.confidence_interval_upper_max !== undefined) {
            assert.ok(
              result.report.confidence_interval.upper <= expectedReport.confidence_interval_upper_max,
              `confidence_interval.upper ${result.report.confidence_interval.upper} > max ${expectedReport.confidence_interval_upper_max}`
            );
          }
        });

        it("human_review_note contains the expected review phrase", () => {
          const result = getResult(baseName, input);
          const expectedFragment = expectedReport.human_review_note_contains ?? HUMAN_REVIEW_NOTE_FRAGMENT;
          assert.ok(result.report.human_review_note.includes(expectedFragment));
        });

        it("event_evidence_map count matches expected when declared", () => {
          if (expectedReport.event_count === undefined) {
            return;
          }

          const result = getResult(baseName, input);
          assert.equal(Object.keys(result.report.event_evidence_map).length, expectedReport.event_count);
        });

        it("full report remains internally consistent", () => {
          const result = getResult(baseName, input);
          const validation = validateReportConsistency(result.report);
          assert.equal(validation.valid, true, `${baseName}: ${validation.errors.join("; ")}`);
        });
      });
    }
  });

  describe("Ground Truth Accuracy Summary", () => {
    it("achieves >= 85% risk_status accuracy", () => {
      let correct = 0;

      for (const { baseName, input, expected } of cases) {
        const result = getResult(baseName, input);
        if (result.report.risk_status === expected.expected?.risk_status) {
          correct += 1;
        }
      }

      const total = cases.length;
      const accuracy = (correct / total) * 100;

      assert.ok(accuracy >= 85, `Ground truth accuracy ${accuracy.toFixed(2)}% < 85% threshold`);
    });
  });
}

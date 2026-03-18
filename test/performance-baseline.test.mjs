import test from "node:test";
import assert from "node:assert/strict";

import { buildRegressionSuite, calculateClassificationMetrics } from "../scripts/performance-baseline.mjs";

test("buildRegressionSuite compacts batch outputs", () => {
  const suite = buildRegressionSuite({
    results: [
      {
        id: "case-001",
        result: {
          report: { risk_status: "Normal", peak_status: "Normal" },
          summary: { vcdStatus: "CLEAR", tagDecisionLevel: "LOW", unifiedEventCount: 0, schemaDecision: "PASS", releaseGateDecision: "GO" }
        }
      }
    ]
  });
  assert.equal(suite.cases.length, 1);
  assert.equal(suite.cases[0].output.risk_status, "Normal");
});

test("calculateClassificationMetrics derives accuracy and error rates", () => {
  const baseline = {
    cases: [
      { id: "a", output: { risk_status: "Normal" } },
      { id: "b", output: { risk_status: "Alert" } }
    ]
  };
  const candidate = {
    cases: [
      { id: "a", output: { risk_status: "Observe" } },
      { id: "b", output: { risk_status: "Alert" } }
    ]
  };
  const metrics = calculateClassificationMetrics(baseline, candidate);
  assert.equal(metrics.total_cases, 2);
  assert.equal(metrics.accuracy, 0.5);
  assert.equal(metrics.false_positive_rate, 1);
  assert.equal(metrics.false_negative_rate, 0);
});

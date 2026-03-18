import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAcsmBatch } from "../scripts/acsm-batch-runner.mjs";
import { validateReportConsistency } from "../scripts/report-consistency-validator.mjs";
import {
  buildBatchPayload,
  EXPECTED_DISTRIBUTION,
  GENERATOR_SEED
} from "./fixtures/generate-batch-200.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_BATCH_PATH = path.join(ROOT_DIR, "config", "acsm-batch-input.200.generated.json");
const ORCHESTRATOR_CONFIG_PATH = path.join(ROOT_DIR, "config", "acsm-orchestrator.json");
const CANONICAL_REPORT_FIELDS = [
  "confidence_interval",
  "digital_fingerprint",
  "event_evidence_map",
  "evidence_list",
  "false_positive_warnings",
  "human_review_note",
  "peak_status",
  "risk_status",
  "rule_version",
  "stability_index"
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const committedBatchPayload = readJson(GENERATED_BATCH_PATH);
const orchestratorConfig = readJson(ORCHESTRATOR_CONFIG_PATH);

let cachedBatchResult;

function getBatchResult() {
  if (!cachedBatchResult) {
    cachedBatchResult = runAcsmBatch(structuredClone(committedBatchPayload), orchestratorConfig, {
      includeResults: true,
      maxCases: 200
    });
  }
  return cachedBatchResult;
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

test("01 deterministic generator matches committed 200-case fixture", () => {
  const generated = buildBatchPayload();

  assert.equal(generated.meta.seed, GENERATOR_SEED);
  assert.deepEqual(generated.meta.expectedDistribution, EXPECTED_DISTRIBUTION);
  assert.deepEqual(generated, committedBatchPayload);
});

test("02 committed fixture preserves 200 unique case ids and target distribution", () => {
  assert.equal(committedBatchPayload.cases.length, 200);

  const caseIds = committedBatchPayload.cases.map((item) => item.id);
  const uniqueCaseIds = new Set(caseIds);
  const distribution = countBy(caseIds, (id) => {
    if (id.startsWith("normal-")) {
      return "Normal";
    }
    if (id.startsWith("observe-")) {
      return "Observe";
    }
    if (id.startsWith("deviate-")) {
      return "Deviate";
    }
    if (id.startsWith("alert-")) {
      return "Alert";
    }
    return "Unknown";
  });

  assert.equal(uniqueCaseIds.size, 200);
  assert.deepEqual(distribution, EXPECTED_DISTRIBUTION);
});

test("03 each generated case keeps bounded turn counts and valid turn shape", () => {
  for (const item of committedBatchPayload.cases) {
    assert.ok(Array.isArray(item.input?.turns));
    assert.ok(item.input.turns.length >= 2);
    assert.ok(item.input.turns.length <= 8);

    for (const turn of item.input.turns) {
      assert.match(turn.id, /^T\d+$/);
      assert.match(turn.role, /^(user|assistant)$/);
      assert.equal(turn.sourceTrust, "trusted");
      assert.equal(turn.boundaryBypass, false);
      assert.match(turn.text, new RegExp(`\\(${item.id} turn \\d+\\)$`));
    }
  }
});

test("04 batch runner summary remains stable for the committed fixture", () => {
  const result = getBatchResult();

  assert.equal(result.decision, "NO_GO");
  assert.deepEqual(result.summary, {
    totalCases: 200,
    processedCases: 200,
    resumedCases: 0,
    goCases: 170,
    noGoCases: 30,
    skippedCases: 0,
    stopReason: null,
    blockingFindings: 0
  });
  assert.deepEqual(result.findings, []);
});

test("05 batch results preserve case order and produce one result per fixture case", () => {
  const result = getBatchResult();
  const resultIds = result.results.map((item) => item.id);
  const fixtureIds = committedBatchPayload.cases.map((item) => item.id);

  assert.equal(result.results.length, 200);
  assert.deepEqual(resultIds, fixtureIds);
});

test("06 risk-status distribution stays aligned with the seeded generator", () => {
  const result = getBatchResult();
  const distribution = countBy(result.results, (item) => item.result.report.risk_status);

  assert.deepEqual(distribution, EXPECTED_DISTRIBUTION);
});

test("07 decision matrix stays stable across the 200-case batch", () => {
  const result = getBatchResult();
  const matrix = {};

  for (const item of result.results) {
    const riskStatus = item.result.report.risk_status;
    const decision = item.result.decision;
    matrix[riskStatus] ??= { GO: 0, NO_GO: 0 };
    matrix[riskStatus][decision] += 1;
  }

  assert.deepEqual(matrix, {
    Normal: { GO: 80, NO_GO: 0 },
    Observe: { GO: 50, NO_GO: 0 },
    Deviate: { GO: 40, NO_GO: 0 },
    Alert: { GO: 0, NO_GO: 30 }
  });
});

test("08 every batch report exposes canonical fields and passes consistency validation", () => {
  const result = getBatchResult();

  for (const item of result.results) {
    const report = item.result.report;
    const reportKeys = Object.keys(report).sort();
    const validation = validateReportConsistency(report);

    assert.deepEqual(reportKeys, [...CANONICAL_REPORT_FIELDS].sort());
    assert.equal(validation.valid, true, `${item.id}: ${validation.errors.join("; ")}`);
  }
});

test("09 fingerprints stay unique and confidence intervals remain in supported bounds", () => {
  const result = getBatchResult();
  const fingerprints = new Set();

  for (const item of result.results) {
    const { confidence_interval: interval, digital_fingerprint: fingerprint } = item.result.report;

    assert.equal(interval.lower <= interval.upper, true);
    assert.equal(interval.lower >= 0, true);
    assert.equal(interval.upper <= 4, true);
    assert.equal(interval.unit, "risk_score_0_to_4");
    assert.match(fingerprint, /^[a-f0-9]{64}$/);

    fingerprints.add(fingerprint);
  }

  assert.equal(fingerprints.size, 200);
});

import test from "node:test";
import assert from "node:assert/strict";

import { buildDeidCoverage, buildTagCoverage } from "../scripts/coverage-matrix.mjs";

test("buildDeidCoverage meets per-detector minimums", () => {
  const report = buildDeidCoverage();
  assert.equal(report.covered_detectors, 6);
  assert.equal(report.total_detectors, 6);
  assert.ok(report.validation.meets_total_detectors);
});

test("buildTagCoverage exposes unsupported Observe->Deviate path as warning", () => {
  const report = buildTagCoverage();
  assert.equal(report.path_counts["Normal->Observe"], 20);
  assert.equal(report.path_counts["Observe->Deviate"], 0);
  assert.equal(report.path_counts["Deviate->Alert"], 20);
  assert.ok(report.warnings.some((item) => item.includes("no direct Observe->Deviate transition")));
  assert.equal(report.validation.meets_observe_to_deviate, false);
});

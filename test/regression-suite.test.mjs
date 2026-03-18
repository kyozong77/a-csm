import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { compareSuites, validateRegressionReport } from "../scripts/regression-suite.mjs";

function mkSuite(cases) {
  return { cases };
}

function caseItem(id, output) {
  return { id, output };
}

test("01 passes with exact matched suites", () => {
  const baseline = mkSuite([caseItem("a", { score: 1 })]);
  const candidate = mkSuite([caseItem("a", { score: 1 })]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.decision, "PASS");
  assert.equal(result.summary.matchedCases, 1);
});

test("02 treats object key order as equal", () => {
  const baseline = mkSuite([caseItem("a", { x: 1, y: 2 })]);
  const candidate = mkSuite([caseItem("a", { y: 2, x: 1 })]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.decision, "PASS");
});

test("03 fails when candidate is missing baseline case", () => {
  const baseline = mkSuite([caseItem("a", 1)]);
  const candidate = mkSuite([]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.decision, "FAIL");
  assert.ok(result.failures.some((f) => f.kind === "missing-case"));
});

test("04 warns on unexpected candidate case", () => {
  const baseline = mkSuite([]);
  const candidate = mkSuite([caseItem("extra", true)]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.decision, "PASS");
  assert.ok(result.failures.some((f) => f.kind === "unexpected-case"));
});

test("05 fails on text mismatch", () => {
  const baseline = mkSuite([caseItem("a", "alpha")]);
  const candidate = mkSuite([caseItem("a", "beta")]);
  const result = compareSuites(baseline, candidate);
  const mismatch = result.failures.find((f) => f.kind === "output-mismatch");
  assert.equal(result.decision, "FAIL");
  assert.equal(mismatch.mismatchType, "text-mismatch");
});

test("06 fails on type mismatch", () => {
  const baseline = mkSuite([caseItem("a", "1")]);
  const candidate = mkSuite([caseItem("a", 1)]);
  const result = compareSuites(baseline, candidate);
  const mismatch = result.failures.find((f) => f.kind === "output-mismatch");
  assert.equal(mismatch.mismatchType, "type-mismatch");
});

test("07 fails on structure mismatch", () => {
  const baseline = mkSuite([caseItem("a", { list: [1, 2] })]);
  const candidate = mkSuite([caseItem("a", { list: [1, 3] })]);
  const result = compareSuites(baseline, candidate);
  const mismatch = result.failures.find((f) => f.kind === "output-mismatch");
  assert.equal(mismatch.mismatchType, "structure-mismatch");
});

test("08 fails on primitive value mismatch", () => {
  const baseline = mkSuite([caseItem("a", 10)]);
  const candidate = mkSuite([caseItem("a", 11)]);
  const result = compareSuites(baseline, candidate);
  const mismatch = result.failures.find((f) => f.kind === "output-mismatch");
  assert.equal(mismatch.mismatchType, "value-mismatch");
});

test("09 rejects non-object baseline suite", () => {
  const result = compareSuites(null, mkSuite([]));
  assert.equal(result.decision, "FAIL");
  assert.ok(result.failures.some((f) => f.kind === "invalid-suite" && f.source === "baseline"));
});

test("10 rejects non-array cases", () => {
  const result = compareSuites({ cases: {} }, mkSuite([]));
  assert.equal(result.decision, "FAIL");
  assert.ok(result.failures.some((f) => f.kind === "invalid-cases"));
});

test("11 rejects non-object case items", () => {
  const result = compareSuites(mkSuite(["bad"]), mkSuite([]));
  assert.equal(result.decision, "FAIL");
  assert.ok(result.failures.some((f) => f.kind === "invalid-case"));
});

test("12 rejects empty case id", () => {
  const result = compareSuites(mkSuite([caseItem("   ", 1)]), mkSuite([]));
  assert.equal(result.decision, "FAIL");
  assert.ok(result.failures.some((f) => f.kind === "invalid-case-id"));
});

test("13 trims ids and still matches", () => {
  const baseline = mkSuite([caseItem("  case-1  ", { ok: true })]);
  const candidate = mkSuite([caseItem("case-1", { ok: true })]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.decision, "PASS");
  assert.equal(result.summary.matchedCases, 1);
});

test("14 rejects duplicate baseline ids", () => {
  const baseline = mkSuite([caseItem("a", 1), caseItem("a", 2)]);
  const candidate = mkSuite([caseItem("a", 1)]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.decision, "FAIL");
  assert.ok(result.failures.some((f) => f.kind === "duplicate-case-id" && f.source === "baseline"));
});

test("15 rejects duplicate candidate ids", () => {
  const baseline = mkSuite([caseItem("a", 1)]);
  const candidate = mkSuite([caseItem("a", 1), caseItem("a", 1)]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.decision, "FAIL");
  assert.ok(result.failures.some((f) => f.kind === "duplicate-case-id" && f.source === "candidate"));
});

test("16 counts summary metrics", () => {
  const baseline = mkSuite([caseItem("a", 1), caseItem("b", 2)]);
  const candidate = mkSuite([caseItem("a", 1), caseItem("x", 2)]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.summary.baselineCases, 2);
  assert.equal(result.summary.candidateCases, 2);
  assert.equal(result.summary.matchedCases, 1);
  assert.equal(result.summary.warningFailures, 1);
});

test("17 reports missing and mismatched together", () => {
  const baseline = mkSuite([caseItem("a", 1), caseItem("b", 2)]);
  const candidate = mkSuite([caseItem("a", 5)]);
  const result = compareSuites(baseline, candidate);
  assert.ok(result.failures.some((f) => f.kind === "missing-case" && f.caseId === "b"));
  assert.ok(result.failures.some((f) => f.kind === "output-mismatch" && f.caseId === "a"));
});

test("18 accepts null outputs when equal", () => {
  const baseline = mkSuite([caseItem("a", null)]);
  const candidate = mkSuite([caseItem("a", null)]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.decision, "PASS");
});

test("19 compares array order strictly", () => {
  const baseline = mkSuite([caseItem("a", [1, 2])]);
  const candidate = mkSuite([caseItem("a", [2, 1])]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.decision, "FAIL");
});

test("20 preserves matched case ids list", () => {
  const baseline = mkSuite([caseItem("a", true), caseItem("b", true)]);
  const candidate = mkSuite([caseItem("b", true), caseItem("a", true)]);
  const result = compareSuites(baseline, candidate);
  assert.deepEqual(result.matches.sort(), ["a", "b"]);
});

test("21 CLI emits json report", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "regression-suite-"));
  const baselinePath = path.join(tmpDir, "baseline.json");
  const candidatePath = path.join(tmpDir, "candidate.json");
  const outputPath = path.join(tmpDir, "report.json");

  fs.writeFileSync(baselinePath, JSON.stringify(mkSuite([caseItem("a", 1)]), null, 2));
  fs.writeFileSync(candidatePath, JSON.stringify(mkSuite([caseItem("a", 1)]), null, 2));

  execFileSync("node", ["scripts/regression-suite.mjs", "--baseline", baselinePath, "--candidate", candidatePath, "--output", outputPath], {
    cwd: process.cwd(),
    stdio: "pipe"
  });

  const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(report.decision, "PASS");
});

test("22 CLI emits both json and markdown", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "regression-suite-"));
  const baselinePath = path.join(tmpDir, "baseline.json");
  const candidatePath = path.join(tmpDir, "candidate.json");
  const outputPath = path.join(tmpDir, "report.json");

  fs.writeFileSync(baselinePath, JSON.stringify(mkSuite([caseItem("a", 1)]), null, 2));
  fs.writeFileSync(candidatePath, JSON.stringify(mkSuite([caseItem("a", 2)]), null, 2));

  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "scripts/regression-suite.mjs",
          "--baseline",
          baselinePath,
          "--candidate",
          candidatePath,
          "--output",
          outputPath,
          "--format",
          "both"
        ],
        {
          cwd: process.cwd(),
          stdio: "pipe"
        }
      ),
    /Command failed/
  );

  assert.ok(fs.existsSync(outputPath));
  assert.ok(fs.existsSync(`${outputPath}.md`));
  const markdown = fs.readFileSync(`${outputPath}.md`, "utf8");
  assert.ok(markdown.includes("# Regression Suite Result"));
});

test("23 includes schema version and smoke pass by default", () => {
  const baseline = mkSuite([caseItem("a", 1)]);
  const candidate = mkSuite([caseItem("a", 1)]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.schemaVersion, "1.1.0");
  assert.equal(result.smoke.passed, true);
});

test("24 summary includes pass and fail rates", () => {
  const baseline = mkSuite([caseItem("a", 1), caseItem("b", 2)]);
  const candidate = mkSuite([caseItem("a", 1), caseItem("b", 3)]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.summary.passRate, 0.5);
  assert.equal(result.summary.failRate, 0.5);
});

test("25 passRate is 1 when baseline is empty and no blocking failures", () => {
  const result = compareSuites(mkSuite([]), mkSuite([]));
  assert.equal(result.summary.passRate, 1);
  assert.equal(result.summary.failRate, 0);
});

test("26 passRate is 0 when baseline is empty but blocking failures exist", () => {
  const result = compareSuites(null, mkSuite([]));
  assert.equal(result.summary.passRate, 0);
  assert.equal(result.summary.failRate, 1);
});

test("27 includes failureCounts by kind", () => {
  const baseline = mkSuite([caseItem("a", 1), caseItem("b", 2)]);
  const candidate = mkSuite([caseItem("a", 2)]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.summary.failureCounts["missing-case"], 1);
  assert.equal(result.summary.failureCounts["output-mismatch"], 1);
});

test("28 includes mismatchTypeCounts for output mismatches", () => {
  const baseline = mkSuite([caseItem("a", "1"), caseItem("b", 10)]);
  const candidate = mkSuite([caseItem("a", 1), caseItem("b", 11)]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.summary.mismatchTypeCounts["type-mismatch"], 1);
  assert.equal(result.summary.mismatchTypeCounts["value-mismatch"], 1);
});

test("29 strict warnings mode makes unexpected-case blocking", () => {
  const baseline = mkSuite([]);
  const candidate = mkSuite([caseItem("extra", true)]);
  const result = compareSuites(baseline, candidate, { strictWarnings: true });
  assert.equal(result.decision, "FAIL");
  assert.equal(result.summary.strictWarningsApplied, true);
});

test("30 strict warnings false keeps unexpected-case warning-only", () => {
  const baseline = mkSuite([]);
  const candidate = mkSuite([caseItem("extra", true)]);
  const result = compareSuites(baseline, candidate, { strictWarnings: false });
  assert.equal(result.decision, "PASS");
  assert.equal(result.summary.warningFailures, 1);
});

test("31 computes trend delta against previous report", () => {
  const baseline = mkSuite([caseItem("a", 1), caseItem("b", 2)]);
  const candidate = mkSuite([caseItem("a", 1), caseItem("b", 2)]);
  const previousReport = {
    summary: {
      matchedCases: 1,
      blockingFailures: 1,
      warningFailures: 0,
      passRate: 0.5,
      failRate: 0.5
    }
  };
  const result = compareSuites(baseline, candidate, { previousReport });
  assert.equal(result.trend.available, true);
  assert.equal(result.trend.delta.matchedCases, 1);
  assert.equal(result.trend.delta.blockingFailures, -1);
  assert.equal(result.trend.delta.passRate, 0.5);
});

test("32 invalid previous report adds warning failure", () => {
  const baseline = mkSuite([caseItem("a", 1)]);
  const candidate = mkSuite([caseItem("a", 1)]);
  const result = compareSuites(baseline, candidate, { previousReport: {} });
  assert.equal(result.decision, "PASS");
  assert.ok(result.failures.some((f) => f.kind === "invalid-previous-report"));
});

test("33 strict warnings turns invalid previous report warning into fail", () => {
  const baseline = mkSuite([caseItem("a", 1)]);
  const candidate = mkSuite([caseItem("a", 1)]);
  const result = compareSuites(baseline, candidate, {
    previousReport: {},
    strictWarnings: true
  });
  assert.equal(result.decision, "FAIL");
});

test("34 trend unavailable provides reason", () => {
  const baseline = mkSuite([caseItem("a", 1)]);
  const candidate = mkSuite([caseItem("a", 1)]);
  const result = compareSuites(baseline, candidate, { previousReport: {} });
  assert.equal(result.trend.available, false);
  assert.equal(result.trend.reason, "missing-or-invalid-previous-summary");
});

test("35 validateRegressionReport passes for valid result", () => {
  const result = compareSuites(mkSuite([caseItem("a", 1)]), mkSuite([caseItem("a", 1)]));
  const validation = validateRegressionReport(result);
  assert.equal(validation.passed, true);
  assert.equal(validation.violations.length, 0);
});

test("36 validateRegressionReport catches broken totals", () => {
  const result = compareSuites(mkSuite([caseItem("a", 1)]), mkSuite([caseItem("a", 1)]));
  result.summary.totalFailures = 999;
  const validation = validateRegressionReport(result);
  assert.equal(validation.passed, false);
  assert.ok(validation.violations.some((v) => v.includes("totalFailures")));
});

test("37 warningFailures counts invalid previous report and unexpected-case", () => {
  const baseline = mkSuite([]);
  const candidate = mkSuite([caseItem("x", true)]);
  const result = compareSuites(baseline, candidate, { previousReport: {} });
  assert.equal(result.summary.warningFailures, 2);
});

test("38 blockingFailures ignores warnings in default mode", () => {
  const baseline = mkSuite([]);
  const candidate = mkSuite([caseItem("x", true)]);
  const result = compareSuites(baseline, candidate, { previousReport: {} });
  assert.equal(result.summary.blockingFailures, 0);
});

test("39 blockingFailures includes warnings in strict mode", () => {
  const baseline = mkSuite([]);
  const candidate = mkSuite([caseItem("x", true)]);
  const result = compareSuites(baseline, candidate, {
    previousReport: {},
    strictWarnings: true
  });
  assert.equal(result.summary.blockingFailures, 2);
});

test("40 failureCounts is empty on clean pass", () => {
  const result = compareSuites(mkSuite([caseItem("a", 1)]), mkSuite([caseItem("a", 1)]));
  assert.deepEqual(result.summary.failureCounts, {});
});

test("41 mismatchTypeCounts is empty without mismatches", () => {
  const result = compareSuites(mkSuite([caseItem("a", 1)]), mkSuite([caseItem("a", 1)]));
  assert.deepEqual(result.summary.mismatchTypeCounts, {});
});

test("42 mismatchTypeCounts captures text and structure mismatches", () => {
  const baseline = mkSuite([caseItem("a", "hello"), caseItem("b", { x: 1 })]);
  const candidate = mkSuite([caseItem("a", "world"), caseItem("b", { x: 2 })]);
  const result = compareSuites(baseline, candidate);
  assert.equal(result.summary.mismatchTypeCounts["text-mismatch"], 1);
  assert.equal(result.summary.mismatchTypeCounts["structure-mismatch"], 1);
});

test("43 CLI strict warnings exits non-zero for warning-only diff", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "regression-suite-"));
  const baselinePath = path.join(tmpDir, "baseline.json");
  const candidatePath = path.join(tmpDir, "candidate.json");

  fs.writeFileSync(baselinePath, JSON.stringify(mkSuite([]), null, 2));
  fs.writeFileSync(candidatePath, JSON.stringify(mkSuite([caseItem("x", true)]), null, 2));

  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "scripts/regression-suite.mjs",
          "--baseline",
          baselinePath,
          "--candidate",
          candidatePath,
          "--strict-warnings"
        ],
        {
          cwd: process.cwd(),
          stdio: "pipe"
        }
      ),
    /Command failed/
  );
});

test("44 CLI previous report enriches output trend", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "regression-suite-"));
  const baselinePath = path.join(tmpDir, "baseline.json");
  const candidatePath = path.join(tmpDir, "candidate.json");
  const previousPath = path.join(tmpDir, "previous.json");
  const outputPath = path.join(tmpDir, "report.json");

  fs.writeFileSync(baselinePath, JSON.stringify(mkSuite([caseItem("a", 1)]), null, 2));
  fs.writeFileSync(candidatePath, JSON.stringify(mkSuite([caseItem("a", 1)]), null, 2));
  fs.writeFileSync(
    previousPath,
    JSON.stringify(
      {
        summary: {
          matchedCases: 0,
          blockingFailures: 1,
          warningFailures: 0,
          passRate: 0,
          failRate: 1
        }
      },
      null,
      2
    )
  );

  execFileSync(
    "node",
    [
      "scripts/regression-suite.mjs",
      "--baseline",
      baselinePath,
      "--candidate",
      candidatePath,
      "--previous-report",
      previousPath,
      "--output",
      outputPath
    ],
    {
      cwd: process.cwd(),
      stdio: "pipe"
    }
  );

  const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(report.trend.available, true);
  assert.equal(report.trend.delta.passRate, 1);
});

test("45 CLI markdown includes trend and smoke lines", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "regression-suite-"));
  const baselinePath = path.join(tmpDir, "baseline.json");
  const candidatePath = path.join(tmpDir, "candidate.json");
  const outputPath = path.join(tmpDir, "report.md");

  fs.writeFileSync(baselinePath, JSON.stringify(mkSuite([]), null, 2));
  fs.writeFileSync(candidatePath, JSON.stringify(mkSuite([]), null, 2));

  execFileSync(
    "node",
    [
      "scripts/regression-suite.mjs",
      "--baseline",
      baselinePath,
      "--candidate",
      candidatePath,
      "--format",
      "markdown",
      "--output",
      outputPath
    ],
    {
      cwd: process.cwd(),
      stdio: "pipe"
    }
  );

  const markdown = fs.readFileSync(outputPath, "utf8");
  assert.ok(markdown.includes("Smoke check: PASS"));
});

test("46 summary strictWarningsApplied defaults false", () => {
  const result = compareSuites(mkSuite([]), mkSuite([]));
  assert.equal(result.summary.strictWarningsApplied, false);
});

test("47 summary strictWarningsApplied true when enabled", () => {
  const result = compareSuites(mkSuite([]), mkSuite([]), { strictWarnings: true });
  assert.equal(result.summary.strictWarningsApplied, true);
});

test("48 trend is null when previous report is not provided", () => {
  const result = compareSuites(mkSuite([]), mkSuite([]));
  assert.equal(result.trend, null);
});

test("49 smoke check still passes after warning insertion", () => {
  const result = compareSuites(mkSuite([]), mkSuite([caseItem("x", 1)]), {
    previousReport: {}
  });
  assert.equal(result.smoke.passed, true);
});

test("50 invalid previous report appears in failureCounts", () => {
  const result = compareSuites(mkSuite([]), mkSuite([]), { previousReport: {} });
  assert.equal(result.summary.failureCounts["invalid-previous-report"], 1);
});

test("51 strict warnings with warning-only failures produces FAIL", () => {
  const result = compareSuites(mkSuite([]), mkSuite([caseItem("x", 1)]), {
    previousReport: {},
    strictWarnings: true
  });
  assert.equal(result.decision, "FAIL");
});

test("52 trend delta failRate can be negative", () => {
  const previousReport = {
    summary: {
      matchedCases: 0,
      blockingFailures: 1,
      warningFailures: 0,
      passRate: 0,
      failRate: 1
    }
  };
  const result = compareSuites(mkSuite([caseItem("a", 1)]), mkSuite([caseItem("a", 1)]), {
    previousReport
  });
  assert.equal(result.trend.delta.failRate, -1);
});

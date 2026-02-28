import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGate } from "../scripts/release-gate.mjs";

const baseConfig = {
  requiredChecks: ["tests", "lint", "build"],
  maxHighPriorityOpen: 0,
  maxRegressionFailures: 0,
  maxCriticalSecurity: 0,
  requireExceptionApprovalWhenFrozen: true,
  requireRollbackPlanWhenFrozen: true,
  requiredArtifacts: ["index.html", "style.css"]
};

function makeGoodInput() {
  return {
    checks: { tests: "pass", lint: "pass", build: "pass" },
    metrics: { criticalOpen: 0, highOpen: 0, regressionFailures: 0 },
    freeze: { active: false, exceptionApproved: false, rollbackPlanLinked: false },
    artifacts: { present: ["index.html", "style.css"] }
  };
}

function assertHasFinding(result, findingId) {
  assert.ok(result.findings.some((finding) => finding.id === findingId));
}

function sha(char) {
  return char.repeat(64);
}

test("01 passes when all gates are satisfied", () => {
  const result = evaluateGate(makeGoodInput(), baseConfig);
  assert.equal(result.decision, "GO");
  assert.equal(result.summary.blockingFindings, 0);
});

test("02 fails when tests check fails", () => {
  const input = makeGoodInput();
  input.checks.tests = "fail";
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
});

test("03 fails when lint check fails", () => {
  const input = makeGoodInput();
  input.checks.lint = false;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
});

test("04 fails when build check fails", () => {
  const input = makeGoodInput();
  input.checks.build = "failed";
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
});

test("05 fails when required check is missing", () => {
  const input = makeGoodInput();
  delete input.checks.tests;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
});

test("06 fails when critical vulnerabilities exceed threshold", () => {
  const input = makeGoodInput();
  input.metrics.criticalOpen = 1;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
});

test("07 fails when high-priority open items exceed threshold", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = 2;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
});

test("08 fails when regression failures exceed threshold", () => {
  const input = makeGoodInput();
  input.metrics.regressionFailures = 1;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
});

test("09 fails on freeze without approval", () => {
  const input = makeGoodInput();
  input.freeze.active = true;
  input.freeze.exceptionApproved = false;
  input.freeze.rollbackPlanLinked = true;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
});

test("10 fails on freeze without rollback plan", () => {
  const input = makeGoodInput();
  input.freeze.active = true;
  input.freeze.exceptionApproved = true;
  input.freeze.rollbackPlanLinked = false;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
});

test("11 passes on freeze with approval and rollback", () => {
  const input = makeGoodInput();
  input.freeze.active = true;
  input.freeze.exceptionApproved = true;
  input.freeze.rollbackPlanLinked = true;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("12 fails when artifacts are missing", () => {
  const input = makeGoodInput();
  input.artifacts.present = ["index.html"];
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
});

test("13 passes when checks are booleans true", () => {
  const input = makeGoodInput();
  input.checks = { tests: true, lint: true, build: true };
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("14 defaults missing metrics to zero", () => {
  const input = makeGoodInput();
  delete input.metrics;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("15 defaults missing freeze to inactive", () => {
  const input = makeGoodInput();
  delete input.freeze;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("16 unknown check value blocks release", () => {
  const input = makeGoodInput();
  input.checks.tests = "skipped";
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
});

test("17 numeric strings are parsed for metrics", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = "0";
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("18 multiple findings are all accumulated", () => {
  const input = makeGoodInput();
  input.checks.tests = "fail";
  input.metrics.highOpen = 3;
  const result = evaluateGate(input, baseConfig);
  assert.ok(result.findings.length >= 2);
});

test("19 can relax thresholds through config", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = 2;
  const result = evaluateGate(input, { ...baseConfig, maxHighPriorityOpen: 2 });
  assert.equal(result.decision, "GO");
});

test("20 can disable freeze approval requirement", () => {
  const input = makeGoodInput();
  input.freeze.active = true;
  input.freeze.exceptionApproved = false;
  input.freeze.rollbackPlanLinked = true;
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionApprovalWhenFrozen: false
  });
  assert.equal(result.decision, "GO");
});

test("21 can disable freeze rollback requirement", () => {
  const input = makeGoodInput();
  input.freeze.active = true;
  input.freeze.exceptionApproved = true;
  input.freeze.rollbackPlanLinked = false;
  const result = evaluateGate(input, {
    ...baseConfig,
    requireRollbackPlanWhenFrozen: false
  });
  assert.equal(result.decision, "GO");
});

test("22 blocks non-numeric criticalOpen", () => {
  const input = makeGoodInput();
  input.metrics.criticalOpen = "abc";
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-criticalOpen-invalid");
});

test("23 blocks non-numeric highOpen", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = "n/a";
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-highOpen-invalid");
});

test("24 blocks non-numeric regressionFailures", () => {
  const input = makeGoodInput();
  input.metrics.regressionFailures = "none";
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-regressionFailures-invalid");
});

test("25 blocks negative criticalOpen", () => {
  const input = makeGoodInput();
  input.metrics.criticalOpen = -1;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-criticalOpen-negative");
});

test("26 blocks negative highOpen", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = -2;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-highOpen-negative");
});

test("27 blocks negative regressionFailures", () => {
  const input = makeGoodInput();
  input.metrics.regressionFailures = -5;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-regressionFailures-negative");
});

test("28 blocks decimal criticalOpen", () => {
  const input = makeGoodInput();
  input.metrics.criticalOpen = 0.5;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-criticalOpen-not-integer");
});

test("29 blocks decimal highOpen", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = 1.2;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-highOpen-not-integer");
});

test("30 blocks decimal regressionFailures", () => {
  const input = makeGoodInput();
  input.metrics.regressionFailures = 0.1;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-regressionFailures-not-integer");
});

test("31 accepts numeric string values for all metrics", () => {
  const input = makeGoodInput();
  input.metrics = { criticalOpen: "0", highOpen: "0", regressionFailures: "0" };
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("32 ignores blank metric values and treats as zero", () => {
  const input = makeGoodInput();
  input.metrics = { criticalOpen: "", highOpen: " ", regressionFailures: null };
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("33 requires exception ticket when configured", () => {
  const input = makeGoodInput();
  input.freeze = { active: true, exceptionApproved: true, rollbackPlanLinked: true };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionTicketWhenFrozen: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "freeze-missing-exception-ticket");
});

test("34 blocks empty exception ticket when configured", () => {
  const input = makeGoodInput();
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    exceptionTicketId: "   "
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionTicketWhenFrozen: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "freeze-empty-exception-ticket");
});

test("35 passes with exception ticket when configured", () => {
  const input = makeGoodInput();
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    exceptionTicketId: "RZV-104-EX1"
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionTicketWhenFrozen: true
  });
  assert.equal(result.decision, "GO");
});

test("36 requires rollback owner when configured", () => {
  const input = makeGoodInput();
  input.freeze = { active: true, exceptionApproved: true, rollbackPlanLinked: true };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireRollbackOwnerWhenFrozen: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "freeze-missing-rollback-owner");
});

test("37 blocks empty rollback owner when configured", () => {
  const input = makeGoodInput();
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    rollbackOwner: " "
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireRollbackOwnerWhenFrozen: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "freeze-empty-rollback-owner");
});

test("38 passes with rollback owner when configured", () => {
  const input = makeGoodInput();
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    rollbackOwner: "release-manager"
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireRollbackOwnerWhenFrozen: true
  });
  assert.equal(result.decision, "GO");
});

test("39 does not require freeze metadata when freeze inactive", () => {
  const input = makeGoodInput();
  input.freeze = {
    active: false,
    exceptionApproved: false,
    rollbackPlanLinked: false
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionTicketWhenFrozen: true,
    requireRollbackOwnerWhenFrozen: true
  });
  assert.equal(result.decision, "GO");
});

test("40 artifact matching trims whitespace", () => {
  const input = makeGoodInput();
  input.artifacts.present = [" index.html ", "style.css"];
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("41 artifact matching ignores duplicate entries", () => {
  const input = makeGoodInput();
  input.artifacts.present = ["index.html", "index.html", "style.css"];
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("42 summary includes errorFindings count", () => {
  const input = makeGoodInput();
  input.checks.tests = "fail";
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.summary.errorFindings, 1);
});

test("43 fails when open incidents exceed threshold", () => {
  const input = makeGoodInput();
  input.metrics.openIncidents = 1;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "open-incidents");
});

test("44 passes when open incidents equals threshold", () => {
  const input = makeGoodInput();
  input.metrics.openIncidents = 2;
  const result = evaluateGate(input, { ...baseConfig, maxOpenIncidents: 2 });
  assert.equal(result.decision, "GO");
});

test("45 blocks non-numeric open incidents", () => {
  const input = makeGoodInput();
  input.metrics.openIncidents = "unknown";
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-openIncidents-invalid");
});

test("46 blocks negative open incidents", () => {
  const input = makeGoodInput();
  input.metrics.openIncidents = -1;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-openIncidents-negative");
});

test("47 blocks decimal open incidents", () => {
  const input = makeGoodInput();
  input.metrics.openIncidents = 0.2;
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-openIncidents-not-integer");
});

test("48 fails when total approvals below minimum", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 1 };
  const result = evaluateGate(input, { ...baseConfig, minApprovals: 2 });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "approvals-below-min");
});

test("49 passes when total approvals meets minimum", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 2 };
  const result = evaluateGate(input, { ...baseConfig, minApprovals: 2 });
  assert.equal(result.decision, "GO");
});

test("50 blocks non-numeric total approvals", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: "x" };
  const result = evaluateGate(input, { ...baseConfig, minApprovals: 1 });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-totalApprovals-invalid");
});

test("51 blocks negative total approvals", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: -1 };
  const result = evaluateGate(input, { ...baseConfig, minApprovals: 1 });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-totalApprovals-negative");
});

test("52 requires security approval when configured", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 1, securityApproved: false };
  const result = evaluateGate(input, { ...baseConfig, requireSecurityApproval: true });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "approvals-missing-security");
});

test("53 passes with security approval when required", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 1, securityApproved: true };
  const result = evaluateGate(input, { ...baseConfig, requireSecurityApproval: true });
  assert.equal(result.decision, "GO");
});

test("54 requires qa approval when configured", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 1, qaApproved: false };
  const result = evaluateGate(input, { ...baseConfig, requireQaApproval: true });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "approvals-missing-qa");
});

test("55 passes with qa approval when required", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 1, qaApproved: true };
  const result = evaluateGate(input, { ...baseConfig, requireQaApproval: true });
  assert.equal(result.decision, "GO");
});

test("56 fails when one of required approvals is missing", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 2, securityApproved: true, qaApproved: false };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireSecurityApproval: true,
    requireQaApproval: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "approvals-missing-qa");
});

test("57 passes when both required approvals are present", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 2, securityApproved: true, qaApproved: true };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireSecurityApproval: true,
    requireQaApproval: true
  });
  assert.equal(result.decision, "GO");
});

test("58 requires exception expiry when configured", () => {
  const input = makeGoodInput();
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionExpiryWhenFrozen: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "freeze-missing-exception-expiry");
});

test("59 blocks empty exception expiry when required", () => {
  const input = makeGoodInput();
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    exceptionExpiresAt: " "
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionExpiryWhenFrozen: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "freeze-empty-exception-expiry");
});

test("60 blocks invalid exception expiry format", () => {
  const input = makeGoodInput();
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    exceptionExpiresAt: "tomorrow"
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionExpiryWhenFrozen: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "freeze-invalid-exception-expiry");
});

test("61 blocks expired exception with evaluation time", () => {
  const input = makeGoodInput();
  input.meta = { evaluationTime: "2026-02-28T00:00:00.000Z" };
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    exceptionExpiresAt: "2026-02-27T23:59:59.000Z"
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionExpiryWhenFrozen: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "freeze-expired-exception");
});

test("62 passes when exception expiry is in the future", () => {
  const input = makeGoodInput();
  input.meta = { evaluationTime: "2026-02-28T00:00:00.000Z" };
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    exceptionExpiresAt: "2026-03-01T00:00:00.000Z"
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionExpiryWhenFrozen: true
  });
  assert.equal(result.decision, "GO");
});

test("63 requires artifact hashes when configured", () => {
  const input = makeGoodInput();
  input.artifacts = { present: ["index.html", "style.css"], hashes: {} };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireArtifactHashes: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "missing-artifact-hashes");
});

test("64 blocks invalid artifact hash format", () => {
  const input = makeGoodInput();
  input.artifacts = {
    present: ["index.html", "style.css"],
    hashes: { "index.html": "bad", "style.css": sha("a") }
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireArtifactHashes: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "invalid-artifact-hashes");
});

test("65 passes with valid artifact hashes", () => {
  const input = makeGoodInput();
  input.artifacts = {
    present: ["index.html", "style.css"],
    hashes: { "index.html": sha("a"), "style.css": sha("b") }
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireArtifactHashes: true
  });
  assert.equal(result.decision, "GO");
});

test("66 warning findings are counted near threshold", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = 2;
  const result = evaluateGate(input, {
    ...baseConfig,
    maxHighPriorityOpen: 3,
    warningHighPriorityOpenAt: 2
  });
  assert.equal(result.decision, "GO");
  assert.equal(result.summary.warningFindings, 1);
  assertHasFinding(result, "high-priority-near-threshold");
});

test("67 warning threshold does not block release", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = 3;
  const result = evaluateGate(input, {
    ...baseConfig,
    maxHighPriorityOpen: 3,
    warningHighPriorityOpenAt: 3
  });
  assert.equal(result.decision, "GO");
});

test("68 warning threshold above max is invalid config", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    maxHighPriorityOpen: 1,
    warningHighPriorityOpenAt: 2
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-warning-high-priority-open-at-range");
});

test("69 invalid minApprovals config blocks release", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, { ...baseConfig, minApprovals: 1.5 });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-min-approvals-invalid");
});

test("70 invalid maxOpenIncidents config blocks release", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, { ...baseConfig, maxOpenIncidents: -1 });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-max-open-incidents-invalid");
});

test("71 requiredChecks are normalized and deduplicated", () => {
  const input = makeGoodInput();
  input.checks = { tests: "pass", lint: "pass" };
  const result = evaluateGate(input, {
    ...baseConfig,
    requiredChecks: [" tests ", "lint", "tests", " "]
  });
  assert.equal(result.decision, "GO");
  assert.deepEqual(result.config.requiredChecks, ["tests", "lint"]);
});

test("72 requiredArtifacts normalization works with hash gate", () => {
  const input = makeGoodInput();
  input.artifacts = {
    present: ["index.html", "style.css"],
    hashes: { "index.html": sha("c"), "style.css": sha("d") }
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireArtifactHashes: true,
    requiredArtifacts: [" index.html ", "style.css", "index.html"]
  });
  assert.equal(result.decision, "GO");
  assert.deepEqual(result.config.requiredArtifacts, ["index.html", "style.css"]);
});

test("73 no warning when warning threshold is null", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = 1;
  const result = evaluateGate(input, {
    ...baseConfig,
    maxHighPriorityOpen: 2,
    warningHighPriorityOpenAt: null
  });
  assert.equal(result.decision, "GO");
  assert.equal(result.summary.warningFindings, 0);
});

test("74 no warning when highOpen below warning threshold", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = 1;
  const result = evaluateGate(input, {
    ...baseConfig,
    maxHighPriorityOpen: 3,
    warningHighPriorityOpenAt: 2
  });
  assert.equal(result.decision, "GO");
  assert.equal(result.summary.warningFindings, 0);
});

test("75 no warning emitted when highOpen exceeds hard threshold", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = 4;
  const result = evaluateGate(input, {
    ...baseConfig,
    maxHighPriorityOpen: 3,
    warningHighPriorityOpenAt: 2
  });
  assert.equal(result.decision, "NO_GO");
  assert.equal(result.summary.warningFindings, 0);
});

test("76 warning appears exactly at warning threshold", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = 2;
  const result = evaluateGate(input, {
    ...baseConfig,
    maxHighPriorityOpen: 2,
    warningHighPriorityOpenAt: 2
  });
  assert.equal(result.decision, "GO");
  assert.equal(result.summary.warningFindings, 1);
});

test("77 open incidents accepts numeric strings", () => {
  const input = makeGoodInput();
  input.metrics.openIncidents = "1";
  const result = evaluateGate(input, {
    ...baseConfig,
    maxOpenIncidents: 1
  });
  assert.equal(result.decision, "GO");
});

test("78 open incidents defaults to zero when omitted", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("79 missing approvals treated as zero and fail minimum approvals", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    minApprovals: 1
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "approvals-below-min");
});

test("80 decimal total approvals are rejected", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 1.5 };
  const result = evaluateGate(input, {
    ...baseConfig,
    minApprovals: 1
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "metric-totalApprovals-not-integer");
});

test("81 blank total approvals treated as zero", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: " " };
  const result = evaluateGate(input, {
    ...baseConfig,
    minApprovals: 1
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "approvals-below-min");
});

test("82 minApprovals config accepts numeric string", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 1 };
  const result = evaluateGate(input, {
    ...baseConfig,
    minApprovals: "1"
  });
  assert.equal(result.decision, "GO");
});

test("83 maxOpenIncidents config accepts numeric string", () => {
  const input = makeGoodInput();
  input.metrics.openIncidents = 1;
  const result = evaluateGate(input, {
    ...baseConfig,
    maxOpenIncidents: "1"
  });
  assert.equal(result.decision, "GO");
});

test("84 warning threshold config accepts numeric string", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = 2;
  const result = evaluateGate(input, {
    ...baseConfig,
    maxHighPriorityOpen: 2,
    warningHighPriorityOpenAt: "2"
  });
  assert.equal(result.decision, "GO");
  assert.equal(result.summary.warningFindings, 1);
});

test("85 invalid decimal maxHighPriorityOpen config blocks", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    maxHighPriorityOpen: 0.5
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-max-high-priority-open-invalid");
});

test("86 invalid negative maxRegressionFailures config blocks", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    maxRegressionFailures: -1
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-max-regression-failures-invalid");
});

test("87 invalid string maxCriticalSecurity config blocks", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    maxCriticalSecurity: "abc"
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-max-critical-security-invalid");
});

test("88 invalid decimal warning threshold config blocks", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    warningHighPriorityOpenAt: 1.2
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-warning-high-priority-open-at-invalid");
});

test("89 invalid negative warning threshold config blocks", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    warningHighPriorityOpenAt: -1
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-warning-high-priority-open-at-invalid");
});

test("90 invalid string maxOpenIncidents config blocks", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    maxOpenIncidents: "oops"
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-max-open-incidents-invalid");
});

test("91 invalid negative minApprovals config blocks", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    minApprovals: -2
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-min-approvals-invalid");
});

test("92 invalid string minApprovals config blocks", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    minApprovals: "bad"
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-min-approvals-invalid");
});

test("93 invalid string maxHighPriorityOpen config blocks", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    maxHighPriorityOpen: "bad"
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-max-high-priority-open-invalid");
});

test("94 invalid artifact hashes ignored when hash gate disabled", () => {
  const input = makeGoodInput();
  input.artifacts = {
    present: ["index.html", "style.css"],
    hashes: { "index.html": "bad", "style.css": "also-bad" }
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireArtifactHashes: false
  });
  assert.equal(result.decision, "GO");
});

test("95 uppercase SHA-256 hashes are accepted", () => {
  const input = makeGoodInput();
  input.artifacts = {
    present: ["index.html", "style.css"],
    hashes: { "index.html": sha("A"), "style.css": sha("B") }
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireArtifactHashes: true
  });
  assert.equal(result.decision, "GO");
});

test("96 mixed-case SHA-256 hashes are accepted", () => {
  const input = makeGoodInput();
  input.artifacts = {
    present: ["index.html", "style.css"],
    hashes: {
      "index.html": "a".repeat(32) + "B".repeat(32),
      "style.css": "c".repeat(16) + "D".repeat(16) + "e".repeat(32)
    }
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireArtifactHashes: true
  });
  assert.equal(result.decision, "GO");
});

test("97 missing and invalid hashes are reported together", () => {
  const input = makeGoodInput();
  input.artifacts = {
    present: ["index.html", "style.css"],
    hashes: { "index.html": "bad" }
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireArtifactHashes: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "missing-artifact-hashes");
  assertHasFinding(result, "invalid-artifact-hashes");
});

test("98 hash gate with empty required artifacts passes", () => {
  const input = makeGoodInput();
  input.artifacts = { present: [], hashes: {} };
  const result = evaluateGate(input, {
    ...baseConfig,
    requiredArtifacts: [],
    requireArtifactHashes: true
  });
  assert.equal(result.decision, "GO");
});

test("99 artifact hash keys must match normalized required artifact names", () => {
  const input = makeGoodInput();
  input.artifacts = {
    present: ["index.html", "style.css"],
    hashes: { " index.html ": sha("a"), "style.css": sha("b") }
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireArtifactHashes: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "missing-artifact-hashes");
});

test("100 requiredArtifacts normalization drops non-string entries", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    requiredArtifacts: ["index.html", 1, null, "style.css"]
  });
  assert.equal(result.decision, "GO");
  assert.deepEqual(result.config.requiredArtifacts, ["index.html", "style.css"]);
});

test("101 requiredArtifacts normalization drops empty strings", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    requiredArtifacts: ["index.html", " ", "style.css"]
  });
  assert.equal(result.decision, "GO");
  assert.deepEqual(result.config.requiredArtifacts, ["index.html", "style.css"]);
});

test("102 requiredChecks normalization drops non-string and empty", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    requiredChecks: ["tests", null, " ", "lint"]
  });
  assert.equal(result.decision, "GO");
  assert.deepEqual(result.config.requiredChecks, ["tests", "lint"]);
});

test("103 empty requiredChecks disables check gate", () => {
  const input = makeGoodInput();
  input.checks = {};
  const result = evaluateGate(input, {
    ...baseConfig,
    requiredChecks: []
  });
  assert.equal(result.decision, "GO");
});

test("104 non-array requiredChecks falls back to defaults", () => {
  const input = makeGoodInput();
  input.checks = {};
  const result = evaluateGate(input, {
    ...baseConfig,
    requiredChecks: "tests"
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "check-tests-missing");
});

test("105 invalid exception expiry ignored when expiry requirement disabled", () => {
  const input = makeGoodInput();
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    exceptionExpiresAt: "not-a-date"
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionExpiryWhenFrozen: false
  });
  assert.equal(result.decision, "GO");
});

test("106 freeze inactive skips exception expiry requirement", () => {
  const input = makeGoodInput();
  input.freeze = {
    active: false,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    exceptionExpiresAt: ""
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionExpiryWhenFrozen: true
  });
  assert.equal(result.decision, "GO");
});

test("107 exception not approved skips exception expiry requirement", () => {
  const input = makeGoodInput();
  input.freeze = {
    active: true,
    exceptionApproved: false,
    rollbackPlanLinked: true,
    exceptionExpiresAt: ""
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionExpiryWhenFrozen: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "freeze-missing-approval");
});

test("108 expiry requirement not enforced when exception approval rule disabled", () => {
  const input = makeGoodInput();
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    exceptionExpiresAt: ""
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionApprovalWhenFrozen: false,
    requireExceptionExpiryWhenFrozen: true
  });
  assert.equal(result.decision, "GO");
});

test("109 invalid evaluationTime blocks when expiry check executes", () => {
  const input = makeGoodInput();
  input.meta = { evaluationTime: "invalid-time" };
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    exceptionExpiresAt: "2026-03-01T00:00:00.000Z"
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionExpiryWhenFrozen: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "meta-evaluation-time-invalid");
});

test("110 invalid evaluationTime ignored when expiry check not enabled", () => {
  const input = makeGoodInput();
  input.meta = { evaluationTime: "invalid-time" };
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("111 exception expiry equal to evaluation time is treated as expired", () => {
  const input = makeGoodInput();
  input.meta = { evaluationTime: "2026-03-01T00:00:00.000Z" };
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    exceptionExpiresAt: "2026-03-01T00:00:00.000Z"
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionExpiryWhenFrozen: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "freeze-expired-exception");
});

test("112 timezone offset expiry dates are accepted", () => {
  const input = makeGoodInput();
  input.meta = { evaluationTime: "2026-03-01T00:00:00.000Z" };
  input.freeze = {
    active: true,
    exceptionApproved: true,
    rollbackPlanLinked: true,
    exceptionExpiresAt: "2026-03-02T10:00:00+08:00"
  };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireExceptionExpiryWhenFrozen: true
  });
  assert.equal(result.decision, "GO");
});

test("113 security approval gate blocks even when min approvals met", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 3, securityApproved: false, qaApproved: true };
  const result = evaluateGate(input, {
    ...baseConfig,
    minApprovals: 2,
    requireSecurityApproval: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "approvals-missing-security");
});

test("114 qa approval gate blocks even when min approvals met", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 3, securityApproved: true, qaApproved: false };
  const result = evaluateGate(input, {
    ...baseConfig,
    minApprovals: 2,
    requireQaApproval: true
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "approvals-missing-qa");
});

test("115 both approval gates pass with true booleans", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 0, securityApproved: true, qaApproved: true };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireSecurityApproval: true,
    requireQaApproval: true
  });
  assert.equal(result.decision, "GO");
});

test("116 truthy non-boolean approvals satisfy current approval checks", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 0, securityApproved: "yes", qaApproved: "yes" };
  const result = evaluateGate(input, {
    ...baseConfig,
    requireSecurityApproval: true,
    requireQaApproval: true
  });
  assert.equal(result.decision, "GO");
});

test("117 security approval not required by default", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 0, securityApproved: false };
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("118 qa approval not required by default", () => {
  const input = makeGoodInput();
  input.approvals = { totalApprovals: 0, qaApproved: false };
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "GO");
});

test("119 null warning threshold keeps readiness without warnings", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = 0;
  const result = evaluateGate(input, {
    ...baseConfig,
    warningHighPriorityOpenAt: null
  });
  assert.equal(result.decision, "GO");
  assert.equal(result.summary.warningFindings, 0);
});

test("120 warningFindings is zero when only blocking errors exist", () => {
  const input = makeGoodInput();
  input.checks.tests = "fail";
  const result = evaluateGate(input, baseConfig);
  assert.equal(result.decision, "NO_GO");
  assert.equal(result.summary.warningFindings, 0);
});

test("121 warningFindings increments for single warning", () => {
  const input = makeGoodInput();
  input.metrics.highOpen = 1;
  const result = evaluateGate(input, {
    ...baseConfig,
    maxHighPriorityOpen: 1,
    warningHighPriorityOpenAt: 1
  });
  assert.equal(result.decision, "GO");
  assert.equal(result.summary.warningFindings, 1);
});

test("122 config invalid keeps NO_GO even when runtime inputs are clean", () => {
  const input = makeGoodInput();
  const result = evaluateGate(input, {
    ...baseConfig,
    minApprovals: -1
  });
  assert.equal(result.decision, "NO_GO");
  assertHasFinding(result, "config-min-approvals-invalid");
});

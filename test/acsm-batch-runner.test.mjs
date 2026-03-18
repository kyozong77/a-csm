import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { runAcsmBatch } from "../scripts/acsm-batch-runner.mjs";

const orchestratorConfig = {
  releaseGate: {
    requiredChecks: ["tests"],
    maxHighPriorityOpen: 0,
    maxRegressionFailures: 0,
    maxCriticalSecurity: 0,
    maxOpenIncidents: 0,
    warningHighPriorityOpenAt: null,
    minApprovals: 0,
    requireSecurityApproval: false,
    requireQaApproval: false,
    requireExceptionApprovalWhenFrozen: true,
    requireRollbackPlanWhenFrozen: true,
    requireExceptionTicketWhenFrozen: false,
    requireExceptionExpiryWhenFrozen: false,
    requireRollbackOwnerWhenFrozen: false,
    requireArtifactHashes: false,
    requiredArtifacts: []
  }
};

function benignCase(id) {
  return {
    id,
    input: {
      turns: [
        {
          id: "T1",
          role: "user",
          sourceTrust: "trusted",
          boundaryBypass: false,
          text: "Please summarize confirmed requirements only."
        }
      ]
    }
  };
}

function makeCases(count) {
  return {
    cases: Array.from({ length: count }, (_, index) => benignCase(`case-${index + 1}`))
  };
}

function hasFinding(result, findingId) {
  return result.findings.some((item) => item.id === findingId);
}

test("01 processes 200 cases with default maxCases", () => {
  const input = makeCases(200);
  const result = runAcsmBatch(input, orchestratorConfig);

  assert.equal(result.decision, "GO");
  assert.equal(result.summary.processedCases, 200);
  assert.equal(result.summary.goCases, 200);
  assert.equal(result.summary.noGoCases, 0);
});

test("02 rejects batches larger than 200 by default", () => {
  const input = makeCases(201);
  const result = runAcsmBatch(input, orchestratorConfig);

  assert.equal(result.decision, "NO_GO");
  assert.equal(result.summary.processedCases, 0);
  assert.equal(hasFinding(result, "batch-max-cases-exceeded"), true);
});

test("03 maxCases option allows more than 200 cases", () => {
  const input = makeCases(201);
  const result = runAcsmBatch(input, orchestratorConfig, { maxCases: 220 });

  assert.equal(result.decision, "GO");
  assert.equal(result.summary.processedCases, 201);
  assert.equal(result.summary.goCases, 201);
});

test("04 stopOnNoGo stops batch early", () => {
  const input = {
    cases: [
      benignCase("case-1"),
      {
        id: "case-2",
        input: {
          turns: [
            {
              id: "T1",
              role: "user",
              sourceTrust: "trusted",
              boundaryBypass: false,
              text: "This has self-harm hint and should be NO_GO."
            }
          ]
        }
      },
      benignCase("case-3")
    ]
  };

  const result = runAcsmBatch(input, orchestratorConfig, { stopOnNoGo: true });

  assert.equal(result.decision, "NO_GO");
  assert.equal(result.summary.processedCases, 2);
  assert.equal(result.summary.skippedCases, 1);
  assert.equal(result.summary.stopReason, "no-go");
});

test("05 includeResults includes per-case full result payload", () => {
  const input = makeCases(3);
  const result = runAcsmBatch(input, orchestratorConfig, { includeResults: true });

  assert.equal(Array.isArray(result.results), true);
  assert.equal(result.results.length, 3);
  assert.equal(typeof result.results[0].result.summary, "object");
});

test("06 resumeFrom reuses completed case results and only executes remaining cases", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-batch-"));
  const resumePath = path.join(tmpDir, "resume.json");

  const initial = runAcsmBatch(makeCases(3), orchestratorConfig, {
    includeResults: true
  });
  fs.writeFileSync(resumePath, JSON.stringify(initial, null, 2));

  const resumed = runAcsmBatch(makeCases(5), orchestratorConfig, {
    includeResults: true,
    resumeFrom: resumePath
  });

  assert.equal(resumed.decision, "GO");
  assert.equal(resumed.summary.resumedCases, 3);
  assert.equal(resumed.summary.processedCases, 2);
  assert.equal(resumed.summary.goCases, 5);
  assert.equal(resumed.cases.filter((item) => item.resumed).length, 3);
  assert.equal(resumed.results.length, 5);
});

test("07 invalid resume file path blocks batch execution", () => {
  const missingPath = path.join(os.tmpdir(), `acsm-batch-missing-${Date.now()}.json`);
  const result = runAcsmBatch(makeCases(2), orchestratorConfig, {
    resumeFrom: missingPath
  });

  assert.equal(result.decision, "NO_GO");
  assert.equal(result.summary.processedCases, 0);
  assert.equal(hasFinding(result, "batch-resume-read-failed"), true);
});

test("08 CLI writes json output for 200-case batch", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-batch-"));
  const inputPath = path.join(tmpDir, "input.json");
  const configPath = path.join(tmpDir, "config.json");
  const outputPath = path.join(tmpDir, "result.json");

  fs.writeFileSync(inputPath, JSON.stringify(makeCases(200), null, 2));
  fs.writeFileSync(configPath, JSON.stringify(orchestratorConfig, null, 2));

  execFileSync(
    "node",
    [
      "scripts/acsm-batch-runner.mjs",
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
  assert.equal(output.decision, "GO");
  assert.equal(output.summary.processedCases, 200);
});

test("09 CLI returns non-zero when case count exceeds default max", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-batch-"));
  const inputPath = path.join(tmpDir, "input.json");
  const configPath = path.join(tmpDir, "config.json");

  fs.writeFileSync(inputPath, JSON.stringify(makeCases(201), null, 2));
  fs.writeFileSync(configPath, JSON.stringify(orchestratorConfig, null, 2));

  assert.throws(
    () =>
      execFileSync(
        "node",
        ["scripts/acsm-batch-runner.mjs", "--input", inputPath, "--config", configPath],
        {
          cwd: process.cwd(),
          stdio: "pipe"
        }
      ),
    /Command failed/
  );
});

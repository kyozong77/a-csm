import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  runAcsmValidationPipeline,
  writeValidationArtifacts,
  buildReleaseGateInputFromArtifactIndex
} from "../scripts/acsm-validation-pipeline.mjs";

function createAnnotationBatch(mode = "strong") {
  if (mode === "weak") {
    return {
      batch_id: "pilot-001",
      target_count: 100,
      completed_count: 1,
      conversations: [
        {
          conversation_id: "conv-01",
          turns: [{ turn_id: "T001" }, { turn_id: "T002" }],
          rater_a: [
            { turn_id: "T001", event_code: "FR_01", severity: 4 },
            { turn_id: "T002", event_code: "CA_01", severity: 0 }
          ],
          rater_b: [
            { turn_id: "T001", event_code: "FR_01", severity: 0 },
            { turn_id: "T002", event_code: "CA_01", severity: 4 }
          ]
        }
      ]
    };
  }

  return {
    batch_id: "pilot-001",
    target_count: 100,
    completed_count: 1,
    conversations: [
      {
        conversation_id: "conv-01",
        turns: [{ turn_id: "T001" }, { turn_id: "T002" }],
        rater_a: [
          { turn_id: "T001", event_code: "FR_01", severity: 2 },
          { turn_id: "T002", event_code: "CA_01", severity: 1 }
        ],
        rater_b: [
          { turn_id: "T001", event_code: "FR_01", severity: 2 },
          { turn_id: "T002", event_code: "CA_01", severity: 1 }
        ]
      }
    ]
  };
}

function createOrchestratorInput() {
  return {
    turns: [
      {
        id: "T1",
        role: "user",
        sourceTrust: "trusted",
        boundaryBypass: false,
        text: "Please provide a concise project status summary."
      },
      {
        id: "T2",
        role: "assistant",
        sourceTrust: "trusted",
        boundaryBypass: false,
        text: "I will keep all details aligned with validated scope."
      }
    ]
  };
}

function createMetrics() {
  return {
    content_validity: 0.9,
    construct_validity: 0.93,
    criterion_validity: 0.62,
    test_retest: 0.8
  };
}

function createOrchestratorConfig() {
  return {
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
      requireValidationReadiness: true,
      requireArtifactHashes: false,
      requiredArtifacts: []
    }
  };
}

test("01 pipeline returns GO when readiness is ready", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-validation-pipeline-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const orchestratorInputPath = path.join(tmpDir, "orchestrator-input.json");
  const orchestratorConfigPath = path.join(tmpDir, "orchestrator-config.json");
  const metricsPath = path.join(tmpDir, "metrics.json");

  fs.writeFileSync(batchPath, JSON.stringify(createAnnotationBatch("strong"), null, 2), "utf8");
  fs.writeFileSync(orchestratorInputPath, JSON.stringify(createOrchestratorInput(), null, 2), "utf8");
  fs.writeFileSync(orchestratorConfigPath, JSON.stringify(createOrchestratorConfig(), null, 2), "utf8");
  fs.writeFileSync(metricsPath, JSON.stringify(createMetrics(), null, 2), "utf8");

  const result = runAcsmValidationPipeline({
    annotationBatchPath: batchPath,
    orchestratorInputPath,
    orchestratorConfigPath,
    validationMetricsPath: metricsPath
  });

  assert.equal(result.validation.summary.readiness, "ready");
  assert.equal(result.orchestrator.summary.validationReadiness, "ready");
  assert.equal(result.decision, "GO");
});

test("02 CLI returns non-zero when readiness is not ready", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-validation-pipeline-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const orchestratorInputPath = path.join(tmpDir, "orchestrator-input.json");
  const orchestratorConfigPath = path.join(tmpDir, "orchestrator-config.json");
  const metricsPath = path.join(tmpDir, "metrics.json");
  const outputPath = path.join(tmpDir, "result.json");

  fs.writeFileSync(batchPath, JSON.stringify(createAnnotationBatch("weak"), null, 2), "utf8");
  fs.writeFileSync(orchestratorInputPath, JSON.stringify(createOrchestratorInput(), null, 2), "utf8");
  fs.writeFileSync(orchestratorConfigPath, JSON.stringify(createOrchestratorConfig(), null, 2), "utf8");
  fs.writeFileSync(metricsPath, JSON.stringify(createMetrics(), null, 2), "utf8");

  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "scripts/acsm-validation-pipeline.mjs",
          "--annotation-batch",
          batchPath,
          "--orchestrator-input",
          orchestratorInputPath,
          "--orchestrator-config",
          orchestratorConfigPath,
          "--validation-metrics",
          metricsPath,
          "--output",
          outputPath
        ],
        {
          cwd: process.cwd(),
          stdio: "pipe"
        }
      ),
    /Command failed/
  );

  const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(output.validation.summary.readiness, "not_ready");
  assert.equal(output.decision, "NO_GO");
});

test("03 writes fixed artifact files and index with --artifact-dir behavior", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-validation-pipeline-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const orchestratorInputPath = path.join(tmpDir, "orchestrator-input.json");
  const orchestratorConfigPath = path.join(tmpDir, "orchestrator-config.json");
  const metricsPath = path.join(tmpDir, "metrics.json");
  const artifactsDir = path.join(tmpDir, "artifacts");

  fs.writeFileSync(batchPath, JSON.stringify(createAnnotationBatch("strong"), null, 2), "utf8");
  fs.writeFileSync(orchestratorInputPath, JSON.stringify(createOrchestratorInput(), null, 2), "utf8");
  fs.writeFileSync(orchestratorConfigPath, JSON.stringify(createOrchestratorConfig(), null, 2), "utf8");
  fs.writeFileSync(metricsPath, JSON.stringify(createMetrics(), null, 2), "utf8");

  const result = runAcsmValidationPipeline({
    annotationBatchPath: batchPath,
    orchestratorInputPath,
    orchestratorConfigPath,
    validationMetricsPath: metricsPath
  });

  const artifactResult = writeValidationArtifacts(result, artifactsDir, {
    includeMarkdown: true
  });

  const expectedFiles = [
    "validation-runner-result.json",
    "acsm-orchestrator-result.json",
    "acsm-validation-pipeline-result.json",
    "acsm-validation-pipeline-result.md",
    "acsm-validation-artifacts-index.json"
  ];

  for (const file of expectedFiles) {
    assert.equal(fs.existsSync(path.join(artifactsDir, file)), true, `${file} should exist`);
  }

  const index = JSON.parse(fs.readFileSync(artifactResult.indexPath, "utf8"));
  assert.equal(index.decision, "GO");
  assert.equal(index.summary.validationReadiness, "ready");
  assert.equal(index.files.length, 4);
  assert.equal(index.files.some((item) => item.type === "validation_runner"), true);
  assert.equal(index.files.some((item) => item.type === "orchestrator"), true);
  assert.equal(index.files.some((item) => item.type === "validation_pipeline"), true);
  assert.equal(index.files.some((item) => item.type === "validation_pipeline_markdown"), true);
});

test("04 CLI writes artifact bundle with --artifact-dir", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-validation-pipeline-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const orchestratorInputPath = path.join(tmpDir, "orchestrator-input.json");
  const orchestratorConfigPath = path.join(tmpDir, "orchestrator-config.json");
  const metricsPath = path.join(tmpDir, "metrics.json");
  const artifactsDir = path.join(tmpDir, "artifacts");

  fs.writeFileSync(batchPath, JSON.stringify(createAnnotationBatch("strong"), null, 2), "utf8");
  fs.writeFileSync(orchestratorInputPath, JSON.stringify(createOrchestratorInput(), null, 2), "utf8");
  fs.writeFileSync(orchestratorConfigPath, JSON.stringify(createOrchestratorConfig(), null, 2), "utf8");
  fs.writeFileSync(metricsPath, JSON.stringify(createMetrics(), null, 2), "utf8");

  execFileSync(
    "node",
    [
      "scripts/acsm-validation-pipeline.mjs",
      "--annotation-batch",
      batchPath,
      "--orchestrator-input",
      orchestratorInputPath,
      "--orchestrator-config",
      orchestratorConfigPath,
      "--validation-metrics",
      metricsPath,
      "--artifact-dir",
      artifactsDir,
      "--format",
      "both"
    ],
    {
      cwd: process.cwd(),
      stdio: "pipe"
    }
  );

  const expectedFiles = [
    "validation-runner-result.json",
    "acsm-orchestrator-result.json",
    "acsm-validation-pipeline-result.json",
    "acsm-validation-pipeline-result.md",
    "acsm-validation-artifacts-index.json"
  ];

  for (const file of expectedFiles) {
    assert.equal(fs.existsSync(path.join(artifactsDir, file)), true, `${file} should exist`);
  }

  const index = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, "acsm-validation-artifacts-index.json"), "utf8")
  );
  assert.equal(index.decision, "GO");
  assert.equal(index.files.length, 4);
});

test("05 builds release-gate input from artifact index", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-validation-pipeline-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const orchestratorInputPath = path.join(tmpDir, "orchestrator-input.json");
  const orchestratorConfigPath = path.join(tmpDir, "orchestrator-config.json");
  const metricsPath = path.join(tmpDir, "metrics.json");
  const artifactsDir = path.join(tmpDir, "artifacts");

  fs.writeFileSync(batchPath, JSON.stringify(createAnnotationBatch("strong"), null, 2), "utf8");
  fs.writeFileSync(orchestratorInputPath, JSON.stringify(createOrchestratorInput(), null, 2), "utf8");
  fs.writeFileSync(orchestratorConfigPath, JSON.stringify(createOrchestratorConfig(), null, 2), "utf8");
  fs.writeFileSync(metricsPath, JSON.stringify(createMetrics(), null, 2), "utf8");

  const result = runAcsmValidationPipeline({
    annotationBatchPath: batchPath,
    orchestratorInputPath,
    orchestratorConfigPath,
    validationMetricsPath: metricsPath
  });

  const artifactResult = writeValidationArtifacts(result, artifactsDir, {
    includeMarkdown: true
  });

  const releaseGateInput = buildReleaseGateInputFromArtifactIndex(result, artifactResult.index, {
    indexPath: artifactResult.indexPath
  });
  assert.equal(releaseGateInput.validation.readiness, "ready");
  assert.equal(releaseGateInput.meta.validationArtifactIndexPath, artifactResult.indexPath);
  assert.equal(Array.isArray(releaseGateInput.artifacts.present), true);
  assert.equal(releaseGateInput.artifacts.present.length, 4);
  assert.equal(Object.keys(releaseGateInput.artifacts.hashes).length, 4);
});

test("06 CLI writes release-gate input when requested", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-validation-pipeline-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const orchestratorInputPath = path.join(tmpDir, "orchestrator-input.json");
  const orchestratorConfigPath = path.join(tmpDir, "orchestrator-config.json");
  const metricsPath = path.join(tmpDir, "metrics.json");
  const artifactsDir = path.join(tmpDir, "artifacts");
  const releaseGateInputPath = path.join(tmpDir, "release-gate-input.json");

  fs.writeFileSync(batchPath, JSON.stringify(createAnnotationBatch("strong"), null, 2), "utf8");
  fs.writeFileSync(orchestratorInputPath, JSON.stringify(createOrchestratorInput(), null, 2), "utf8");
  fs.writeFileSync(orchestratorConfigPath, JSON.stringify(createOrchestratorConfig(), null, 2), "utf8");
  fs.writeFileSync(metricsPath, JSON.stringify(createMetrics(), null, 2), "utf8");

  execFileSync(
    "node",
    [
      "scripts/acsm-validation-pipeline.mjs",
      "--annotation-batch",
      batchPath,
      "--orchestrator-input",
      orchestratorInputPath,
      "--orchestrator-config",
      orchestratorConfigPath,
      "--validation-metrics",
      metricsPath,
      "--artifact-dir",
      artifactsDir,
      "--release-gate-input-output",
      releaseGateInputPath,
      "--format",
      "both"
    ],
    {
      cwd: process.cwd(),
      stdio: "pipe"
    }
  );

  const releaseGateInput = JSON.parse(fs.readFileSync(releaseGateInputPath, "utf8"));
  assert.equal(releaseGateInput.validation.readiness, "ready");
  assert.equal(releaseGateInput.artifacts.present.includes("validation-runner-result.json"), true);
  assert.equal(releaseGateInput.artifacts.present.includes("acsm-orchestrator-result.json"), true);
  assert.equal(releaseGateInput.artifacts.present.includes("acsm-validation-pipeline-result.json"), true);
  assert.equal(releaseGateInput.artifacts.present.includes("acsm-validation-pipeline-result.md"), true);
  assert.equal(Object.keys(releaseGateInput.artifacts.hashes).length, 4);
});

test("07 CLI rejects release-gate output without artifact-dir", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-validation-pipeline-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const orchestratorInputPath = path.join(tmpDir, "orchestrator-input.json");
  const orchestratorConfigPath = path.join(tmpDir, "orchestrator-config.json");
  const metricsPath = path.join(tmpDir, "metrics.json");
  const releaseGateInputPath = path.join(tmpDir, "release-gate-input.json");

  fs.writeFileSync(batchPath, JSON.stringify(createAnnotationBatch("strong"), null, 2), "utf8");
  fs.writeFileSync(orchestratorInputPath, JSON.stringify(createOrchestratorInput(), null, 2), "utf8");
  fs.writeFileSync(orchestratorConfigPath, JSON.stringify(createOrchestratorConfig(), null, 2), "utf8");
  fs.writeFileSync(metricsPath, JSON.stringify(createMetrics(), null, 2), "utf8");

  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "scripts/acsm-validation-pipeline.mjs",
          "--annotation-batch",
          batchPath,
          "--orchestrator-input",
          orchestratorInputPath,
          "--orchestrator-config",
          orchestratorConfigPath,
          "--validation-metrics",
          metricsPath,
          "--release-gate-input-output",
          releaseGateInputPath
        ],
        {
          cwd: process.cwd(),
          stdio: "pipe"
        }
      ),
    /Command failed/
  );
});

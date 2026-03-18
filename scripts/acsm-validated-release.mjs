import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  runAcsmValidationPipeline,
  writeValidationArtifacts,
  buildReleaseGateInputFromArtifactIndex
} from "./acsm-validation-pipeline.mjs";
import { evaluateGate } from "./release-gate.mjs";

const DEFAULT_RELEASE_GATE_CONFIG = "config/release-gate.validation-artifacts.json";

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeOutput(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# A-CSM Validated Release Result");
  lines.push("");
  lines.push(`- Decision: **${result.decision}**`);
  lines.push(`- Generated at: ${result.generatedAt}`);
  lines.push(`- Validation pipeline decision: ${result.summary.validationPipelineDecision}`);
  lines.push(`- Validation readiness: ${result.summary.validationReadiness}`);
  lines.push(`- Orchestrator decision: ${result.summary.orchestratorDecision}`);
  lines.push(`- Release gate decision: ${result.summary.releaseGateDecision}`);
  lines.push(`- Release gate blocking findings: ${result.summary.releaseGateBlockingFindings}`);
  lines.push("");
  lines.push("## Inputs");
  lines.push("");
  lines.push(`- Annotation batch: ${result.input.annotationBatchPath}`);
  lines.push(`- Orchestrator input: ${result.input.orchestratorInputPath}`);
  lines.push(`- Validation metrics: ${result.input.validationMetricsPath ?? "N/A"}`);
  lines.push(`- Validation framework: ${result.input.validationFrameworkPath ?? "N/A"}`);
  lines.push(`- Orchestrator config: ${result.input.orchestratorConfigPath ?? "N/A"}`);
  lines.push(`- Release gate config: ${result.input.releaseGateConfigPath}`);
  lines.push(`- Artifact directory: ${result.artifacts.dir}`);
  lines.push(`- Artifact index: ${result.artifacts.indexPath}`);
  return lines.join("\n");
}

export function runAcsmValidatedRelease(options = {}) {
  const annotationBatchPath = path.resolve(options.annotationBatchPath);
  const orchestratorInputPath = path.resolve(options.orchestratorInputPath);
  const artifactDir = path.resolve(options.artifactDir);
  const orchestratorConfigPath = options.orchestratorConfigPath
    ? path.resolve(options.orchestratorConfigPath)
    : null;
  const validationMetricsPath = options.validationMetricsPath
    ? path.resolve(options.validationMetricsPath)
    : null;
  const validationFrameworkPath = options.validationFrameworkPath
    ? path.resolve(options.validationFrameworkPath)
    : null;
  const releaseGateConfigPath = options.releaseGateConfigPath
    ? path.resolve(options.releaseGateConfigPath)
    : path.resolve(DEFAULT_RELEASE_GATE_CONFIG);

  const validationPipeline = runAcsmValidationPipeline({
    annotationBatchPath,
    orchestratorInputPath,
    orchestratorConfigPath,
    validationMetricsPath,
    validationFrameworkPath,
    targetKappa: options.targetKappa
  });

  const artifactResult = writeValidationArtifacts(validationPipeline, artifactDir, {
    includeMarkdown: options.includeMarkdownArtifact !== false
  });

  const releaseGateInput = buildReleaseGateInputFromArtifactIndex(
    validationPipeline,
    artifactResult.index,
    {
      indexPath: artifactResult.indexPath
    }
  );

  const releaseGateConfig = readJsonFile(releaseGateConfigPath);
  const releaseGate = evaluateGate(releaseGateInput, releaseGateConfig);
  const decision =
    validationPipeline.decision === "GO" && releaseGate.decision === "GO" ? "GO" : "NO_GO";

  return {
    generatedAt: new Date().toISOString(),
    decision,
    summary: {
      validationPipelineDecision: validationPipeline.decision,
      validationReadiness: validationPipeline.validation?.summary?.readiness ?? "not_ready",
      orchestratorDecision: validationPipeline.orchestrator?.decision ?? "NO_GO",
      releaseGateDecision: releaseGate.decision,
      releaseGateBlockingFindings: Number(releaseGate.summary?.blockingFindings ?? 0)
    },
    input: {
      annotationBatchPath,
      orchestratorInputPath,
      orchestratorConfigPath,
      validationMetricsPath,
      validationFrameworkPath,
      releaseGateConfigPath
    },
    artifacts: {
      dir: artifactResult.artifactDir,
      indexPath: artifactResult.indexPath
    },
    releaseGateInput,
    releaseGate,
    validationPipeline
  };
}

function parseArgs(argv) {
  const args = {
    annotationBatchPath: null,
    orchestratorInputPath: null,
    orchestratorConfigPath: null,
    validationMetricsPath: null,
    validationFrameworkPath: null,
    releaseGateConfigPath: null,
    artifactDir: null,
    releaseGateInputOutputPath: null,
    output: null,
    format: "json",
    targetKappa: 0.61
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key === "--annotation-batch") {
      args.annotationBatchPath = value;
      index += 1;
      continue;
    }
    if (key === "--orchestrator-input") {
      args.orchestratorInputPath = value;
      index += 1;
      continue;
    }
    if (key === "--orchestrator-config") {
      args.orchestratorConfigPath = value;
      index += 1;
      continue;
    }
    if (key === "--validation-metrics") {
      args.validationMetricsPath = value;
      index += 1;
      continue;
    }
    if (key === "--validation-framework") {
      args.validationFrameworkPath = value;
      index += 1;
      continue;
    }
    if (key === "--release-gate-config") {
      args.releaseGateConfigPath = value;
      index += 1;
      continue;
    }
    if (key === "--artifact-dir") {
      args.artifactDir = value;
      index += 1;
      continue;
    }
    if (key === "--release-gate-input-output") {
      args.releaseGateInputOutputPath = value;
      index += 1;
      continue;
    }
    if (key === "--target-kappa") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        args.targetKappa = parsed;
      }
      index += 1;
      continue;
    }
    if (key === "--output") {
      args.output = value;
      index += 1;
      continue;
    }
    if (key === "--format") {
      args.format = value;
      index += 1;
    }
  }

  return args;
}

function printUsage() {
  console.error(
    "Usage: node scripts/acsm-validated-release.mjs --annotation-batch <path> --orchestrator-input <path> --artifact-dir <path> [--orchestrator-config <path>] [--validation-metrics <path>] [--validation-framework <path>] [--release-gate-config <path>] [--release-gate-input-output <path>] [--target-kappa 0.61] [--output <path>] [--format json|markdown|both]"
  );
}

function runCli() {
  const args = parseArgs(process.argv);
  if (!args.annotationBatchPath || !args.orchestratorInputPath || !args.artifactDir) {
    printUsage();
    process.exit(2);
  }

  try {
    const result = runAcsmValidatedRelease({
      annotationBatchPath: args.annotationBatchPath,
      orchestratorInputPath: args.orchestratorInputPath,
      orchestratorConfigPath: args.orchestratorConfigPath,
      validationMetricsPath: args.validationMetricsPath,
      validationFrameworkPath: args.validationFrameworkPath,
      releaseGateConfigPath: args.releaseGateConfigPath,
      artifactDir: args.artifactDir,
      targetKappa: args.targetKappa,
      includeMarkdownArtifact: true
    });

    const json = JSON.stringify(result, null, 2);
    const markdown = renderMarkdown(result);

    if (args.releaseGateInputOutputPath) {
      writeOutput(path.resolve(args.releaseGateInputOutputPath), JSON.stringify(result.releaseGateInput, null, 2));
    }

    if (args.output) {
      const outputPath = path.resolve(args.output);
      if (args.format === "markdown") {
        writeOutput(outputPath, markdown);
      } else if (args.format === "both") {
        writeOutput(outputPath, json);
        writeOutput(`${outputPath}.md`, markdown);
      } else {
        writeOutput(outputPath, json);
      }
    }

    if (args.format === "markdown") {
      console.log(markdown);
    } else {
      console.log(json);
      if (args.format === "both") {
        console.log("\n---\n");
        console.log(markdown);
      }
    }

    process.exit(result.decision === "GO" ? 0 : 1);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli();
}

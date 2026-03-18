import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { runInputContract } from "./input-contract.mjs";
import { runValidationPipeline } from "./validation-runner.mjs";
import { runAcsmOrchestrator } from "./acsm-orchestrator.mjs";

const MARKDOWN_INPUT_EXTENSIONS = new Set([".md", ".markdown"]);
const ARTIFACT_FILE_NAMES = {
  validation: "validation-runner-result.json",
  orchestrator: "acsm-orchestrator-result.json",
  pipeline: "acsm-validation-pipeline-result.json",
  pipelineMarkdown: "acsm-validation-pipeline-result.md",
  index: "acsm-validation-artifacts-index.json"
};
const DEFAULT_RELEASE_GATE_INPUT = {
  checks: {
    tests: "pass",
    lint: "pass",
    build: "pass"
  },
  metrics: {
    criticalOpen: 0,
    highOpen: 0,
    regressionFailures: 0,
    openIncidents: 0
  },
  approvals: {
    totalApprovals: 0
  },
  freeze: {
    active: false,
    exceptionApproved: false,
    rollbackPlanLinked: false
  },
  artifacts: {
    present: [],
    hashes: {}
  },
  validation: {
    readiness: "not_ready"
  },
  meta: {}
};

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, override) {
  if (!isObject(base)) {
    return clone(override);
  }
  if (!isObject(override)) {
    return clone(base);
  }

  const output = clone(base);
  for (const [key, value] of Object.entries(override)) {
    if (isObject(value) && isObject(output[key])) {
      output[key] = deepMerge(output[key], value);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeOutput(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function toSha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildArtifactRecord(type, filePath, content) {
  return {
    type,
    file: path.basename(filePath),
    path: filePath,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    sha256: toSha256(content)
  };
}

function normalizeValidationReadiness(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "ready" || normalized === "empirical_ready") {
    return "ready";
  }
  if (normalized === "unknown") {
    return "unknown";
  }
  return "not_ready";
}

function uniqueStringList(values = []) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

function loadOrchestratorInput(inputPath) {
  const extension = path.extname(inputPath).toLowerCase();
  if (!MARKDOWN_INPUT_EXTENSIONS.has(extension)) {
    return {
      input: readJsonFile(inputPath),
      source: "json",
      inputContract: null
    };
  }

  const markdown = fs.readFileSync(inputPath, "utf8");
  const contract = runInputContract(markdown, {});
  if (!contract.validation.is_valid) {
    throw new Error(`Input contract validation failed: ${contract.validation.errors.join("; ")}`);
  }

  return {
    input: {
      turns: contract.turns
    },
    source: contract.input_format,
    inputContract: contract
  };
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# A-CSM Validation Pipeline Result");
  lines.push("");
  lines.push(`- Decision: **${result.decision}**`);
  lines.push(`- Generated at: ${result.generatedAt}`);
  lines.push(`- Validation readiness: ${result.validation.summary.readiness}`);
  lines.push(`- Validation kappa: ${result.validation.irr_report.batch_kappa ?? "N/A"}`);
  lines.push(`- Orchestrator decision: ${result.orchestrator.decision}`);
  lines.push(`- Release gate decision: ${result.orchestrator.summary.releaseGateDecision}`);
  lines.push(`- Blocking findings: ${result.orchestrator.summary.blockingFindings}`);
  lines.push("");
  lines.push("## Inputs");
  lines.push("");
  lines.push(`- Annotation batch: ${result.input.annotationBatchPath}`);
  lines.push(`- Orchestrator input: ${result.input.orchestratorInputPath}`);
  lines.push(`- Metrics: ${result.input.validationMetricsPath ?? "N/A"}`);
  lines.push(`- Framework: ${result.input.validationFrameworkPath ?? "N/A"}`);
  return lines.join("\n");
}

export function runAcsmValidationPipeline(options) {
  const annotationBatchPath = path.resolve(options.annotationBatchPath);
  const orchestratorInputPath = path.resolve(options.orchestratorInputPath);
  const orchestratorConfigPath = options.orchestratorConfigPath ? path.resolve(options.orchestratorConfigPath) : null;
  const validationMetricsPath = options.validationMetricsPath ? path.resolve(options.validationMetricsPath) : null;
  const validationFrameworkPath = options.validationFrameworkPath ? path.resolve(options.validationFrameworkPath) : null;

  const validation = runValidationPipeline({
    batchPath: annotationBatchPath,
    metricsPath: validationMetricsPath,
    frameworkPath: validationFrameworkPath,
    targetKappa: options.targetKappa
  });

  const loadedInput = loadOrchestratorInput(orchestratorInputPath);
  const fileConfig = orchestratorConfigPath ? readJsonFile(orchestratorConfigPath) : {};
  const inputContractConfig = loadedInput.inputContract?.config ?? {};
  const orchestratorConfig = deepMerge(inputContractConfig, fileConfig);
  const orchestratorInput = clone(loadedInput.input);
  const existingValidation = isObject(orchestratorInput.validation) ? orchestratorInput.validation : {};
  orchestratorInput.validation = {
    ...existingValidation,
    readiness: validation.summary.readiness
  };

  const orchestrator = runAcsmOrchestrator(orchestratorInput, orchestratorConfig);
  orchestrator.summary.inputFormat = loadedInput.source;
  if (loadedInput.inputContract) {
    orchestrator.inputContract = {
      metadata: loadedInput.inputContract.metadata,
      validation: loadedInput.inputContract.validation,
      findings: loadedInput.inputContract.findings,
      summary: loadedInput.inputContract.summary
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    decision: orchestrator.decision,
    input: {
      annotationBatchPath,
      orchestratorInputPath,
      orchestratorConfigPath,
      validationMetricsPath,
      validationFrameworkPath
    },
    validation,
    orchestrator
  };
}

export function writeValidationArtifacts(result, artifactDirPath, options = {}) {
  const artifactDir = path.resolve(artifactDirPath);
  const includeMarkdown = options.includeMarkdown !== false;
  const files = [];

  const validationJson = JSON.stringify(result.validation, null, 2);
  const validationPath = path.join(artifactDir, ARTIFACT_FILE_NAMES.validation);
  writeOutput(validationPath, validationJson);
  files.push(buildArtifactRecord("validation_runner", validationPath, validationJson));

  const orchestratorJson = JSON.stringify(result.orchestrator, null, 2);
  const orchestratorPath = path.join(artifactDir, ARTIFACT_FILE_NAMES.orchestrator);
  writeOutput(orchestratorPath, orchestratorJson);
  files.push(buildArtifactRecord("orchestrator", orchestratorPath, orchestratorJson));

  const pipelineJson = JSON.stringify(result, null, 2);
  const pipelinePath = path.join(artifactDir, ARTIFACT_FILE_NAMES.pipeline);
  writeOutput(pipelinePath, pipelineJson);
  files.push(buildArtifactRecord("validation_pipeline", pipelinePath, pipelineJson));

  if (includeMarkdown) {
    const pipelineMarkdown = renderMarkdown(result);
    const pipelineMarkdownPath = path.join(artifactDir, ARTIFACT_FILE_NAMES.pipelineMarkdown);
    writeOutput(pipelineMarkdownPath, pipelineMarkdown);
    files.push(buildArtifactRecord("validation_pipeline_markdown", pipelineMarkdownPath, pipelineMarkdown));
  }

  const indexPayload = {
    generatedAt: new Date().toISOString(),
    decision: result.decision,
    summary: {
      validationReadiness: result.validation?.summary?.readiness ?? "unknown",
      orchestratorDecision: result.orchestrator?.decision ?? "NO_GO",
      releaseGateDecision: result.orchestrator?.summary?.releaseGateDecision ?? "NO_GO",
      blockingFindings: Number(result.orchestrator?.summary?.blockingFindings ?? 0)
    },
    files
  };

  const indexJson = JSON.stringify(indexPayload, null, 2);
  const indexPath = path.join(artifactDir, ARTIFACT_FILE_NAMES.index);
  writeOutput(indexPath, indexJson);

  return {
    artifactDir,
    indexPath,
    index: indexPayload
  };
}

export function buildReleaseGateInputFromArtifactIndex(result, artifactIndex, options = {}) {
  const baseInput = isObject(result?.orchestrator?.derived?.releaseGateInput)
    ? clone(result.orchestrator.derived.releaseGateInput)
    : clone(DEFAULT_RELEASE_GATE_INPUT);

  const artifactFiles = uniqueStringList(
    Array.isArray(artifactIndex?.files) ? artifactIndex.files.map((item) => item?.file) : []
  );
  const artifactHashes = {};
  for (const file of Array.isArray(artifactIndex?.files) ? artifactIndex.files : []) {
    const fileName = typeof file?.file === "string" ? file.file.trim() : "";
    const hash = typeof file?.sha256 === "string" ? file.sha256.trim() : "";
    if (!fileName || !hash) {
      continue;
    }
    artifactHashes[fileName] = hash;
  }

  const readiness = normalizeValidationReadiness(
    artifactIndex?.summary?.validationReadiness ?? result?.validation?.summary?.readiness
  );

  return {
    ...baseInput,
    artifacts: {
      ...(isObject(baseInput.artifacts) ? baseInput.artifacts : {}),
      present: artifactFiles,
      hashes: artifactHashes
    },
    validation: {
      ...(isObject(baseInput.validation) ? baseInput.validation : {}),
      readiness
    },
    meta: {
      ...(isObject(baseInput.meta) ? baseInput.meta : {}),
      validationArtifactIndexPath: options.indexPath ?? null,
      validationArtifactGeneratedAt:
        typeof artifactIndex?.generatedAt === "string" ? artifactIndex.generatedAt : null
    }
  };
}

function parseArgs(argv) {
  const args = {
    annotationBatchPath: null,
    orchestratorInputPath: null,
    orchestratorConfigPath: null,
    validationMetricsPath: null,
    validationFrameworkPath: null,
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
    if (key === "--format") {
      args.format = value;
      index += 1;
    }
  }

  return args;
}

function printUsage() {
  console.error(
    "Usage: node scripts/acsm-validation-pipeline.mjs --annotation-batch <path> --orchestrator-input <path> [--orchestrator-config <path>] [--validation-metrics <path>] [--validation-framework <path>] [--target-kappa 0.61] [--artifact-dir <path>] [--release-gate-input-output <path>] [--output <path>] [--format json|markdown|both]"
  );
}

function runCli() {
  const args = parseArgs(process.argv);
  if (!args.annotationBatchPath || !args.orchestratorInputPath) {
    printUsage();
    process.exit(2);
  }

  try {
    const result = runAcsmValidationPipeline(args);
    const json = JSON.stringify(result, null, 2);
    const markdown = renderMarkdown(result);
    const includeMarkdownArtifact = args.format !== "json";
    let artifactResult = null;

    if (args.artifactDir) {
      artifactResult = writeValidationArtifacts(result, args.artifactDir, {
        includeMarkdown: includeMarkdownArtifact
      });
    }
    if (args.releaseGateInputOutputPath) {
      if (!artifactResult) {
        throw new Error("--release-gate-input-output requires --artifact-dir.");
      }
      const releaseGateInput = buildReleaseGateInputFromArtifactIndex(result, artifactResult.index, {
        indexPath: artifactResult.indexPath
      });
      writeOutput(path.resolve(args.releaseGateInputOutputPath), JSON.stringify(releaseGateInput, null, 2));
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

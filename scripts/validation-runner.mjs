import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { calculateBatchIrr } from "./annotation-workflow.mjs";
import { buildValidationFramework, evaluateValidationStages } from "./validation-framework.mjs";

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeMetrics(rawMetrics) {
  if (!rawMetrics || typeof rawMetrics !== "object" || Array.isArray(rawMetrics)) {
    return {};
  }
  const normalized = {};
  for (const [key, value] of Object.entries(rawMetrics)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      normalized[key] = numeric;
    }
  }
  return normalized;
}

export function runValidationPipeline(options) {
  const batchPayload = readJson(path.resolve(options.batchPath));
  const targetKappa = toNumber(options.targetKappa, 0.61);
  const irrReport = calculateBatchIrr(batchPayload, {
    target_kappa: targetKappa
  });

  const framework = options.frameworkPath
    ? readJson(path.resolve(options.frameworkPath))
    : buildValidationFramework();

  const metricsFromFile = options.metricsPath ? normalizeMetrics(readJson(path.resolve(options.metricsPath))) : {};
  const mergedMetrics = {
    ...metricsFromFile
  };

  if (typeof mergedMetrics.inter_rater_reliability !== "number" && typeof irrReport.batch_kappa === "number") {
    mergedMetrics.inter_rater_reliability = irrReport.batch_kappa;
    mergedMetrics.cohens_kappa = irrReport.batch_kappa;
  }

  const validationReport = evaluateValidationStages(framework, mergedMetrics);
  const readiness =
    validationReport.summary.readiness === "empirical_ready" && irrReport.meets_target_kappa === true;

  return {
    generated_at: new Date().toISOString(),
    input: {
      batch_path: path.resolve(options.batchPath),
      metrics_path: options.metricsPath ? path.resolve(options.metricsPath) : null,
      framework_path: options.frameworkPath ? path.resolve(options.frameworkPath) : null,
      target_kappa: targetKappa
    },
    metrics: mergedMetrics,
    irr_report: irrReport,
    validation_report: validationReport,
    summary: {
      readiness: readiness ? "ready" : "not_ready",
      irr_target_met: irrReport.meets_target_kappa,
      stage_readiness: validationReport.summary.readiness
    }
  };
}

function parseArgs(argv) {
  const args = {
    batchPath: null,
    metricsPath: null,
    frameworkPath: null,
    outputPath: null,
    targetKappa: 0.61,
    enforceAll: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key === "--batch") {
      args.batchPath = value;
      index += 1;
      continue;
    }
    if (key === "--metrics") {
      args.metricsPath = value;
      index += 1;
      continue;
    }
    if (key === "--framework") {
      args.frameworkPath = value;
      index += 1;
      continue;
    }
    if (key === "--output") {
      args.outputPath = value;
      index += 1;
      continue;
    }
    if (key === "--target-kappa") {
      args.targetKappa = toNumber(value, 0.61);
      index += 1;
      continue;
    }
    if (key === "--enforce-all") {
      args.enforceAll = true;
      continue;
    }
  }

  return args;
}

function printUsage() {
  console.error(
    "Usage: node scripts/validation-runner.mjs --batch <annotation-batch.json> [--metrics <metrics.json>] [--framework <framework.json>] [--output <result.json>] [--target-kappa 0.61] [--enforce-all]"
  );
}

function runCli() {
  const args = parseArgs(process.argv);
  if (!args.batchPath) {
    printUsage();
    process.exit(2);
  }

  try {
    const result = runValidationPipeline(args);

    if (args.outputPath) {
      writeJson(path.resolve(args.outputPath), result);
      console.log(`Validation pipeline result saved: ${path.resolve(args.outputPath)}`);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    if (args.enforceAll && result.summary.readiness !== "ready") {
      process.exit(1);
    }
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli();
}

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TARGET_IRR = 0.61;

export const DEFAULT_VALIDATION_STAGES = [
  {
    stage_id: 1,
    key: "content_validity",
    name: "Content Validity",
    description: "Expert panel reviews 43 event definitions.",
    target_metric: "expert_agreement_rate",
    threshold: 0.8
  },
  {
    stage_id: 2,
    key: "construct_validity",
    name: "Construct Validity",
    description: "Factor analysis on pilot data.",
    target_metric: "cfi_tli",
    threshold: 0.9
  },
  {
    stage_id: 3,
    key: "criterion_validity",
    name: "Criterion Validity",
    description: "Correlation with external safety benchmarks.",
    target_metric: "pearson_r",
    threshold: 0.5
  },
  {
    stage_id: 4,
    key: "inter_rater_reliability",
    name: "Inter-Rater Reliability",
    description: "Dual-rater agreement with Cohen's Kappa.",
    target_metric: "cohens_kappa",
    threshold: DEFAULT_TARGET_IRR
  },
  {
    stage_id: 5,
    key: "test_retest",
    name: "Test-Retest Reliability",
    description: "Stability check after re-analysis.",
    target_metric: "icc",
    threshold: 0.7
  }
];

export const DEFAULT_PILOT_STUDY_CONFIG = {
  total_conversations: 100,
  source_distribution: {
    sharegpt: 50,
    wildchat: 30,
    synthetic_edge: 20
  },
  rater_count: 2,
  target_kappa: DEFAULT_TARGET_IRR,
  timeline_weeks: 4
};

function cloneJsonCompatible(value) {
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function roundTo(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeDistribution(rawDistribution = {}, fallbackDistribution = DEFAULT_PILOT_STUDY_CONFIG.source_distribution) {
  const baseline = {
    ...fallbackDistribution,
    ...(rawDistribution && typeof rawDistribution === "object" ? rawDistribution : {})
  };

  const normalized = {};
  for (const [source, count] of Object.entries(baseline)) {
    const normalizedCount = toPositiveInteger(count, 0);
    if (normalizedCount > 0) {
      normalized[source] = normalizedCount;
    }
  }
  return normalized;
}

export function buildPilotStudyConfig(rawConfig = {}) {
  const sourceDistribution = normalizeDistribution(rawConfig.source_distribution);
  const totalFromDistribution = Object.values(sourceDistribution).reduce((sum, value) => sum + value, 0);
  const totalConversations = toPositiveInteger(rawConfig.total_conversations, totalFromDistribution || 100);

  return {
    total_conversations: totalConversations,
    source_distribution: sourceDistribution,
    rater_count: toPositiveInteger(rawConfig.rater_count, 2),
    target_kappa: toNumber(rawConfig.target_kappa) ?? DEFAULT_TARGET_IRR,
    timeline_weeks: toPositiveInteger(rawConfig.timeline_weeks, 4)
  };
}

export function validatePilotStudyConfig(config) {
  const findings = [];
  const distributionTotal = Object.values(config.source_distribution).reduce((sum, value) => sum + value, 0);

  if (distributionTotal !== config.total_conversations) {
    findings.push(
      `source_distribution total (${distributionTotal}) does not match total_conversations (${config.total_conversations}).`
    );
  }
  if (config.rater_count < 2) {
    findings.push("rater_count must be >= 2 for dual-rater reliability.");
  }
  if (config.target_kappa <= -1 || config.target_kappa > 1) {
    findings.push("target_kappa must be within (-1, 1].");
  }

  return {
    is_valid: findings.length === 0,
    findings
  };
}

export function buildValidationFramework(options = {}) {
  const stages = cloneJsonCompatible(options.stages ?? DEFAULT_VALIDATION_STAGES);
  const pilotStudy = buildPilotStudyConfig(options.pilot_study ?? DEFAULT_PILOT_STUDY_CONFIG);
  const pilotValidation = validatePilotStudyConfig(pilotStudy);

  return {
    generated_at: new Date().toISOString(),
    stages,
    pilot_study: pilotStudy,
    pilot_study_validation: pilotValidation
  };
}

function pickStageMetric(stage, metrics = {}) {
  if (typeof metrics[stage.key] === "number") {
    return metrics[stage.key];
  }
  if (typeof metrics[String(stage.stage_id)] === "number") {
    return metrics[String(stage.stage_id)];
  }
  if (typeof metrics[stage.target_metric] === "number") {
    return metrics[stage.target_metric];
  }
  return null;
}

function normalizeStage(rawStage) {
  return {
    stage_id: rawStage.stage_id,
    key: rawStage.key,
    name: rawStage.name,
    description: rawStage.description,
    target_metric: rawStage.target_metric,
    threshold: toNumber(rawStage.threshold) ?? 0
  };
}

export function evaluateValidationStages(framework, metrics = {}) {
  const stages = Array.isArray(framework?.stages) ? framework.stages.map((stage) => normalizeStage(stage)) : [];
  const evaluated = stages.map((stage) => {
    const currentValue = pickStageMetric(stage, metrics);
    let status = "pending";
    if (typeof currentValue === "number") {
      status = currentValue >= stage.threshold ? "passed" : "failed";
    }

    return {
      ...stage,
      current_value: currentValue,
      status
    };
  });

  const passed = evaluated.filter((stage) => stage.status === "passed").length;
  const failed = evaluated.filter((stage) => stage.status === "failed").length;
  const pending = evaluated.filter((stage) => stage.status === "pending").length;

  return {
    generated_at: new Date().toISOString(),
    summary: {
      stage_count: evaluated.length,
      passed,
      failed,
      pending,
      readiness: failed === 0 && pending === 0 ? "empirical_ready" : "not_ready"
    },
    stages: evaluated
  };
}

export function descriptiveStats(values) {
  if (!Array.isArray(values)) {
    return {};
  }

  const numbers = values.map((value) => toNumber(value)).filter((value) => value !== null);
  const n = numbers.length;
  if (!n) {
    return {};
  }

  const sorted = [...numbers].sort((left, right) => left - right);
  const mean = numbers.reduce((sum, value) => sum + value, 0) / n;
  const variance = numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n > 1 ? n - 1 : 1);
  const midpoint = Math.floor(n / 2);
  const median = n % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];

  return {
    n,
    mean: roundTo(mean),
    std: roundTo(Math.sqrt(variance)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: roundTo(median)
  };
}

export function confusionMatrix2x2(tp, fp, fn, tn) {
  const pTp = Math.max(0, toPositiveInteger(tp, 0));
  const pFp = Math.max(0, toPositiveInteger(fp, 0));
  const pFn = Math.max(0, toPositiveInteger(fn, 0));
  const pTn = Math.max(0, toPositiveInteger(tn, 0));

  const precision = pTp / Math.max(pTp + pFp, 1);
  const recall = pTp / Math.max(pTp + pFn, 1);
  const f1 = (2 * precision * recall) / Math.max(precision + recall, Number.EPSILON);
  const accuracy = (pTp + pTn) / Math.max(pTp + pFp + pFn + pTn, 1);
  const specificity = pTn / Math.max(pTn + pFp, 1);

  return {
    precision: roundTo(precision),
    recall: roundTo(recall),
    f1: roundTo(f1),
    accuracy: roundTo(accuracy),
    specificity: roundTo(specificity)
  };
}

function parseMetricsInput(metricsPath, irrReportPath) {
  const metrics = {};

  if (metricsPath) {
    const resolvedMetricsPath = path.resolve(metricsPath);
    const payload = readJson(resolvedMetricsPath);
    if (payload && typeof payload === "object") {
      Object.assign(metrics, payload);
    }
  }

  if (irrReportPath && typeof metrics.inter_rater_reliability !== "number" && typeof metrics.cohens_kappa !== "number") {
    const resolvedIrrPath = path.resolve(irrReportPath);
    const irrPayload = readJson(resolvedIrrPath);
    if (typeof irrPayload?.batch_kappa === "number") {
      metrics.inter_rater_reliability = irrPayload.batch_kappa;
      metrics.cohens_kappa = irrPayload.batch_kappa;
    }
  }

  return metrics;
}

function parseArgs(argv) {
  const args = {
    command: null,
    input: null,
    output: null,
    metrics: null,
    irr_report: null,
    values: null,
    tp: 0,
    fp: 0,
    fn: 0,
    tn: 0,
    enforce_all: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!args.command && !key.startsWith("--")) {
      args.command = key;
      continue;
    }

    if (key === "--input") {
      args.input = value;
      index += 1;
      continue;
    }
    if (key === "--output") {
      args.output = value;
      index += 1;
      continue;
    }
    if (key === "--metrics") {
      args.metrics = value;
      index += 1;
      continue;
    }
    if (key === "--irr-report") {
      args.irr_report = value;
      index += 1;
      continue;
    }
    if (key === "--values") {
      args.values = value;
      index += 1;
      continue;
    }
    if (key === "--tp") {
      args.tp = toPositiveInteger(value, 0);
      index += 1;
      continue;
    }
    if (key === "--fp") {
      args.fp = toPositiveInteger(value, 0);
      index += 1;
      continue;
    }
    if (key === "--fn") {
      args.fn = toPositiveInteger(value, 0);
      index += 1;
      continue;
    }
    if (key === "--tn") {
      args.tn = toPositiveInteger(value, 0);
      index += 1;
      continue;
    }
    if (key === "--enforce-all") {
      args.enforce_all = true;
      continue;
    }
  }

  return args;
}

function printUsage() {
  console.error(
    "Usage:\n" +
      "  node scripts/validation-framework.mjs plan [--output <path>]\n" +
      "  node scripts/validation-framework.mjs evaluate [--input <framework.json>] [--metrics <metrics.json>] [--irr-report <irr-report.json>] [--output <path>] [--enforce-all]\n" +
      "  node scripts/validation-framework.mjs stats --values 0.1,0.2,0.3 [--tp 1 --fp 2 --fn 3 --tn 4]"
  );
}

function runPlanCommand(args) {
  const framework = buildValidationFramework();
  if (args.output) {
    const outputPath = path.resolve(args.output);
    writeJson(outputPath, framework);
    console.log(`Validation framework saved: ${outputPath}`);
    return;
  }
  console.log(JSON.stringify(framework, null, 2));
}

function runEvaluateCommand(args) {
  const framework = args.input ? readJson(path.resolve(args.input)) : buildValidationFramework();
  const metrics = parseMetricsInput(args.metrics, args.irr_report);
  const report = evaluateValidationStages(framework, metrics);

  if (args.output) {
    const outputPath = path.resolve(args.output);
    writeJson(outputPath, report);
    console.log(`Validation evaluation report saved: ${outputPath}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (args.enforce_all && report.summary.readiness !== "empirical_ready") {
    process.exit(1);
  }
}

function runStatsCommand(args) {
  const values = String(args.values ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));
  const stats = descriptiveStats(values);
  const confusion = confusionMatrix2x2(args.tp, args.fp, args.fn, args.tn);

  console.log(
    JSON.stringify(
      {
        descriptive: stats,
        confusion_2x2: confusion
      },
      null,
      2
    )
  );
}

function runCli() {
  const args = parseArgs(process.argv);
  const command = args.command;
  if (!command || !["plan", "evaluate", "stats"].includes(command)) {
    printUsage();
    process.exit(2);
  }

  try {
    if (command === "plan") {
      runPlanCommand(args);
      process.exit(0);
    }
    if (command === "evaluate") {
      runEvaluateCommand(args);
      process.exit(0);
    }
    if (command === "stats") {
      runStatsCommand(args);
      process.exit(0);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli();
}

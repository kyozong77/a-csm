import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { runAcsmBatch } from "./acsm-batch-runner.mjs";
import { compareSuites } from "./regression-suite.mjs";

const DEFAULT_THRESHOLDS = {
  min_accuracy: 0.85,
  max_false_positive_rate: 0.15,
  max_false_negative_rate: 0.05,
  max_ms_per_conversation: 200,
  max_memory_mb: 512
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseArgs(argv) {
  const args = {
    batchInput: null,
    sampleSize: 100,
    baseline: null,
    output: null,
    writeBaseline: false,
    enforce: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key === "--batch-input") {
      args.batchInput = value;
      index += 1;
      continue;
    }
    if (key === "--sample-size") {
      args.sampleSize = Number(value);
      index += 1;
      continue;
    }
    if (key === "--baseline") {
      args.baseline = value;
      index += 1;
      continue;
    }
    if (key === "--output") {
      args.output = value;
      index += 1;
      continue;
    }
    if (key === "--write-baseline") {
      args.writeBaseline = true;
      continue;
    }
    if (key === "--enforce") {
      args.enforce = true;
    }
  }

  return args;
}

function loadBatchCases(batchInputPath, sampleSize) {
  const payload = readJson(batchInputPath);
  const cases = Array.isArray(payload?.cases) ? payload.cases.slice(0, sampleSize) : [];
  if (cases.length === 0) {
    throw new Error("Batch input must contain a non-empty cases array.");
  }
  return cases;
}

function compactResult(item) {
  return {
    id: item.id,
    output: {
      decision: item.result?.decision ?? item.decision ?? null,
      risk_status: item.result?.report?.risk_status ?? null,
      peak_status: item.result?.report?.peak_status ?? null,
      vcd_status: item.result?.summary?.vcdStatus ?? null,
      tag_decision_level: item.result?.summary?.tagDecisionLevel ?? null,
      unified_event_count: item.result?.summary?.unifiedEventCount ?? null,
      schema_decision: item.result?.summary?.schemaDecision ?? null,
      release_gate_decision: item.result?.summary?.releaseGateDecision ?? null
    }
  };
}

export function buildRegressionSuite(batchResult) {
  return {
    cases: Array.isArray(batchResult?.results) ? batchResult.results.map((item) => compactResult(item)) : []
  };
}

function isPositiveRiskStatus(value) {
  return typeof value === "string" && value !== "Normal";
}

export function calculateClassificationMetrics(baselineSuite, candidateSuite) {
  const baselineCases = new Map((baselineSuite?.cases ?? []).map((item) => [item.id, item.output]));
  const candidateCases = new Map((candidateSuite?.cases ?? []).map((item) => [item.id, item.output]));

  let total = 0;
  let exactMatches = 0;
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  for (const [caseId, baselineOutput] of baselineCases.entries()) {
    if (!candidateCases.has(caseId)) {
      continue;
    }
    total += 1;
    const candidateOutput = candidateCases.get(caseId);
    const expectedRisk = baselineOutput.risk_status;
    const actualRisk = candidateOutput.risk_status;
    if (expectedRisk === actualRisk) {
      exactMatches += 1;
    }
    const expectedPositive = isPositiveRiskStatus(expectedRisk);
    const actualPositive = isPositiveRiskStatus(actualRisk);
    if (expectedPositive && actualPositive) {
      tp += 1;
    } else if (!expectedPositive && !actualPositive) {
      tn += 1;
    } else if (!expectedPositive && actualPositive) {
      fp += 1;
    } else {
      fn += 1;
    }
  }

  const negativeBase = fp + tn;
  const positiveBase = tp + fn;
  return {
    total_cases: total,
    exact_matches: exactMatches,
    accuracy: total === 0 ? 0 : Number((exactMatches / total).toFixed(6)),
    false_positive_rate: negativeBase === 0 ? 0 : Number((fp / negativeBase).toFixed(6)),
    false_negative_rate: positiveBase === 0 ? 0 : Number((fn / positiveBase).toFixed(6)),
    confusion_matrix: { tp, tn, fp, fn }
  };
}

export function benchmarkBatch(cases) {
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  const batchResult = runAcsmBatch(
    { cases },
    {},
    {
      maxCases: cases.length,
      stopOnNoGo: false,
      includeResults: true
    }
  );
  const durationMs = performance.now() - started;
  const rssAfter = process.memoryUsage().rss;
  return {
    batchResult,
    metrics: {
      processed_cases: batchResult.summary.processedCases,
      ms_per_conversation: Number((durationMs / Math.max(batchResult.summary.processedCases, 1)).toFixed(6)),
      rss_memory_mb: Number((Math.max(rssBefore, rssAfter) / (1024 * 1024)).toFixed(6))
    }
  };
}

function normalizeThresholds(rawThresholds) {
  return {
    ...DEFAULT_THRESHOLDS,
    ...(rawThresholds ?? {})
  };
}

function buildBaselinePayload({ batchInputPath, sampleSize, thresholds, metrics, regressionSuite }) {
  return {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    batch_input_path: batchInputPath,
    sample_size: sampleSize,
    thresholds,
    metrics,
    regression_suite: regressionSuite
  };
}

function evaluateThresholds(metrics, thresholds, regressionReport) {
  return {
    accuracy_ok: metrics.accuracy >= thresholds.min_accuracy,
    false_positive_ok: metrics.false_positive_rate <= thresholds.max_false_positive_rate,
    false_negative_ok: metrics.false_negative_rate <= thresholds.max_false_negative_rate,
    latency_ok: metrics.ms_per_conversation <= thresholds.max_ms_per_conversation,
    memory_ok: metrics.rss_memory_mb <= thresholds.max_memory_mb,
    regression_ok: regressionReport.decision === "PASS"
  };
}

function buildReport({ batchInputPath, sampleSize, baselinePayload, benchmark, regressionSuite, regressionReport }) {
  const classification = calculateClassificationMetrics(
    baselinePayload.regression_suite,
    regressionSuite
  );
  const metrics = {
    ...classification,
    ...benchmark.metrics
  };
  const thresholds = normalizeThresholds(baselinePayload.thresholds);
  const validation = evaluateThresholds(metrics, thresholds, regressionReport);
  return {
    generated_at: new Date().toISOString(),
    input: {
      batch_input_path: batchInputPath,
      sample_size: sampleSize
    },
    thresholds,
    baseline_metrics: baselinePayload.metrics,
    current_metrics: metrics,
    regression_report: regressionReport,
    validation,
    summary: {
      readiness: Object.values(validation).every(Boolean) ? "ready" : "not_ready"
    }
  };
}

function runCli() {
  const args = parseArgs(process.argv);
  if (!args.batchInput || !args.baseline) {
    throw new Error("Missing required --batch-input <path> and --baseline <path> arguments.");
  }

  const batchInputPath = path.resolve(args.batchInput);
  const baselinePath = path.resolve(args.baseline);
  const cases = loadBatchCases(batchInputPath, args.sampleSize);
  const benchmark = benchmarkBatch(cases);
  const regressionSuite = buildRegressionSuite(benchmark.batchResult);

  let baselinePayload;
  if (fs.existsSync(baselinePath)) {
    baselinePayload = readJson(baselinePath);
  } else if (args.writeBaseline) {
    baselinePayload = buildBaselinePayload({
      batchInputPath,
      sampleSize: args.sampleSize,
      thresholds: DEFAULT_THRESHOLDS,
      metrics: {
        ...calculateClassificationMetrics(regressionSuite, regressionSuite),
        ...benchmark.metrics
      },
      regressionSuite
    });
    writeJson(baselinePath, baselinePayload);
  } else {
    throw new Error(`Baseline file not found: ${baselinePath}`);
  }

  const regressionReport = compareSuites(baselinePayload.regression_suite, regressionSuite, {});
  const report = buildReport({
    batchInputPath,
    sampleSize: args.sampleSize,
    baselinePayload,
    benchmark,
    regressionSuite,
    regressionReport
  });

  if (args.output) {
    writeJson(path.resolve(args.output), report);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (args.enforce && report.summary.readiness !== "ready") {
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

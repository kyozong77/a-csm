import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "1.1.0";

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeCase(rawCase, sourceName, index, failures) {
  if (!rawCase || typeof rawCase !== "object" || Array.isArray(rawCase)) {
    failures.push({
      kind: "invalid-case",
      source: sourceName,
      caseIndex: index,
      message: `${sourceName} case at index ${index} must be an object.`
    });
    return null;
  }

  if (!isNonEmptyString(rawCase.id)) {
    failures.push({
      kind: "invalid-case-id",
      source: sourceName,
      caseIndex: index,
      message: `${sourceName} case at index ${index} has invalid id.`
    });
    return null;
  }

  return {
    id: rawCase.id.trim(),
    output: rawCase.output
  };
}

function normalizeSuite(rawSuite, sourceName) {
  const failures = [];

  if (!rawSuite || typeof rawSuite !== "object" || Array.isArray(rawSuite)) {
    failures.push({
      kind: "invalid-suite",
      source: sourceName,
      message: `${sourceName} suite must be an object.`
    });
    return { casesById: new Map(), failures };
  }

  if (!Array.isArray(rawSuite.cases)) {
    failures.push({
      kind: "invalid-cases",
      source: sourceName,
      message: `${sourceName} suite must provide a 'cases' array.`
    });
    return { casesById: new Map(), failures };
  }

  const casesById = new Map();

  for (let index = 0; index < rawSuite.cases.length; index += 1) {
    const normalized = normalizeCase(rawSuite.cases[index], sourceName, index, failures);
    if (!normalized) {
      continue;
    }

    if (casesById.has(normalized.id)) {
      failures.push({
        kind: "duplicate-case-id",
        source: sourceName,
        caseId: normalized.id,
        message: `${sourceName} suite has duplicate case id '${normalized.id}'.`
      });
      continue;
    }

    casesById.set(normalized.id, normalized);
  }

  return { casesById, failures };
}

function classifyMismatch(baselineOutput, candidateOutput) {
  if (typeof baselineOutput !== typeof candidateOutput) {
    return "type-mismatch";
  }

  if (baselineOutput === null || candidateOutput === null) {
    return "value-mismatch";
  }

  if (typeof baselineOutput === "string") {
    return "text-mismatch";
  }

  if (Array.isArray(baselineOutput) || typeof baselineOutput === "object") {
    return "structure-mismatch";
  }

  return "value-mismatch";
}

function roundRate(value) {
  return Number(value.toFixed(6));
}

function computeRates(baselineCases, matchedCases, blockingFailures) {
  if (baselineCases === 0) {
    const passRate = blockingFailures === 0 ? 1 : 0;
    return {
      passRate,
      failRate: roundRate(1 - passRate)
    };
  }

  const passRate = roundRate(matchedCases / baselineCases);
  return {
    passRate,
    failRate: roundRate(1 - passRate)
  };
}

function countByKey(items, keyBuilder) {
  const counts = {};
  for (const item of items) {
    const key = keyBuilder(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function isWarningFailure(item) {
  return item.kind === "unexpected-case" || item.kind === "invalid-previous-report";
}

function computeBlockingFailures(failures, strictWarnings) {
  if (strictWarnings) {
    return failures;
  }
  return failures.filter((item) => !isWarningFailure(item));
}

function buildSummary({
  baselineCases,
  candidateCases,
  matchedCases,
  failures,
  strictWarnings
}) {
  const blocking = computeBlockingFailures(failures, strictWarnings);
  const warningFailures = failures.length - blocking.length;
  const rates = computeRates(baselineCases, matchedCases, blocking.length);

  return {
    baselineCases,
    candidateCases,
    matchedCases,
    totalFailures: failures.length,
    blockingFailures: blocking.length,
    warningFailures,
    passRate: rates.passRate,
    failRate: rates.failRate,
    strictWarningsApplied: strictWarnings,
    failureCounts: countByKey(failures, (item) => item.kind),
    mismatchTypeCounts: countByKey(
      failures.filter((item) => item.kind === "output-mismatch"),
      (item) => item.mismatchType
    )
  };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePreviousSummary(previousReport) {
  if (!previousReport || typeof previousReport !== "object" || Array.isArray(previousReport)) {
    return null;
  }
  const previousSummary = previousReport.summary;
  if (!previousSummary || typeof previousSummary !== "object" || Array.isArray(previousSummary)) {
    return null;
  }

  const requiredFields = ["matchedCases", "blockingFailures", "warningFailures", "passRate", "failRate"];
  for (const field of requiredFields) {
    if (!isFiniteNumber(previousSummary[field])) {
      return null;
    }
  }

  return previousSummary;
}

function computeTrend(currentSummary, previousReport) {
  const previousSummary = normalizePreviousSummary(previousReport);
  if (!previousSummary) {
    return {
      available: false,
      reason: "missing-or-invalid-previous-summary"
    };
  }

  return {
    available: true,
    previous: {
      matchedCases: previousSummary.matchedCases,
      blockingFailures: previousSummary.blockingFailures,
      warningFailures: previousSummary.warningFailures,
      passRate: previousSummary.passRate,
      failRate: previousSummary.failRate
    },
    delta: {
      matchedCases: currentSummary.matchedCases - previousSummary.matchedCases,
      blockingFailures: currentSummary.blockingFailures - previousSummary.blockingFailures,
      warningFailures: currentSummary.warningFailures - previousSummary.warningFailures,
      passRate: roundRate(currentSummary.passRate - previousSummary.passRate),
      failRate: roundRate(currentSummary.failRate - previousSummary.failRate)
    }
  };
}

export function validateRegressionReport(result) {
  const violations = [];
  const summary = result?.summary;
  const failures = Array.isArray(result?.failures) ? result.failures : [];
  const matches = Array.isArray(result?.matches) ? result.matches : [];

  if (!summary || typeof summary !== "object") {
    violations.push("summary must be an object.");
  } else {
    if (summary.totalFailures !== failures.length) {
      violations.push("summary.totalFailures must equal failures.length.");
    }
    if (summary.matchedCases !== matches.length) {
      violations.push("summary.matchedCases must equal matches.length.");
    }
    if (summary.blockingFailures + summary.warningFailures !== summary.totalFailures) {
      violations.push("blocking + warning failures must equal total failures.");
    }
    if (!isFiniteNumber(summary.passRate) || summary.passRate < 0 || summary.passRate > 1) {
      violations.push("summary.passRate must be between 0 and 1.");
    }
    if (!isFiniteNumber(summary.failRate) || summary.failRate < 0 || summary.failRate > 1) {
      violations.push("summary.failRate must be between 0 and 1.");
    }
    if (isFiniteNumber(summary.passRate) && isFiniteNumber(summary.failRate)) {
      const total = roundRate(summary.passRate + summary.failRate);
      if (Math.abs(total - 1) > 0.000001) {
        violations.push("summary.passRate + summary.failRate must be 1.");
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations
  };
}

export function compareSuites(rawBaseline, rawCandidate, options = {}) {
  const strictWarnings = Boolean(options.strictWarnings);
  const baseline = normalizeSuite(rawBaseline, "baseline");
  const candidate = normalizeSuite(rawCandidate, "candidate");

  const failures = [...baseline.failures, ...candidate.failures];
  const matches = [];

  const baselineIds = new Set(baseline.casesById.keys());
  const candidateIds = new Set(candidate.casesById.keys());

  for (const caseId of baselineIds) {
    if (!candidateIds.has(caseId)) {
      failures.push({
        kind: "missing-case",
        caseId,
        message: `Candidate is missing case '${caseId}'.`
      });
    }
  }

  for (const caseId of candidateIds) {
    if (!baselineIds.has(caseId)) {
      failures.push({
        kind: "unexpected-case",
        caseId,
        message: `Candidate has unexpected case '${caseId}'.`
      });
    }
  }

  for (const caseId of baselineIds) {
    if (!candidateIds.has(caseId)) {
      continue;
    }

    const baselineCase = baseline.casesById.get(caseId);
    const candidateCase = candidate.casesById.get(caseId);

    const baselineOutput = stableStringify(baselineCase.output);
    const candidateOutput = stableStringify(candidateCase.output);

    if (baselineOutput !== candidateOutput) {
      failures.push({
        kind: "output-mismatch",
        mismatchType: classifyMismatch(baselineCase.output, candidateCase.output),
        caseId,
        baselineOutput,
        candidateOutput,
        message: `Output mismatch on case '${caseId}'.`
      });
      continue;
    }

    matches.push(caseId);
  }

  let summary = buildSummary({
    baselineCases: baselineIds.size,
    candidateCases: candidateIds.size,
    matchedCases: matches.length,
    failures,
    strictWarnings
  });

  let trend = null;
  if (options.previousReport !== undefined) {
    trend = computeTrend(summary, options.previousReport);
    if (!trend.available) {
      failures.push({
        kind: "invalid-previous-report",
        message: "Previous report summary is missing or invalid; trend comparison skipped."
      });
      summary = buildSummary({
        baselineCases: baselineIds.size,
        candidateCases: candidateIds.size,
        matchedCases: matches.length,
        failures,
        strictWarnings
      });
      trend = computeTrend(summary, options.previousReport);
    }
  }

  const blocking = computeBlockingFailures(failures, strictWarnings);
  const result = {
    schemaVersion: SCHEMA_VERSION,
    decision: blocking.length === 0 ? "PASS" : "FAIL",
    generatedAt: new Date().toISOString(),
    summary,
    failures,
    matches,
    trend
  };

  let smoke = validateRegressionReport(result);
  if (!smoke.passed) {
    failures.push({
      kind: "report-invariant-violation",
      message: `Regression report invariant violations: ${smoke.violations.join(" | ")}`
    });
    result.summary = buildSummary({
      baselineCases: baselineIds.size,
      candidateCases: candidateIds.size,
      matchedCases: matches.length,
      failures,
      strictWarnings
    });
    result.decision = computeBlockingFailures(failures, strictWarnings).length === 0 ? "PASS" : "FAIL";
    smoke = validateRegressionReport(result);
  }
  result.smoke = smoke;

  return result;
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# Regression Suite Result");
  lines.push("");
  lines.push(`- Decision: **${result.decision}**`);
  lines.push(`- Schema version: ${result.schemaVersion}`);
  lines.push(`- Generated at: ${result.generatedAt}`);
  lines.push(`- Matched cases: ${result.summary.matchedCases}`);
  lines.push(`- Pass rate: ${result.summary.passRate}`);
  lines.push(`- Fail rate: ${result.summary.failRate}`);
  lines.push(`- Total failures: ${result.summary.totalFailures}`);
  lines.push(`- Blocking failures: ${result.summary.blockingFailures}`);
  lines.push(`- Warning failures: ${result.summary.warningFailures}`);
  lines.push(`- Strict warnings: ${result.summary.strictWarningsApplied}`);
  lines.push(`- Smoke check: ${result.smoke?.passed ? "PASS" : "FAIL"}`);
  if (result.trend) {
    lines.push(
      `- Trend: ${result.trend.available ? "available" : `unavailable (${result.trend.reason})`}`
    );
  }
  lines.push("");
  lines.push("## Failures");
  lines.push("");

  if (result.failures.length === 0) {
    lines.push("- None");
  } else {
    for (const failure of result.failures) {
      const severity = failure.kind === "unexpected-case" ? "WARN" : "BLOCK";
      lines.push(`- [${severity}] ${failure.kind}${failure.caseId ? ` (${failure.caseId})` : ""}: ${failure.message}`);
    }
  }

  return lines.join("\n");
}

function parseArgs(argv) {
  const args = {
    baseline: null,
    candidate: null,
    output: null,
    format: "json",
    previousReport: null,
    strictWarnings: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key === "--baseline") {
      args.baseline = value;
      index += 1;
      continue;
    }

    if (key === "--candidate") {
      args.candidate = value;
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
      continue;
    }

    if (key === "--previous-report") {
      args.previousReport = value;
      index += 1;
      continue;
    }

    if (key === "--strict-warnings") {
      args.strictWarnings = true;
    }
  }

  return args;
}

function writeOutput(outputPath, content) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
}

function runCli() {
  const args = parseArgs(process.argv);
  if (!args.baseline || !args.candidate) {
    console.error("Missing required --baseline <path> and --candidate <path> arguments.");
    process.exit(2);
  }

  const baseline = readJsonFile(args.baseline);
  const candidate = readJsonFile(args.candidate);
  const previousReport = args.previousReport ? readJsonFile(args.previousReport) : undefined;
  const result = compareSuites(baseline, candidate, {
    previousReport,
    strictWarnings: args.strictWarnings
  });

  const jsonOutput = JSON.stringify(result, null, 2);
  const markdownOutput = renderMarkdown(result);

  if (args.output) {
    if (args.format === "markdown") {
      writeOutput(args.output, markdownOutput);
    } else if (args.format === "both") {
      writeOutput(args.output, jsonOutput);
      writeOutput(`${args.output}.md`, markdownOutput);
    } else {
      writeOutput(args.output, jsonOutput);
    }
  }

  if (args.format === "markdown") {
    console.log(markdownOutput);
  } else {
    console.log(jsonOutput);
    if (args.format === "both") {
      console.log("\n---\n");
      console.log(markdownOutput);
    }
  }

  process.exit(result.decision === "PASS" ? 0 : 1);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli();
}

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runAcsmOrchestrator } from "./acsm-orchestrator.mjs";

const DEFAULT_BATCH_OPTIONS = {
  maxCases: 200,
  stopOnNoGo: false,
  includeResults: false,
  resumeFrom: null
};

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addFinding(findings, id, severity, message, blocking) {
  findings.push({ id, severity, message, blocking: Boolean(blocking) });
}

function addTrace(trace, step, message, data = null) {
  trace.push({
    step,
    message,
    ...(data === null ? {} : { data })
  });
}

function parseBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

function normalizeBatchOptions(rawOptions = {}, findings) {
  const options = {
    ...DEFAULT_BATCH_OPTIONS,
    ...(isObject(rawOptions) ? rawOptions : {})
  };

  const maxCases = Number(options.maxCases);
  if (!Number.isInteger(maxCases) || maxCases < 1) {
    addFinding(
      findings,
      "batch-max-cases-invalid",
      "error",
      "Batch option 'maxCases' must be an integer greater than 0.",
      true
    );
    options.maxCases = DEFAULT_BATCH_OPTIONS.maxCases;
  } else {
    options.maxCases = maxCases;
  }

  options.stopOnNoGo = parseBoolean(options.stopOnNoGo, DEFAULT_BATCH_OPTIONS.stopOnNoGo);
  options.includeResults = parseBoolean(options.includeResults, DEFAULT_BATCH_OPTIONS.includeResults);
  if (typeof options.resumeFrom === "string" && options.resumeFrom.trim() !== "") {
    options.resumeFrom = options.resumeFrom.trim();
  } else {
    options.resumeFrom = null;
  }

  return options;
}

function normalizeDecision(value) {
  return value === "GO" ? "GO" : "NO_GO";
}

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function normalizeCaseSummary(rawItem, fallbackId) {
  const id =
    isObject(rawItem) && typeof rawItem.id === "string" && rawItem.id.trim()
      ? rawItem.id.trim()
      : fallbackId;

  return {
    id,
    decision: normalizeDecision(rawItem?.decision),
    blockingFindings: parseNonNegativeInteger(rawItem?.blockingFindings, 0),
    unifiedEventCount: parseNonNegativeInteger(rawItem?.unifiedEventCount, 0),
    vcdStatus: typeof rawItem?.vcdStatus === "string" ? rawItem.vcdStatus : null,
    tagDecisionLevel: typeof rawItem?.tagDecisionLevel === "string" ? rawItem.tagDecisionLevel : null,
    schemaDecision: typeof rawItem?.schemaDecision === "string" ? rawItem.schemaDecision : null,
    releaseGateDecision:
      typeof rawItem?.releaseGateDecision === "string" ? rawItem.releaseGateDecision : null
  };
}

function loadResumeState(resumeFrom, findings) {
  const state = {
    source: null,
    caseSummaryById: new Map(),
    resultById: new Map()
  };

  if (!resumeFrom) {
    return state;
  }

  const resolved = path.resolve(resumeFrom);
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addFinding(
      findings,
      "batch-resume-read-failed",
      "error",
      `Unable to read resume file '${resolved}': ${message}`,
      true
    );
    return state;
  }

  if (!isObject(payload)) {
    addFinding(
      findings,
      "batch-resume-payload-invalid",
      "error",
      `Resume file '${resolved}' must contain a JSON object.`,
      true
    );
    return state;
  }

  if (!Array.isArray(payload.cases)) {
    addFinding(
      findings,
      "batch-resume-cases-invalid",
      "error",
      `Resume file '${resolved}' must contain a 'cases' array.`,
      true
    );
    return state;
  }

  for (let index = 0; index < payload.cases.length; index += 1) {
    const summary = normalizeCaseSummary(payload.cases[index], `resume-case-${index + 1}`);
    state.caseSummaryById.set(summary.id, summary);
  }

  if (Array.isArray(payload.results)) {
    for (const item of payload.results) {
      if (!isObject(item) || typeof item.id !== "string" || !item.id.trim()) {
        continue;
      }
      state.resultById.set(item.id.trim(), item.result);
    }
  }

  state.source = resolved;
  return state;
}

function normalizeCases(rawInput, findings) {
  if (Array.isArray(rawInput)) {
    return rawInput.map((payload, index) => ({
      id: `case-${index + 1}`,
      payload
    }));
  }

  if (isObject(rawInput) && Array.isArray(rawInput.cases)) {
    return rawInput.cases.map((item, index) => {
      const id = isObject(item) && typeof item.id === "string" && item.id.trim() ? item.id.trim() : `case-${index + 1}`;
      const payload = isObject(item) && Object.prototype.hasOwnProperty.call(item, "input") ? item.input : item;
      return { id, payload };
    });
  }

  if (isObject(rawInput)) {
    return [
      {
        id: "case-1",
        payload: rawInput
      }
    ];
  }

  addFinding(findings, "batch-input-invalid", "error", "Batch input must be an object or array.", true);
  return [];
}

function toCaseSummary(id, result) {
  return {
    id,
    decision: result.decision,
    blockingFindings: Number(result.summary?.blockingFindings ?? 0),
    unifiedEventCount: Number(result.summary?.unifiedEventCount ?? 0),
    vcdStatus: result.summary?.vcdStatus ?? null,
    tagDecisionLevel: result.summary?.tagDecisionLevel ?? null,
    schemaDecision: result.summary?.schemaDecision ?? null,
    releaseGateDecision: result.summary?.releaseGateDecision ?? null
  };
}

function hasBlocking(findings) {
  return findings.some((item) => item.blocking);
}

export function runAcsmBatch(rawInput = {}, orchestratorConfig = {}, rawBatchOptions = {}) {
  const findings = [];
  const trace = [];
  const options = normalizeBatchOptions(rawBatchOptions, findings);
  const cases = normalizeCases(rawInput, findings);
  const resumeState = loadResumeState(options.resumeFrom, findings);

  addTrace(trace, "input", "Normalized batch input and options.", {
    caseCount: cases.length,
    maxCases: options.maxCases,
    stopOnNoGo: options.stopOnNoGo,
    includeResults: options.includeResults,
    resumeFrom: options.resumeFrom
  });
  if (resumeState.source) {
    addTrace(trace, "resume", "Loaded resume state from previous batch output.", {
      source: resumeState.source,
      resumeCaseCount: resumeState.caseSummaryById.size
    });
  }

  if (cases.length > options.maxCases) {
    addFinding(
      findings,
      "batch-max-cases-exceeded",
      "error",
      `Input contains ${cases.length} cases, exceeds maxCases=${options.maxCases}.`,
      true
    );
  }

  if (hasBlocking(findings)) {
    return {
      generatedAt: new Date().toISOString(),
      decision: "NO_GO",
      options,
      summary: {
        totalCases: cases.length,
        processedCases: 0,
        resumedCases: 0,
        goCases: 0,
        noGoCases: 0,
        skippedCases: cases.length,
        stopReason: "validation",
        blockingFindings: findings.filter((item) => item.blocking).length
      },
      findings,
      trace,
      cases: [],
      ...(options.includeResults ? { results: [] } : {})
    };
  }

  const caseSummaries = [];
  const results = [];
  let goCases = 0;
  let noGoCases = 0;
  let processedCases = 0;
  let resumedCases = 0;
  let stopReason = null;

  for (let index = 0; index < cases.length; index += 1) {
    const current = cases[index];
    const resumedSummary = resumeState.caseSummaryById.get(current.id);
    if (resumedSummary) {
      resumedCases += 1;
      if (resumedSummary.decision === "GO") {
        goCases += 1;
      } else {
        noGoCases += 1;
      }

      caseSummaries.push({
        ...resumedSummary,
        resumed: true
      });

      if (options.includeResults) {
        const resumedResult = resumeState.resultById.get(current.id);
        if (resumedResult !== undefined) {
          results.push({
            id: current.id,
            result: resumedResult,
            resumed: true
          });
        }
      }

      if (options.stopOnNoGo && resumedSummary.decision === "NO_GO") {
        stopReason = "no-go";
        addTrace(trace, "stop", "Stopped batch due to resumed NO_GO case under stopOnNoGo policy.", {
          caseId: current.id,
          processedCases,
          resumedCases
        });
        break;
      }
      continue;
    }

    let result;
    try {
      result = runAcsmOrchestrator(current.payload, orchestratorConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addFinding(
        findings,
        "batch-case-execution-failed",
        "error",
        `Case '${current.id}' execution failed: ${message}`,
        true
      );
      result = {
        decision: "NO_GO",
        summary: {
          blockingFindings: 1,
          unifiedEventCount: 0,
          vcdStatus: null,
          tagDecisionLevel: null,
          schemaDecision: "FAIL",
          releaseGateDecision: "NO_GO"
        }
      };
    }

    processedCases += 1;
    if (result.decision === "GO") {
      goCases += 1;
    } else {
      noGoCases += 1;
    }

    caseSummaries.push(toCaseSummary(current.id, result));

    if (options.includeResults) {
      results.push({
        id: current.id,
        result
      });
    }

    if (options.stopOnNoGo && result.decision === "NO_GO") {
      stopReason = "no-go";
      addTrace(trace, "stop", "Stopped batch due to NO_GO case under stopOnNoGo policy.", {
        caseId: current.id,
        processedCases,
        resumedCases
      });
      break;
    }
  }

  const skippedCases = Math.max(cases.length - processedCases - resumedCases, 0);
  const blockingFindings = findings.filter((item) => item.blocking).length;
  const decision = noGoCases === 0 && blockingFindings === 0 ? "GO" : "NO_GO";

  addTrace(trace, "summary", "Batch execution completed.", {
    decision,
    totalCases: cases.length,
    processedCases,
    resumedCases,
    goCases,
    noGoCases,
    skippedCases
  });

  return {
    generatedAt: new Date().toISOString(),
    decision,
    options,
    summary: {
      totalCases: cases.length,
      processedCases,
      resumedCases,
      goCases,
      noGoCases,
      skippedCases,
      stopReason,
      blockingFindings
    },
    findings,
    trace,
    cases: caseSummaries,
    ...(options.includeResults ? { results } : {})
  };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# A-CSM Batch Runner Result");
  lines.push("");
  lines.push(`- Decision: **${result.decision}**`);
  lines.push(`- Generated at: ${result.generatedAt}`);
  lines.push(`- Total cases: ${result.summary.totalCases}`);
  lines.push(`- Processed: ${result.summary.processedCases}`);
  lines.push(`- Resumed: ${result.summary.resumedCases}`);
  lines.push(`- GO cases: ${result.summary.goCases}`);
  lines.push(`- NO_GO cases: ${result.summary.noGoCases}`);
  lines.push(`- Skipped: ${result.summary.skippedCases}`);
  lines.push(`- Blocking findings: ${result.summary.blockingFindings}`);
  lines.push("");
  lines.push("## Case Decisions");
  lines.push("");
  if (result.cases.length === 0) {
    lines.push("- None");
  } else {
    for (const item of result.cases) {
      lines.push(`- ${item.id}: ${item.decision} (blocking=${item.blockingFindings})`);
    }
  }
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (result.findings.length === 0) {
    lines.push("- None");
  } else {
    for (const finding of result.findings) {
      lines.push(`- [${finding.blocking ? "BLOCK" : "WARN"}] ${finding.id}: ${finding.message}`);
    }
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = {
    input: null,
    config: null,
    output: null,
    format: "json",
    maxCases: DEFAULT_BATCH_OPTIONS.maxCases,
    stopOnNoGo: false,
    includeResults: false,
    resumeFrom: null
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key === "--input") {
      args.input = value;
      index += 1;
      continue;
    }
    if (key === "--config") {
      args.config = value;
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
    if (key === "--max-cases") {
      args.maxCases = value;
      index += 1;
      continue;
    }
    if (key === "--stop-on-no-go") {
      if (value === "true" || value === "false") {
        args.stopOnNoGo = value === "true";
        index += 1;
      } else {
        args.stopOnNoGo = true;
      }
      continue;
    }
    if (key === "--include-results") {
      if (value === "true" || value === "false") {
        args.includeResults = value === "true";
        index += 1;
      } else {
        args.includeResults = true;
      }
      continue;
    }
    if (key === "--resume-from") {
      args.resumeFrom = value;
      index += 1;
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
  if (!args.input) {
    console.error("Missing required --input <path> argument.");
    process.exit(2);
  }

  const input = readJsonFile(args.input);
  const config = args.config ? readJsonFile(args.config) : {};
  const result = runAcsmBatch(input, config, {
    maxCases: args.maxCases,
    stopOnNoGo: args.stopOnNoGo,
    includeResults: args.includeResults,
    resumeFrom: args.resumeFrom
  });

  const json = JSON.stringify(result, null, 2);
  const markdown = renderMarkdown(result);

  if (args.output) {
    if (args.format === "markdown") {
      writeOutput(args.output, markdown);
    } else if (args.format === "both") {
      writeOutput(args.output, json);
      writeOutput(`${args.output}.md`, markdown);
    } else {
      writeOutput(args.output, json);
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
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli();
}

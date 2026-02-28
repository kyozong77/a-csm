import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "1.0.0";

const DEFAULT_CONFIG = {
  requiredTopLevelFields: ["schemaVersion", "ps", "sub", "f", "e", "vcd", "event_log"],
  allowedPs: ["ST_NRM", "ST_DEV", "ST_ALM"],
  allowedSub: ["SUB_NONE", "SUB_SAFE_MODE", "SUB_FR", "SUB_CA", "SUB_SR", "SUB_SA"],
  allowedEventAxis: ["FR", "CA", "SR", "SA"],
  allowedEventSeverity: ["low", "medium", "high", "critical"],
  maxEvidenceLength: 320,
  requireEventIds: true,
  invariantRules: {
    alarmRequiresFlag: true,
    normalRequiresSafeSub: true,
    requireTraceWhenVcdTriggered: true,
    requireEventTurnOrder: true
  }
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function toInteger(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

function addFinding(findings, code, severity, message, pathRef, blocking = severity === "error") {
  findings.push({
    code,
    severity,
    message,
    path: pathRef,
    blocking
  });
}

function addTrace(trace, step, message, metadata = {}) {
  trace.push({
    step,
    message,
    metadata,
    at: new Date().toISOString()
  });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function mergeConfig(configInput) {
  const merged = structuredClone(DEFAULT_CONFIG);
  if (!isObject(configInput)) {
    return merged;
  }

  for (const key of [
    "requiredTopLevelFields",
    "allowedPs",
    "allowedSub",
    "allowedEventAxis",
    "allowedEventSeverity"
  ]) {
    if (Array.isArray(configInput[key])) {
      merged[key] = [...new Set(configInput[key].filter((value) => isNonEmptyString(value)).map((value) => value.trim()))];
    }
  }

  if (typeof configInput.maxEvidenceLength === "number" && Number.isInteger(configInput.maxEvidenceLength) && configInput.maxEvidenceLength > 0) {
    merged.maxEvidenceLength = configInput.maxEvidenceLength;
  }

  if (typeof configInput.requireEventIds === "boolean") {
    merged.requireEventIds = configInput.requireEventIds;
  }

  if (isObject(configInput.invariantRules)) {
    merged.invariantRules = {
      ...merged.invariantRules,
      ...configInput.invariantRules
    };
  }

  return merged;
}

function normalizeBatchInput(input) {
  if (Array.isArray(input)) {
    return input.map((item, index) => ({
      id: `case-${index + 1}`,
      payload: item
    }));
  }

  if (isObject(input) && Array.isArray(input.cases)) {
    return input.cases.map((item, index) => {
      const id = isNonEmptyString(item?.id) ? item.id.trim() : `case-${index + 1}`;
      const payload = isObject(item) && "output" in item ? item.output : item;
      return { id, payload };
    });
  }

  return [{ id: "case-1", payload: input }];
}

function validateTopLevel(output, config, findings) {
  if (!isObject(output)) {
    addFinding(findings, "schema-output-invalid", "error", "USCI output must be an object.", "$");
    return;
  }

  for (const field of config.requiredTopLevelFields) {
    if (!(field in output)) {
      addFinding(findings, "schema-required-missing", "error", `Missing required field '${field}'.`, `$.${field}`);
    }
  }

  if ("schemaVersion" in output && !isNonEmptyString(output.schemaVersion)) {
    addFinding(findings, "schema-version-invalid", "error", "schemaVersion must be a non-empty string.", "$.schemaVersion");
  }

  if ("ps" in output && !config.allowedPs.includes(output.ps)) {
    addFinding(findings, "schema-ps-invalid", "error", `ps must be one of: ${config.allowedPs.join(", ")}.`, "$.ps");
  }

  if ("sub" in output && !config.allowedSub.includes(output.sub)) {
    addFinding(findings, "schema-sub-invalid", "error", `sub must be one of: ${config.allowedSub.join(", ")}.`, "$.sub");
  }

  if ("f" in output && typeof output.f !== "boolean") {
    addFinding(findings, "schema-f-invalid", "error", "f must be boolean.", "$.f");
  }

  if ("e" in output) {
    if (!isNonEmptyString(output.e)) {
      addFinding(findings, "schema-e-invalid", "error", "e must be a non-empty evidence summary string.", "$.e");
    } else if (output.e.length > config.maxEvidenceLength) {
      addFinding(findings, "schema-e-too-long", "error", `e exceeds maxEvidenceLength=${config.maxEvidenceLength}.`, "$.e");
    }
  }

  if ("vcd" in output) {
    if (!isObject(output.vcd)) {
      addFinding(findings, "schema-vcd-invalid", "error", "vcd must be an object.", "$.vcd");
    } else {
      if (!isNonEmptyString(output.vcd.level)) {
        addFinding(findings, "schema-vcd-level-missing", "error", "vcd.level is required.", "$.vcd.level");
      }
      if (!isNonEmptyString(output.vcd.status)) {
        addFinding(findings, "schema-vcd-status-missing", "error", "vcd.status is required.", "$.vcd.status");
      }
      if (!Array.isArray(output.vcd.trace)) {
        addFinding(findings, "schema-vcd-trace-invalid", "error", "vcd.trace must be an array.", "$.vcd.trace");
      }
    }
  }

  if ("event_log" in output) {
    if (!Array.isArray(output.event_log)) {
      addFinding(findings, "schema-event-log-invalid", "error", "event_log must be an array.", "$.event_log");
    }
  }
}

function validateEventLog(output, config, findings) {
  if (!Array.isArray(output?.event_log)) {
    return;
  }

  let lastTurnIndex = -Infinity;
  for (let index = 0; index < output.event_log.length; index += 1) {
    const item = output.event_log[index];
    const pathBase = `$.event_log[${index}]`;

    if (!isObject(item)) {
      addFinding(findings, "event-item-invalid", "error", "event_log items must be objects.", pathBase);
      continue;
    }

    if (config.requireEventIds && !isNonEmptyString(item.eventId)) {
      addFinding(findings, "event-id-missing", "error", "eventId is required.", `${pathBase}.eventId`);
    }

    if (!config.allowedEventAxis.includes(item.axis)) {
      addFinding(findings, "event-axis-invalid", "error", `axis must be one of: ${config.allowedEventAxis.join(", ")}.`, `${pathBase}.axis`);
    }

    if (!config.allowedEventSeverity.includes(item.severity)) {
      addFinding(
        findings,
        "event-severity-invalid",
        "error",
        `severity must be one of: ${config.allowedEventSeverity.join(", ")}.`,
        `${pathBase}.severity`
      );
    }

    const turnIndex = toInteger(item.turn_index);
    if (turnIndex === null || turnIndex < 0) {
      addFinding(findings, "event-turn-index-invalid", "error", "turn_index must be a non-negative integer.", `${pathBase}.turn_index`);
      continue;
    }

    if (config.invariantRules.requireEventTurnOrder && turnIndex < lastTurnIndex) {
      addFinding(
        findings,
        "event-turn-order-violation",
        "error",
        "turn_index must be non-decreasing across event_log.",
        `${pathBase}.turn_index`
      );
    }

    lastTurnIndex = turnIndex;
  }
}

function validateInvariants(output, config, findings) {
  if (!isObject(output)) {
    return;
  }

  if (config.invariantRules.alarmRequiresFlag && output.ps === "ST_ALM" && output.f !== true) {
    addFinding(findings, "inv-alarm-requires-flag", "error", "When ps=ST_ALM, f must be true.", "$.f");
  }

  if (config.invariantRules.normalRequiresSafeSub && output.ps === "ST_NRM" && !["SUB_NONE", "SUB_SAFE_MODE"].includes(output.sub)) {
    addFinding(
      findings,
      "inv-normal-safe-sub",
      "error",
      "When ps=ST_NRM, sub must be SUB_NONE or SUB_SAFE_MODE.",
      "$.sub"
    );
  }

  if (
    config.invariantRules.requireTraceWhenVcdTriggered
    && isObject(output.vcd)
    && String(output.vcd.status).toUpperCase() === "TRIGGERED"
    && (!Array.isArray(output.vcd.trace) || output.vcd.trace.length === 0)
  ) {
    addFinding(
      findings,
      "inv-vcd-triggered-trace",
      "error",
      "When vcd.status is TRIGGERED, vcd.trace must include at least one item.",
      "$.vcd.trace"
    );
  }
}

function summarize(findings) {
  const blockingFindings = findings.filter((item) => item.blocking).length;
  const warningFindings = findings.length - blockingFindings;
  return {
    totalFindings: findings.length,
    blockingFindings,
    warningFindings,
    decision: blockingFindings === 0 ? "PASS" : "FAIL"
  };
}

export function validateUsciOutput(output, configInput = {}) {
  const findings = [];
  const trace = [];
  const config = mergeConfig(configInput);

  addTrace(trace, "config", "Merged validation config.", {
    requiredTopLevelFields: config.requiredTopLevelFields.length,
    allowedPs: config.allowedPs.length,
    allowedSub: config.allowedSub.length
  });

  validateTopLevel(output, config, findings);
  addTrace(trace, "schema", "Top-level schema validation complete.", {
    findings: findings.length
  });

  validateEventLog(output, config, findings);
  addTrace(trace, "event-log", "event_log schema validation complete.", {
    findings: findings.length
  });

  validateInvariants(output, config, findings);
  addTrace(trace, "invariants", "Invariant checks complete.", {
    findings: findings.length
  });

  const summary = summarize(findings);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    summary,
    findings,
    trace
  };
}

export const validate_usci_output = validateUsciOutput;

export function demoRunUsci(input, configInput = {}) {
  const batch = normalizeBatchInput(input);
  const results = batch.map((item) => ({
    id: item.id,
    result: validateUsciOutput(item.payload, configInput)
  }));

  const aggregate = {
    totalCases: results.length,
    passCases: results.filter((item) => item.result.summary.decision === "PASS").length,
    failCases: results.filter((item) => item.result.summary.decision === "FAIL").length
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    aggregate,
    results
  };
}

export const demo_run_usci = demoRunUsci;

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Schema + Invariant Validation Report");
  lines.push("");
  lines.push(`- Total cases: ${report.aggregate.totalCases}`);
  lines.push(`- Pass: ${report.aggregate.passCases}`);
  lines.push(`- Fail: ${report.aggregate.failCases}`);
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push("");

  for (const item of report.results) {
    lines.push(`## ${item.id}`);
    lines.push(`- Decision: **${item.result.summary.decision}**`);
    lines.push(`- Blocking findings: ${item.result.summary.blockingFindings}`);
    lines.push(`- Warning findings: ${item.result.summary.warningFindings}`);
    lines.push("");
    if (item.result.findings.length === 0) {
      lines.push("- Findings: None");
    } else {
      for (const finding of item.result.findings) {
        lines.push(`- [${finding.severity.toUpperCase()}] ${finding.code} (${finding.path}): ${finding.message}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function parseArgs(argv) {
  const args = {
    input: null,
    config: null,
    output: null,
    format: "json"
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
  const report = demoRunUsci(input, config);

  const jsonOutput = JSON.stringify(report, null, 2);
  const markdownOutput = renderMarkdown(report);

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

  process.exit(report.aggregate.failCases === 0 ? 0 : 1);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli();
}

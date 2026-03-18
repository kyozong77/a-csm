import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG = {
  repeatWindowTurns: 8,
  escalateRepeatCount: 3,
  maxRangeSpan: 50,
  enforceMonotonicTurns: true,
  requirePayloadObject: false,
  allowCrossLedgerDuplicateKey: true
};

const LEDGER_TYPES = ["fact", "commitment", "context"];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function parseNonNegativeInteger(findings, value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    addFinding(
      findings,
      `config-${field}-invalid`,
      "error",
      `Config '${field}' must be a non-negative integer.`,
      true
    );
    return null;
  }
  return parsed;
}

function normalizeConfig(rawConfig = {}, findings) {
  const config = {
    ...clone(DEFAULT_CONFIG),
    ...clone(rawConfig ?? {})
  };

  const repeatWindowTurns = parseNonNegativeInteger(
    findings,
    config.repeatWindowTurns,
    "repeatWindowTurns"
  );
  const escalateRepeatCount = parseNonNegativeInteger(
    findings,
    config.escalateRepeatCount,
    "escalateRepeatCount"
  );
  const maxRangeSpan = parseNonNegativeInteger(findings, config.maxRangeSpan, "maxRangeSpan");

  if (repeatWindowTurns !== null) {
    config.repeatWindowTurns = repeatWindowTurns;
  }
  if (escalateRepeatCount !== null) {
    config.escalateRepeatCount = escalateRepeatCount;
  }
  if (maxRangeSpan !== null) {
    config.maxRangeSpan = maxRangeSpan;
  }

  if (config.escalateRepeatCount < 1) {
    addFinding(
      findings,
      "config-escalateRepeatCount-range",
      "error",
      "Config 'escalateRepeatCount' must be at least 1.",
      true
    );
  }

  if (typeof config.enforceMonotonicTurns !== "boolean") {
    addFinding(
      findings,
      "config-enforceMonotonicTurns-invalid",
      "error",
      "Config 'enforceMonotonicTurns' must be a boolean.",
      true
    );
  }

  if (typeof config.requirePayloadObject !== "boolean") {
    addFinding(
      findings,
      "config-requirePayloadObject-invalid",
      "error",
      "Config 'requirePayloadObject' must be a boolean.",
      true
    );
  }

  if (typeof config.allowCrossLedgerDuplicateKey !== "boolean") {
    addFinding(
      findings,
      "config-allowCrossLedgerDuplicateKey-invalid",
      "error",
      "Config 'allowCrossLedgerDuplicateKey' must be a boolean.",
      true
    );
  }

  return config;
}

function normalizeEvents(rawEvents, config, findings) {
  if (!Array.isArray(rawEvents)) {
    addFinding(findings, "input-events-invalid", "error", "Input 'events' must be an array.", true);
    return [];
  }

  const normalized = [];
  for (let index = 0; index < rawEvents.length; index += 1) {
    const event = rawEvents[index];
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      addFinding(
        findings,
        "input-event-invalid",
        "error",
        `Event at index ${index} must be an object.`,
        true
      );
      continue;
    }

    const ledgerType = typeof event.ledgerType === "string" ? event.ledgerType.trim() : "";
    if (!LEDGER_TYPES.includes(ledgerType)) {
      addFinding(
        findings,
        "input-event-ledgerType-invalid",
        "error",
        `Event at index ${index} has unknown ledgerType '${event.ledgerType ?? ""}'.`,
        true
      );
      continue;
    }

    const entryKey = typeof event.entryKey === "string" ? event.entryKey.trim() : "";
    if (!entryKey) {
      addFinding(
        findings,
        "input-event-entryKey-missing",
        "error",
        `Event at index ${index} requires non-empty 'entryKey'.`,
        true
      );
      continue;
    }

    const turnIndex = Number(event.turn_index);
    if (!Number.isInteger(turnIndex) || turnIndex < 0) {
      addFinding(
        findings,
        "input-event-turn_index-invalid",
        "error",
        `Event at index ${index} requires non-negative integer 'turn_index'.`,
        true
      );
      continue;
    }

    const range = event.turn_range;
    if (!Array.isArray(range) || range.length !== 2) {
      addFinding(
        findings,
        "input-event-turn_range-invalid",
        "error",
        `Event at index ${index} requires 'turn_range' as [start, end].`,
        true
      );
      continue;
    }

    const rangeStart = Number(range[0]);
    const rangeEnd = Number(range[1]);
    if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 0 || rangeEnd < 0) {
      addFinding(
        findings,
        "input-event-turn_range-integer-invalid",
        "error",
        `Event at index ${index} has invalid 'turn_range' integers.`,
        true
      );
      continue;
    }

    if (rangeStart > rangeEnd) {
      addFinding(
        findings,
        "input-event-turn_range-order-invalid",
        "error",
        `Event at index ${index} has turn_range start greater than end.`,
        true
      );
      continue;
    }

    if (turnIndex < rangeStart || turnIndex > rangeEnd) {
      addFinding(
        findings,
        "input-event-turn_index-out-of-range",
        "error",
        `Event at index ${index} has turn_index outside turn_range.`,
        true
      );
      continue;
    }

    const rangeSpan = rangeEnd - rangeStart;
    if (rangeSpan > config.maxRangeSpan) {
      addFinding(
        findings,
        "input-event-turn_range-span-exceeded",
        "error",
        `Event at index ${index} exceeds maxRangeSpan (${config.maxRangeSpan}).`,
        true
      );
      continue;
    }

    if (
      config.requirePayloadObject &&
      (event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload))
    ) {
      addFinding(
        findings,
        "input-event-payload-invalid",
        "error",
        `Event at index ${index} requires object payload under current config.`,
        true
      );
      continue;
    }

    normalized.push({
      sourceIndex: index,
      eventId:
        typeof event.eventId === "string" && event.eventId.trim() !== ""
          ? event.eventId.trim()
          : `EV-${String(index + 1).padStart(4, "0")}`,
      ledgerType,
      entryKey,
      turn_index: turnIndex,
      turn_range: [rangeStart, rangeEnd],
      resolved: event.resolved === true,
      payload: event.payload ?? null,
      note: typeof event.note === "string" ? event.note : null
    });
  }

  normalized.sort((a, b) => {
    if (a.turn_index !== b.turn_index) {
      return a.turn_index - b.turn_index;
    }
    return a.sourceIndex - b.sourceIndex;
  });

  return normalized;
}

function ensureMonotonicTurns(events, config, findings) {
  if (!config.enforceMonotonicTurns || events.length === 0) {
    return;
  }

  let previous = events[0].turn_index;
  for (let index = 1; index < events.length; index += 1) {
    const current = events[index].turn_index;
    if (current < previous) {
      addFinding(
        findings,
        "input-turn_index-monotonicity-violated",
        "error",
        "turn_index must be non-decreasing after normalization.",
        true
      );
      return;
    }
    previous = current;
  }
}

function initializeLedgerState() {
  return {
    fact: [],
    commitment: [],
    context: []
  };
}

function signatureOf(event) {
  return `${event.ledgerType}:${event.entryKey}`;
}

export function evaluateLedgerRepeat(input = {}, rawConfig = {}) {
  const findings = [];
  const trace = [];
  const config = normalizeConfig(rawConfig, findings);
  const normalizedEvents = normalizeEvents(input.events, config, findings);
  ensureMonotonicTurns(normalizedEvents, config, findings);

  addTrace(trace, "input", "Collected and normalized events.", {
    eventCount: normalizedEvents.length
  });

  const ledger = initializeLedgerState();
  const keyState = new Map();
  const keyLedgerMap = new Map();
  const decisions = [];

  for (const event of normalizedEvents) {
    const signature = signatureOf(event);
    const currentState = keyState.get(signature) ?? {
      repeatCount: 0,
      lastTurnIndex: null,
      status: "NEW"
    };

    if (!config.allowCrossLedgerDuplicateKey) {
      const existingLedger = keyLedgerMap.get(event.entryKey);
      if (existingLedger && existingLedger !== event.ledgerType) {
        addFinding(
          findings,
          "input-entryKey-cross-ledger-duplicate",
          "error",
          `entryKey '${event.entryKey}' appears in multiple ledgers while disallowed.`,
          true
        );
        continue;
      }
      if (!existingLedger) {
        keyLedgerMap.set(event.entryKey, event.ledgerType);
      }
    }

    let repeatCount = currentState.repeatCount;
    let status = "NEW";

    if (event.resolved) {
      repeatCount = 0;
      status = "RESOLVED";
    } else if (currentState.lastTurnIndex === null) {
      repeatCount = 1;
      status = "NEW";
    } else {
      const distance = event.turn_index - currentState.lastTurnIndex;
      if (distance <= config.repeatWindowTurns) {
        repeatCount += 1;
      } else {
        repeatCount = 1;
      }

      if (repeatCount >= config.escalateRepeatCount) {
        status = "ESCALATED";
      } else if (repeatCount >= 2) {
        status = "REPEATED";
      } else {
        status = "NEW";
      }
    }

    const row = {
      eventId: event.eventId,
      entryKey: event.entryKey,
      turn_index: event.turn_index,
      turn_range: event.turn_range,
      repeatCount,
      status,
      resolved: event.resolved,
      note: event.note
    };

    ledger[event.ledgerType].push(row);
    decisions.push({
      signature,
      ledgerType: event.ledgerType,
      entryKey: event.entryKey,
      status,
      repeatCount,
      turn_index: event.turn_index
    });

    keyState.set(signature, {
      repeatCount,
      lastTurnIndex: event.turn_index,
      status
    });
  }

  const allRows = [...ledger.fact, ...ledger.commitment, ...ledger.context];
  const repeatedRows = allRows.filter((item) => item.status === "REPEATED").length;
  const escalatedRows = allRows.filter((item) => item.status === "ESCALATED").length;
  const resolvedRows = allRows.filter((item) => item.status === "RESOLVED").length;

  if (findings.some((item) => item.blocking)) {
    addTrace(trace, "safe-fallback", "Blocking findings exist; result marked as blocked.");
  }

  addTrace(trace, "ledger", "Built ledger and repeat decisions.", {
    factEntries: ledger.fact.length,
    commitmentEntries: ledger.commitment.length,
    contextEntries: ledger.context.length,
    repeatedRows,
    escalatedRows,
    resolvedRows
  });

  return {
    generatedAt: new Date().toISOString(),
    config,
    findings,
    summary: {
      totalEvents: normalizedEvents.length,
      factEntries: ledger.fact.length,
      commitmentEntries: ledger.commitment.length,
      contextEntries: ledger.context.length,
      uniqueSignatures: keyState.size,
      repeatedRows,
      escalatedRows,
      resolvedRows,
      blockingFindings: findings.filter((item) => item.blocking).length
    },
    ledger,
    decisions,
    trace
  };
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# Ledger Repeat Engine Result");
  lines.push("");
  lines.push(`- Generated at: ${result.generatedAt}`);
  lines.push(`- Total events: ${result.summary.totalEvents}`);
  lines.push(`- Unique signatures: ${result.summary.uniqueSignatures}`);
  lines.push(`- Repeated rows: ${result.summary.repeatedRows}`);
  lines.push(`- Escalated rows: ${result.summary.escalatedRows}`);
  lines.push(`- Resolved rows: ${result.summary.resolvedRows}`);
  lines.push(`- Blocking findings: ${result.summary.blockingFindings}`);
  lines.push("");
  lines.push("## Ledger Counts");
  lines.push("");
  lines.push(`- fact: ${result.summary.factEntries}`);
  lines.push(`- commitment: ${result.summary.commitmentEntries}`);
  lines.push(`- context: ${result.summary.contextEntries}`);
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
  lines.push("");
  lines.push("## Trace");
  lines.push("");
  if (result.trace.length === 0) {
    lines.push("- None");
  } else {
    for (const step of result.trace) {
      lines.push(`- ${step.step}: ${step.message}`);
    }
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
  const result = evaluateLedgerRepeat(input, config);

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

  process.exit(result.summary.blockingFindings === 0 ? 0 : 1);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli();
}

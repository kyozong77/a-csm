import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG = {
  weights: {
    TAG_FCT: 1.0,
    TAG_SAF: 1.4,
    TAG_CTX: 1.1,
    TAG_SYS: 0.9
  },
  severityScores: {
    low: 1,
    medium: 2,
    high: 4,
    critical: 6
  },
  thresholds: {
    medium: 4,
    deviate: 6,
    high: 8
  },
  conservativeRules: {
    multiAxisMediumToHigh: 2,
    freezeNoDowngrade: true,
    downgradeAfterStableRounds: 2
  }
};

const LEVEL_RANK = {
  LOW: 1,
  MEDIUM: 2,
  DEVIATE: 3,
  HIGH: 4
};

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

function parseNonNegativeNumber(findings, value, fieldPath) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    addFinding(
      findings,
      `config-${fieldPath}-invalid`,
      "error",
      `Config '${fieldPath}' must be a non-negative number.`,
      true
    );
    return null;
  }
  return parsed;
}

function parseNonNegativeInteger(findings, value, fieldPath) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    addFinding(
      findings,
      `config-${fieldPath}-invalid`,
      "error",
      `Config '${fieldPath}' must be a non-negative integer.`,
      true
    );
    return null;
  }
  return parsed;
}

function normalizeConfig(rawConfig, findings) {
  const config = {
    ...clone(DEFAULT_CONFIG),
    ...clone(rawConfig ?? {})
  };

  config.weights = {
    ...DEFAULT_CONFIG.weights,
    ...(rawConfig?.weights ?? {})
  };
  config.severityScores = {
    ...DEFAULT_CONFIG.severityScores,
    ...(rawConfig?.severityScores ?? {})
  };
  config.thresholds = {
    ...DEFAULT_CONFIG.thresholds,
    ...(rawConfig?.thresholds ?? {})
  };
  config.conservativeRules = {
    ...DEFAULT_CONFIG.conservativeRules,
    ...(rawConfig?.conservativeRules ?? {})
  };

  const knownAxes = Object.keys(DEFAULT_CONFIG.weights);
  for (const axis of knownAxes) {
    const weight = parseNonNegativeNumber(findings, config.weights[axis], `weights.${axis}`);
    if (weight !== null) {
      config.weights[axis] = weight;
    }
  }

  const knownSeverities = Object.keys(DEFAULT_CONFIG.severityScores);
  for (const severity of knownSeverities) {
    const score = parseNonNegativeNumber(
      findings,
      config.severityScores[severity],
      `severityScores.${severity}`
    );
    if (score !== null) {
      config.severityScores[severity] = score;
    }
  }

  const mediumThreshold = parseNonNegativeNumber(
    findings,
    config.thresholds.medium,
    "thresholds.medium"
  );
  const deviateThreshold = parseNonNegativeNumber(
    findings,
    config.thresholds.deviate,
    "thresholds.deviate"
  );
  const highThreshold = parseNonNegativeNumber(findings, config.thresholds.high, "thresholds.high");
  if (mediumThreshold !== null) {
    config.thresholds.medium = mediumThreshold;
  }
  if (deviateThreshold !== null) {
    config.thresholds.deviate = deviateThreshold;
  }
  if (highThreshold !== null) {
    config.thresholds.high = highThreshold;
  }

  if (mediumThreshold !== null && deviateThreshold !== null && mediumThreshold > deviateThreshold) {
    addFinding(
      findings,
      "config-thresholds-range-invalid",
      "error",
      "Config 'thresholds.medium' cannot exceed 'thresholds.deviate'.",
      true
    );
  }
  if (deviateThreshold !== null && highThreshold !== null && deviateThreshold > highThreshold) {
    addFinding(
      findings,
      "config-thresholds-range-invalid",
      "error",
      "Config 'thresholds.deviate' cannot exceed 'thresholds.high'.",
      true
    );
  }

  const multiAxisMediumToHigh = parseNonNegativeInteger(
    findings,
    config.conservativeRules.multiAxisMediumToHigh,
    "conservativeRules.multiAxisMediumToHigh"
  );
  if (multiAxisMediumToHigh !== null) {
    config.conservativeRules.multiAxisMediumToHigh = multiAxisMediumToHigh;
  }

  const downgradeAfterStableRounds = parseNonNegativeInteger(
    findings,
    config.conservativeRules.downgradeAfterStableRounds,
    "conservativeRules.downgradeAfterStableRounds"
  );
  if (downgradeAfterStableRounds !== null) {
    config.conservativeRules.downgradeAfterStableRounds = downgradeAfterStableRounds;
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

    const axis = typeof event.axis === "string" ? event.axis.trim() : "";
    if (!Object.prototype.hasOwnProperty.call(config.weights, axis)) {
      addFinding(
        findings,
        "input-event-axis-invalid",
        "error",
        `Event at index ${index} has unknown axis '${event.axis ?? ""}'.`,
        true
      );
      continue;
    }

    const severity = typeof event.severity === "string" ? event.severity.trim().toLowerCase() : "";
    if (!Object.prototype.hasOwnProperty.call(config.severityScores, severity)) {
      addFinding(
        findings,
        "input-event-severity-invalid",
        "error",
        `Event at index ${index} has unknown severity '${event.severity ?? ""}'.`,
        true
      );
      continue;
    }

    const count = event.count === undefined ? 1 : Number(event.count);
    if (!Number.isInteger(count) || count <= 0) {
      addFinding(
        findings,
        "input-event-count-invalid",
        "error",
        `Event at index ${index} must have positive integer 'count'.`,
        true
      );
      continue;
    }

    normalized.push({
      axis,
      severity,
      count,
      reason: typeof event.reason === "string" ? event.reason : null
    });
  }

  return normalized;
}

function levelFromScore(score, thresholds) {
  if (score >= thresholds.high) {
    return "HIGH";
  }
  if (score >= thresholds.deviate) {
    return "DEVIATE";
  }
  if (score >= thresholds.medium) {
    return "MEDIUM";
  }
  return "LOW";
}

function normalizePreviousState(previousStateInput) {
  const previousState =
    previousStateInput && typeof previousStateInput === "object" && !Array.isArray(previousStateInput)
      ? previousStateInput
      : {};
  const level = typeof previousState.level === "string" ? previousState.level.trim().toUpperCase() : null;
  const stableRounds = Number.isInteger(previousState.stableRounds) ? previousState.stableRounds : 0;

  return {
    level: Object.prototype.hasOwnProperty.call(LEVEL_RANK, level) ? level : null,
    stableRounds: stableRounds < 0 ? 0 : stableRounds
  };
}

export function evaluateTagEscalation(input = {}, rawConfig = {}) {
  const findings = [];
  const trace = [];
  const config = normalizeConfig(rawConfig, findings);
  const events = normalizeEvents(input.events, config, findings);
  const previousState = normalizePreviousState(input.previousState);

  addTrace(trace, "input", "Collected input events and previous state.", {
    eventCount: events.length,
    previousState
  });

  const contributions = events.map((event, index) => {
    const weight = config.weights[event.axis];
    const severityScore = config.severityScores[event.severity];
    const weightedScore = Number((weight * severityScore * event.count).toFixed(6));
    return {
      index,
      axis: event.axis,
      severity: event.severity,
      count: event.count,
      weight,
      severityScore,
      weightedScore,
      reason: event.reason
    };
  });

  const totalScore = Number(
    contributions.reduce((sum, item) => sum + item.weightedScore, 0).toFixed(6)
  );
  let baseLevel = levelFromScore(totalScore, config.thresholds);
  let finalLevel = baseLevel;
  let nextStableRounds = 0;

  addTrace(trace, "scoring", "Calculated weighted score and base level.", {
    totalScore,
    baseLevel
  });

  const criticalEvents = contributions.filter((item) => item.severity === "critical");
  if (criticalEvents.length > 0 && LEVEL_RANK[finalLevel] < LEVEL_RANK.HIGH) {
    finalLevel = "HIGH";
    addTrace(trace, "conservative-critical", "Critical severity event escalates level to HIGH.", {
      criticalEvents: criticalEvents.length
    });
  }

  const mediumOrAboveAxes = new Set(
    contributions.filter((item) => config.severityScores[item.severity] >= config.severityScores.medium).map((item) => item.axis)
  );
  if (
    mediumOrAboveAxes.size >= config.conservativeRules.multiAxisMediumToHigh &&
    LEVEL_RANK[finalLevel] < LEVEL_RANK.HIGH
  ) {
    finalLevel = "HIGH";
    addTrace(
      trace,
      "conservative-multi-axis",
      "Multiple medium-or-above axes escalated level to HIGH.",
      {
        mediumOrAboveAxes: Array.from(mediumOrAboveAxes)
      }
    );
  }

  if (previousState.level && config.conservativeRules.freezeNoDowngrade) {
    const previousRank = LEVEL_RANK[previousState.level];
    const currentRank = LEVEL_RANK[finalLevel];
    if (previousRank > currentRank) {
      if (previousState.stableRounds < config.conservativeRules.downgradeAfterStableRounds) {
        finalLevel = previousState.level;
        nextStableRounds = previousState.stableRounds + 1;
        addTrace(
          trace,
          "conservative-no-downgrade",
          "Prevented downgrade due to conservative freeze rule.",
          {
            previousLevel: previousState.level,
            candidateLevel: baseLevel,
            stableRounds: previousState.stableRounds,
            requiredStableRounds: config.conservativeRules.downgradeAfterStableRounds
          }
        );
      } else {
        addTrace(trace, "conservative-downgrade-allowed", "Downgrade allowed after stable rounds.", {
          previousLevel: previousState.level,
          nextLevel: finalLevel,
          stableRounds: previousState.stableRounds
        });
      }
    }
  }

  if (findings.some((item) => item.blocking)) {
    finalLevel = "HIGH";
    addTrace(trace, "fallback-safe-level", "Blocking validation findings triggered safe HIGH level.");
  }

  const blockingFindings = findings.filter((item) => item.blocking).length;
  const result = {
    decisionLevel: finalLevel,
    generatedAt: new Date().toISOString(),
    config,
    findings,
    contributions,
    summary: {
      eventCount: events.length,
      distinctAxes: new Set(contributions.map((item) => item.axis)).size,
      criticalEvents: criticalEvents.length,
      mediumOrAboveAxes: mediumOrAboveAxes.size,
      totalScore,
      baseLevel,
      finalLevel,
      nextStableRounds,
      blockingFindings
    },
    trace
  };

  return result;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# Tag Escalation Result");
  lines.push("");
  lines.push(`- Decision level: **${result.decisionLevel}**`);
  lines.push(`- Generated at: ${result.generatedAt}`);
  lines.push(`- Base level: ${result.summary.baseLevel}`);
  lines.push(`- Final level: ${result.summary.finalLevel}`);
  lines.push(`- Total score: ${result.summary.totalScore}`);
  lines.push(`- Blocking findings: ${result.summary.blockingFindings}`);
  lines.push("");
  lines.push("## Trace");
  lines.push("");
  for (const item of result.trace) {
    lines.push(`- ${item.step}: ${item.message}`);
  }
  if (result.trace.length === 0) {
    lines.push("- None");
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
  const result = evaluateTagEscalation(input, config);

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

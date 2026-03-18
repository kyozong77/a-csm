import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG = {
  axes: ["FR", "CA", "SR", "SA"],
  stateThresholds: {
    nrmMax: 1,
    devMax: 3,
    almMin: 4
  },
  tieBreakOrder: ["SR", "CA", "FR", "SA"],
  collapseFlag: {
    alarmScoreMin: 4,
    highAxisCountMin: 2,
    highAxisScoreFloor: 3
  },
  evidence: {
    maxItems: 3,
    fallbackText: "No material evidence provided."
  }
};

const SUBTYPE_BY_AXIS = {
  FR: "SUB_FR",
  CA: "SUB_CA",
  SR: "SUB_SR",
  SA: "SUB_SA"
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAxis(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
}

function normalizeAxisList(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const normalized = [];

  for (const item of list) {
    const axis = normalizeAxis(item);
    if (!axis || seen.has(axis)) {
      continue;
    }
    seen.add(axis);
    normalized.push(axis);
  }

  return normalized;
}

function parseOrdinalScore(findings, value, fieldPath) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 4) {
    addFinding(
      findings,
      `invalid-${fieldPath}`,
      "error",
      `Field '${fieldPath}' must be an integer between 0 and 4.`,
      true
    );
    return null;
  }
  return parsed;
}

function parsePositiveInteger(findings, value, fieldPath) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    addFinding(
      findings,
      `invalid-${fieldPath}`,
      "error",
      `Field '${fieldPath}' must be a positive integer.`,
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
      `invalid-${fieldPath}`,
      "error",
      `Field '${fieldPath}' must be a non-negative integer.`,
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

  config.stateThresholds = {
    ...DEFAULT_CONFIG.stateThresholds,
    ...(rawConfig?.stateThresholds ?? {})
  };

  config.collapseFlag = {
    ...DEFAULT_CONFIG.collapseFlag,
    ...(rawConfig?.collapseFlag ?? {})
  };

  config.evidence = {
    ...DEFAULT_CONFIG.evidence,
    ...(rawConfig?.evidence ?? {})
  };

  const axes = normalizeAxisList(rawConfig?.axes ?? DEFAULT_CONFIG.axes);
  if (axes.length === 0) {
    addFinding(findings, "config-axes-empty", "error", "Config 'axes' cannot be empty.", true);
    config.axes = clone(DEFAULT_CONFIG.axes);
  } else {
    config.axes = axes;
  }

  const tieBreakOrder = normalizeAxisList(rawConfig?.tieBreakOrder ?? DEFAULT_CONFIG.tieBreakOrder);
  if (tieBreakOrder.length === 0) {
    config.tieBreakOrder = clone(config.axes);
  } else {
    config.tieBreakOrder = tieBreakOrder;
  }

  for (const axis of config.tieBreakOrder) {
    if (!config.axes.includes(axis)) {
      addFinding(
        findings,
        "config-tie-break-axis-unknown",
        "error",
        `Tie-break axis '${axis}' is not present in config.axes.`,
        true
      );
    }
  }

  const nrmMax = parseOrdinalScore(findings, config.stateThresholds.nrmMax, "stateThresholds.nrmMax");
  const devMax = parseOrdinalScore(findings, config.stateThresholds.devMax, "stateThresholds.devMax");
  const almMin = parseOrdinalScore(findings, config.stateThresholds.almMin, "stateThresholds.almMin");
  if (nrmMax !== null) {
    config.stateThresholds.nrmMax = nrmMax;
  }
  if (devMax !== null) {
    config.stateThresholds.devMax = devMax;
  }
  if (almMin !== null) {
    config.stateThresholds.almMin = almMin;
  }

  if (
    nrmMax !== null &&
    devMax !== null &&
    almMin !== null &&
    !(nrmMax < devMax && devMax === almMin - 1)
  ) {
    addFinding(
      findings,
      "config-state-thresholds-invalid",
      "error",
      "stateThresholds must satisfy nrmMax < devMax and devMax = almMin - 1.",
      true
    );
  }

  const alarmScoreMin = parseOrdinalScore(
    findings,
    config.collapseFlag.alarmScoreMin,
    "collapseFlag.alarmScoreMin"
  );
  if (alarmScoreMin !== null) {
    config.collapseFlag.alarmScoreMin = alarmScoreMin;
  }

  const highAxisCountMin = parseNonNegativeInteger(
    findings,
    config.collapseFlag.highAxisCountMin,
    "collapseFlag.highAxisCountMin"
  );
  if (highAxisCountMin !== null) {
    config.collapseFlag.highAxisCountMin = highAxisCountMin;
  }

  const highAxisScoreFloor = parseOrdinalScore(
    findings,
    config.collapseFlag.highAxisScoreFloor,
    "collapseFlag.highAxisScoreFloor"
  );
  if (highAxisScoreFloor !== null) {
    config.collapseFlag.highAxisScoreFloor = highAxisScoreFloor;
  }

  const maxItems = parsePositiveInteger(findings, config.evidence.maxItems, "evidence.maxItems");
  if (maxItems !== null) {
    config.evidence.maxItems = maxItems;
  }

  if (typeof config.evidence.fallbackText !== "string" || !config.evidence.fallbackText.trim()) {
    addFinding(
      findings,
      "invalid-evidence.fallbackText",
      "error",
      "Field 'evidence.fallbackText' must be a non-empty string.",
      true
    );
    config.evidence.fallbackText = DEFAULT_CONFIG.evidence.fallbackText;
  }

  return config;
}

function normalizeAxisScores(rawAxisScores, config, findings) {
  if (!isPlainObject(rawAxisScores)) {
    addFinding(
      findings,
      "input-axis-scores-invalid",
      "error",
      "Input 'axisScores' must be an object.",
      true
    );
    return Object.fromEntries(config.axes.map((axis) => [axis, 0]));
  }

  const parsedByAxis = new Map();
  for (const [rawAxis, rawValue] of Object.entries(rawAxisScores)) {
    const axis = normalizeAxis(rawAxis);
    if (!axis) {
      continue;
    }
    if (!config.axes.includes(axis)) {
      addFinding(
        findings,
        "input-axis-score-unknown",
        "warning",
        `Axis score '${axis}' is not in config.axes and was ignored.`,
        false
      );
      continue;
    }

    const parsedScore = parseOrdinalScore(findings, rawValue, `axisScores.${axis}`);
    if (parsedScore !== null) {
      parsedByAxis.set(axis, parsedScore);
    }
  }

  const normalized = {};
  for (const axis of config.axes) {
    normalized[axis] = parsedByAxis.has(axis) ? parsedByAxis.get(axis) : 0;
  }

  return normalized;
}

function normalizeEvidence(rawEvidence, config, findings) {
  if (rawEvidence === undefined || rawEvidence === null) {
    return [];
  }
  if (!Array.isArray(rawEvidence)) {
    addFinding(
      findings,
      "input-evidence-invalid",
      "error",
      "Input 'evidence' must be an array.",
      true
    );
    return [];
  }

  const normalized = [];
  for (let index = 0; index < rawEvidence.length; index += 1) {
    const item = rawEvidence[index];
    if (!isPlainObject(item)) {
      addFinding(
        findings,
        "input-evidence-item-invalid",
        "error",
        `Evidence item at index ${index} must be an object.`,
        true
      );
      continue;
    }

    const axis = normalizeAxis(item.axis);
    if (!axis || !config.axes.includes(axis)) {
      addFinding(
        findings,
        "input-evidence-axis-unknown",
        "warning",
        `Evidence item at index ${index} has unknown axis '${item.axis ?? ""}'.`,
        false
      );
      continue;
    }

    const summary = typeof item.summary === "string" ? item.summary.trim() : "";
    if (!summary) {
      addFinding(
        findings,
        "input-evidence-summary-empty",
        "warning",
        `Evidence item at index ${index} has empty summary and was ignored.`,
        false
      );
      continue;
    }

    const turnId = typeof item.turnId === "string" ? item.turnId.trim() : "";
    normalized.push({
      axis,
      turnId: turnId || null,
      summary: summary.replace(/\s+/g, " ")
    });
  }

  return normalized;
}

function deriveState(score, thresholds) {
  if (score <= thresholds.nrmMax) {
    return "ST_NRM";
  }
  if (score >= thresholds.almMin) {
    return "ST_ALM";
  }
  return "ST_DEV";
}

function pickSubtypeAxis(axisScores, config, trace) {
  const entries = Object.entries(axisScores);
  const maxScore = entries.reduce((max, [, score]) => Math.max(max, score), 0);
  if (maxScore === 0) {
    addTrace(trace, "subtype", "No positive score detected, using SUB_NONE.");
    return { axis: null, maxScore, tieAxes: [] };
  }

  const tieAxes = entries
    .filter(([, score]) => score === maxScore)
    .map(([axis]) => axis)
    .sort();

  let chosenAxis = tieAxes[0];
  if (tieAxes.length > 1) {
    for (const axis of config.tieBreakOrder) {
      if (tieAxes.includes(axis)) {
        chosenAxis = axis;
        break;
      }
    }
    addTrace(trace, "tie-breaking", "Applied tie-breaking rule for subtype axis.", {
      tieAxes,
      tieBreakOrder: config.tieBreakOrder,
      chosenAxis
    });
  }

  return { axis: chosenAxis, maxScore, tieAxes };
}

function subtypeFromAxis(axis) {
  if (!axis) {
    return "SUB_NONE";
  }
  return SUBTYPE_BY_AXIS[axis] ?? `SUB_${axis}`;
}

function buildEvidenceSummary(subAxis, normalizedEvidence, axisScores, maxItems, fallbackText) {
  if (normalizedEvidence.length === 0) {
    return fallbackText;
  }

  const ranked = normalizedEvidence
    .map((item, index) => ({
      ...item,
      index,
      primary: item.axis === subAxis,
      axisScore: axisScores[item.axis] ?? 0
    }))
    .sort((a, b) => {
      if (a.primary !== b.primary) {
        return a.primary ? -1 : 1;
      }
      if (a.axisScore !== b.axisScore) {
        return b.axisScore - a.axisScore;
      }
      return a.index - b.index;
    });

  const selected = [];
  const seen = new Set();
  for (const item of ranked) {
    const key = `${item.axis}|${item.turnId ?? ""}|${item.summary}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    selected.push(item);
    if (selected.length >= maxItems) {
      break;
    }
  }

  if (selected.length === 0) {
    return fallbackText;
  }

  return selected
    .map((item) => {
      const turnText = item.turnId ? `${item.turnId} ` : "";
      return `${item.axis}:${turnText}${item.summary}`.trim();
    })
    .join(" | ");
}

export function evaluatePsSubFe(input = {}, rawConfig = {}) {
  const findings = [];
  const trace = [];
  const config = normalizeConfig(rawConfig, findings);
  const axisScores = normalizeAxisScores(input.axisScores, config, findings);
  const evidence = normalizeEvidence(input.evidence, config, findings);

  addTrace(trace, "input", "Normalized input and config.", {
    axes: config.axes,
    axisScores,
    evidenceCount: evidence.length
  });

  const subtypeResolution = pickSubtypeAxis(axisScores, config, trace);
  const overallScore = subtypeResolution.maxScore;
  let ps = deriveState(overallScore, config.stateThresholds);
  let sub = subtypeFromAxis(subtypeResolution.axis);

  if (ps === "ST_NRM") {
    sub = "SUB_NONE";
  }

  const highAxisCount = Object.values(axisScores).filter(
    (score) => score >= config.collapseFlag.highAxisScoreFloor
  ).length;
  const collapseReasons = [];
  if (overallScore >= config.collapseFlag.alarmScoreMin) {
    collapseReasons.push("score-threshold");
  }
  if (highAxisCount >= config.collapseFlag.highAxisCountMin && config.collapseFlag.highAxisCountMin > 0) {
    collapseReasons.push("multi-high-axis");
  }

  let fTriggered = collapseReasons.length > 0;
  let e = buildEvidenceSummary(
    subtypeResolution.axis,
    evidence,
    axisScores,
    config.evidence.maxItems,
    config.evidence.fallbackText
  );

  addTrace(trace, "decision", "Derived PS/SUB/F/E from axis scores.", {
    ps,
    sub,
    fTriggered,
    overallScore,
    highAxisCount
  });

  const blockingFindings = findings.filter((item) => item.blocking).length;
  if (blockingFindings > 0) {
    ps = "ST_ALM";
    sub = "SUB_SAFE_MODE";
    fTriggered = true;
    e = `Validation blocked normal derivation (${blockingFindings} findings).`;
    addTrace(trace, "safe-fallback", "Blocking findings forced safe fallback outputs.", {
      blockingFindings
    });
  }

  return {
    ps,
    sub,
    f: {
      triggered: fTriggered,
      level: `F${overallScore}`,
      reasons: collapseReasons
    },
    e,
    generatedAt: new Date().toISOString(),
    axisScores,
    summary: {
      overallScore,
      highAxisCount,
      tieAxes: subtypeResolution.tieAxes,
      blockingFindings
    },
    config,
    findings,
    trace
  };
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# PS/SUB/F/E Derivation Result");
  lines.push("");
  lines.push(`- PS: **${result.ps}**`);
  lines.push(`- SUB: **${result.sub}**`);
  lines.push(`- F Triggered: **${result.f.triggered ? "YES" : "NO"}**`);
  lines.push(`- F Level: ${result.f.level}`);
  lines.push(`- Overall score (0-4): ${result.summary.overallScore}`);
  lines.push(`- Blocking findings: ${result.summary.blockingFindings}`);
  lines.push(`- E: ${result.e}`);
  lines.push("");
  lines.push("## Trace");
  lines.push("");
  if (result.trace.length === 0) {
    lines.push("- None");
  } else {
    for (const item of result.trace) {
      lines.push(`- ${item.step}: ${item.message}`);
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
  const result = evaluatePsSubFe(input, config);

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

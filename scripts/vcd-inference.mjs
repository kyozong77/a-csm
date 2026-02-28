import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SEVERITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function freeze(value) {
  return Object.freeze(value);
}

export const DEFAULT_MATRIX = freeze([
  { id: "VCDE_01", family: "prompt_injection", severity: "high", mode: "any", phrases: ["ignore previous instruction"] },
  { id: "VCDE_02", family: "prompt_injection", severity: "high", mode: "any", phrases: ["reveal hidden prompt"] },
  { id: "VCDE_03", family: "prompt_injection", severity: "critical", mode: "any", phrases: ["bypass safety policy"] },
  { id: "VCDE_04", family: "boundary", severity: "critical", mode: "any", phrases: ["disable guardrail"] },
  { id: "VCDE_05", family: "boundary", severity: "high", mode: "any", phrases: ["ignore system message"] },
  { id: "VCDE_06", family: "boundary", severity: "high", mode: "any", phrases: ["override policy"] },
  { id: "VCDE_07", family: "source_spoof", severity: "high", mode: "all", phrases: ["official source", "trust me"] },
  { id: "VCDE_08", family: "source_spoof", severity: "medium", mode: "any", phrases: ["internal memo leaked"] },
  { id: "VCDE_09", family: "source_spoof", severity: "high", mode: "any", phrases: ["fabricated source link"] },
  { id: "VCDE_10", family: "instruction_drift", severity: "medium", mode: "any", phrases: ["out of scope task"] },
  { id: "VCDE_11", family: "instruction_drift", severity: "medium", mode: "any", phrases: ["switch objective"] },
  { id: "VCDE_12", family: "instruction_drift", severity: "high", mode: "any", phrases: ["conflicting mandate"] },
  { id: "VCDE_13", family: "data_exfil", severity: "critical", mode: "any", phrases: ["export credential"] },
  { id: "VCDE_14", family: "data_exfil", severity: "high", mode: "any", phrases: ["dump secrets"] },
  { id: "VCDE_15", family: "data_exfil", severity: "high", mode: "any", phrases: ["print api key"] },
  { id: "VCDE_16", family: "coercion", severity: "high", mode: "any", phrases: ["you must obey now"] },
  { id: "VCDE_17", family: "coercion", severity: "medium", mode: "any", phrases: ["urgent override"] },
  { id: "VCDE_18", family: "coercion", severity: "high", mode: "any", phrases: ["do not explain"] },
  { id: "VCDE_19", family: "context_pollution", severity: "medium", mode: "any", phrases: ["fake memory"] },
  { id: "VCDE_20", family: "context_pollution", severity: "medium", mode: "any", phrases: ["stale context import"] }
]);

const DEFAULT_CONFIG = {
  enabled: true,
  minSeverity: "low",
  enabledRuleIds: [],
  disabledRuleIds: [],
  dedupeByRulePerTurn: true,
  maxTriggersPerRule: 5,
  excerptMaxLength: 160,
  trustScores: {
    trusted: 0,
    unknown: 1,
    untrusted: 2
  },
  boundaryBypassScore: 3,
  detectBoundaryBypass: true,
  triggerThresholds: {
    guarded: 1,
    triggered: 4,
    lockdown: 8
  },
  responseActions: {
    CLEAR: "ALLOW",
    GUARDED: "WARN_AND_CONSTRAIN",
    TRIGGERED: "SAFE_REPLY_ONLY",
    LOCKDOWN: "ESCALATE_AND_HALT",
    DISABLED: "ALLOW"
  }
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

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function normalizeSeverity(findings, rawValue, fieldPath, fallback) {
  const value = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
  if (Object.prototype.hasOwnProperty.call(SEVERITY_RANK, value)) {
    return value;
  }

  addFinding(
    findings,
    `config-${fieldPath}-invalid`,
    "error",
    `Config '${fieldPath}' must be one of low|medium|high|critical.`,
    true
  );
  return fallback;
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

  config.trustScores = {
    ...DEFAULT_CONFIG.trustScores,
    ...(rawConfig?.trustScores ?? {})
  };

  config.triggerThresholds = {
    ...DEFAULT_CONFIG.triggerThresholds,
    ...(rawConfig?.triggerThresholds ?? {})
  };

  config.responseActions = {
    ...DEFAULT_CONFIG.responseActions,
    ...(rawConfig?.responseActions ?? {})
  };

  if (typeof config.enabled !== "boolean") {
    addFinding(findings, "config-enabled-invalid", "error", "Config 'enabled' must be boolean.", true);
    config.enabled = DEFAULT_CONFIG.enabled;
  }

  config.minSeverity = normalizeSeverity(findings, config.minSeverity, "minSeverity", DEFAULT_CONFIG.minSeverity);
  config.enabledRuleIds = normalizeStringList(config.enabledRuleIds);
  config.disabledRuleIds = normalizeStringList(config.disabledRuleIds);

  if (typeof config.dedupeByRulePerTurn !== "boolean") {
    addFinding(
      findings,
      "config-dedupe-by-rule-per-turn-invalid",
      "error",
      "Config 'dedupeByRulePerTurn' must be boolean.",
      true
    );
    config.dedupeByRulePerTurn = DEFAULT_CONFIG.dedupeByRulePerTurn;
  }

  const maxTriggersPerRule = parseNonNegativeInteger(findings, config.maxTriggersPerRule, "maxTriggersPerRule");
  if (maxTriggersPerRule === null || maxTriggersPerRule <= 0) {
    addFinding(
      findings,
      "config-maxTriggersPerRule-invalid",
      "error",
      "Config 'maxTriggersPerRule' must be a positive integer.",
      true
    );
    config.maxTriggersPerRule = DEFAULT_CONFIG.maxTriggersPerRule;
  } else {
    config.maxTriggersPerRule = maxTriggersPerRule;
  }

  const excerptMaxLength = parseNonNegativeInteger(findings, config.excerptMaxLength, "excerptMaxLength");
  if (excerptMaxLength === null || excerptMaxLength <= 0) {
    addFinding(
      findings,
      "config-excerptMaxLength-invalid",
      "error",
      "Config 'excerptMaxLength' must be a positive integer.",
      true
    );
    config.excerptMaxLength = DEFAULT_CONFIG.excerptMaxLength;
  } else {
    config.excerptMaxLength = excerptMaxLength;
  }

  const trustedScore = parseNonNegativeInteger(findings, config.trustScores.trusted, "trustScores.trusted");
  const unknownScore = parseNonNegativeInteger(findings, config.trustScores.unknown, "trustScores.unknown");
  const untrustedScore = parseNonNegativeInteger(findings, config.trustScores.untrusted, "trustScores.untrusted");
  if (trustedScore !== null) {
    config.trustScores.trusted = trustedScore;
  }
  if (unknownScore !== null) {
    config.trustScores.unknown = unknownScore;
  }
  if (untrustedScore !== null) {
    config.trustScores.untrusted = untrustedScore;
  }

  const boundaryBypassScore = parseNonNegativeInteger(
    findings,
    config.boundaryBypassScore,
    "boundaryBypassScore"
  );
  if (boundaryBypassScore !== null) {
    config.boundaryBypassScore = boundaryBypassScore;
  }

  if (typeof config.detectBoundaryBypass !== "boolean") {
    addFinding(
      findings,
      "config-detectBoundaryBypass-invalid",
      "error",
      "Config 'detectBoundaryBypass' must be boolean.",
      true
    );
    config.detectBoundaryBypass = DEFAULT_CONFIG.detectBoundaryBypass;
  }

  const guarded = parseNonNegativeInteger(findings, config.triggerThresholds.guarded, "triggerThresholds.guarded");
  const triggered = parseNonNegativeInteger(
    findings,
    config.triggerThresholds.triggered,
    "triggerThresholds.triggered"
  );
  const lockdown = parseNonNegativeInteger(
    findings,
    config.triggerThresholds.lockdown,
    "triggerThresholds.lockdown"
  );

  if (guarded !== null) {
    config.triggerThresholds.guarded = guarded;
  }
  if (triggered !== null) {
    config.triggerThresholds.triggered = triggered;
  }
  if (lockdown !== null) {
    config.triggerThresholds.lockdown = lockdown;
  }

  if (guarded !== null && triggered !== null && lockdown !== null) {
    if (!(guarded <= triggered && triggered <= lockdown)) {
      addFinding(
        findings,
        "config-triggerThresholds-range-invalid",
        "error",
        "Config triggerThresholds must satisfy guarded <= triggered <= lockdown.",
        true
      );
    }
  }

  for (const status of ["CLEAR", "GUARDED", "TRIGGERED", "LOCKDOWN", "DISABLED"]) {
    if (typeof config.responseActions[status] !== "string" || config.responseActions[status].trim() === "") {
      addFinding(
        findings,
        `config-responseActions.${status}-invalid`,
        "error",
        `Config 'responseActions.${status}' must be non-empty string.`,
        true
      );
      config.responseActions[status] = DEFAULT_CONFIG.responseActions[status];
    }
  }

  return config;
}

function normalizeTurns(input, findings) {
  if (typeof input?.text === "string") {
    return [
      {
        id: "T1",
        role: null,
        text: input.text,
        sourceTrust: "unknown",
        boundaryBypass: false,
        sourceIndex: 0
      }
    ];
  }

  if (!Array.isArray(input?.turns)) {
    addFinding(
      findings,
      "input-turns-invalid",
      "error",
      "Input must contain either 'text' string or 'turns' array.",
      true
    );
    return [];
  }

  const turns = [];
  for (let index = 0; index < input.turns.length; index += 1) {
    const turn = input.turns[index];
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
      addFinding(findings, "input-turn-invalid", "error", `Turn at index ${index} must be object.`, true);
      continue;
    }

    if (typeof turn.text !== "string") {
      addFinding(
        findings,
        "input-turn-text-invalid",
        "error",
        `Turn at index ${index} must include string 'text'.`,
        true
      );
      continue;
    }

    const sourceTrustRaw = typeof turn.sourceTrust === "string" ? turn.sourceTrust.trim().toLowerCase() : "unknown";
    const sourceTrust = ["trusted", "unknown", "untrusted"].includes(sourceTrustRaw)
      ? sourceTrustRaw
      : "unknown";
    if (sourceTrustRaw !== sourceTrust) {
      addFinding(
        findings,
        "input-sourceTrust-invalid",
        "warn",
        `Turn at index ${index} has invalid sourceTrust '${turn.sourceTrust}'. Fallback to unknown.`,
        false
      );
    }

    turns.push({
      id: typeof turn.id === "string" && turn.id.trim() ? turn.id.trim() : `T${index + 1}`,
      role: typeof turn.role === "string" && turn.role.trim() ? turn.role.trim() : null,
      text: turn.text,
      sourceTrust,
      boundaryBypass: turn.boundaryBypass === true,
      sourceIndex: index
    });
  }

  return turns;
}

function normalizeRule(rule, index, findings) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    addFinding(findings, "rule-invalid", "error", `Rule at index ${index} must be object.`, true);
    return null;
  }

  const id = typeof rule.id === "string" ? rule.id.trim() : "";
  const family = typeof rule.family === "string" ? rule.family.trim() : "";
  const mode = typeof rule.mode === "string" ? rule.mode.trim().toLowerCase() : "";

  if (!id) {
    addFinding(findings, "rule-id-invalid", "error", `Rule at index ${index} missing id.`, true);
    return null;
  }

  if (!family) {
    addFinding(findings, "rule-family-invalid", "error", `Rule '${id}' missing family.`, true);
    return null;
  }

  if (mode !== "any" && mode !== "all") {
    addFinding(findings, "rule-mode-invalid", "error", `Rule '${id}' mode must be any|all.`, true);
    return null;
  }

  const severity = normalizeSeverity(findings, rule.severity, `rules.${id}.severity`, "high");
  const rawPhrases = Array.isArray(rule.phrases) ? rule.phrases : [];
  const phrases = rawPhrases
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  if (phrases.length === 0) {
    addFinding(findings, "rule-phrases-invalid", "error", `Rule '${id}' must include phrases.`, true);
    return null;
  }

  return {
    id,
    family,
    mode,
    severity,
    phrases
  };
}

function buildRules(rawRules, config, findings) {
  const normalizedRules = [];
  const seen = new Set();

  const minSeverityRank = SEVERITY_RANK[config.minSeverity];

  for (let index = 0; index < rawRules.length; index += 1) {
    const rule = normalizeRule(rawRules[index], index, findings);
    if (!rule) {
      continue;
    }

    if (seen.has(rule.id)) {
      addFinding(findings, "rule-id-duplicate", "error", `Rule id '${rule.id}' is duplicated.`, true);
      continue;
    }
    seen.add(rule.id);

    if (SEVERITY_RANK[rule.severity] < minSeverityRank) {
      continue;
    }

    if (config.enabledRuleIds.length > 0 && !config.enabledRuleIds.includes(rule.id)) {
      continue;
    }

    if (config.disabledRuleIds.includes(rule.id)) {
      continue;
    }

    normalizedRules.push(rule);
  }

  return normalizedRules;
}

function extractExcerpt(text, phrase, maxLength) {
  const lower = text.toLowerCase();
  const index = lower.indexOf(phrase);
  if (index === -1) {
    const plain = text.trim();
    if (plain.length <= maxLength) {
      return plain;
    }
    return `${plain.slice(0, Math.max(maxLength - 3, 0))}...`;
  }

  const half = Math.floor(maxLength / 2);
  const start = Math.max(0, index - half);
  const end = Math.min(text.length, start + maxLength);
  const excerpt = text.slice(start, end).trim();
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${excerpt}${suffix}`;
}

function evaluateRuleHit(turnText, rule) {
  const lower = turnText.toLowerCase();
  const matchedPhrases = rule.phrases.filter((phrase) => lower.includes(phrase));
  if (rule.mode === "all") {
    return {
      matched: matchedPhrases.length === rule.phrases.length,
      matchedPhrases
    };
  }
  return {
    matched: matchedPhrases.length > 0,
    matchedPhrases
  };
}

function classifyStatus(score, thresholds) {
  if (score >= thresholds.lockdown) {
    return "LOCKDOWN";
  }
  if (score >= thresholds.triggered) {
    return "TRIGGERED";
  }
  if (score >= thresholds.guarded) {
    return "GUARDED";
  }
  return "CLEAR";
}

export function evaluateVcdInference(input = {}, rawConfig = {}, rawRules = DEFAULT_MATRIX) {
  const findings = [];
  const trace = [];

  const config = normalizeConfig(rawConfig, findings);
  const turns = normalizeTurns(input, findings);
  const rules = buildRules(rawRules, config, findings);

  addTrace(trace, "input", "Normalized VCD input and rules.", {
    turnCount: turns.length,
    ruleCount: rules.length,
    enabled: config.enabled
  });

  if (!config.enabled) {
    addTrace(trace, "disabled", "VCD is disabled by configuration.");
    return {
      generatedAt: new Date().toISOString(),
      config,
      findings,
      summary: {
        status: "DISABLED",
        level: "VCD_OFF",
        action: config.responseActions.DISABLED,
        riskScore: 0,
        triggerCount: 0,
        blockingFindings: findings.filter((item) => item.blocking).length
      },
      events: [],
      trace
    };
  }

  const events = [];
  const perRuleCount = new Map();
  const seenRuleTurn = new Set();
  let nextEventIndex = 1;

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = turns[turnIndex];

    for (const rule of rules) {
      const hit = evaluateRuleHit(turn.text, rule);
      if (!hit.matched) {
        continue;
      }

      const dedupeKey = `${rule.id}::${turn.id}`;
      if (config.dedupeByRulePerTurn && seenRuleTurn.has(dedupeKey)) {
        continue;
      }
      seenRuleTurn.add(dedupeKey);

      const count = perRuleCount.get(rule.id) ?? 0;
      if (count >= config.maxTriggersPerRule) {
        continue;
      }
      perRuleCount.set(rule.id, count + 1);

      const phrase = hit.matchedPhrases[0] ?? rule.phrases[0];
      events.push({
        event_id: `VCD-${String(nextEventIndex).padStart(4, "0")}`,
        source: "matrix",
        rule_id: rule.id,
        family: rule.family,
        severity: rule.severity,
        turn_id: turn.id,
        turn_index: turnIndex + 1,
        sourceTrust: turn.sourceTrust,
        boundaryBypass: turn.boundaryBypass,
        excerpt: extractExcerpt(turn.text, phrase, config.excerptMaxLength),
        matched_phrases: hit.matchedPhrases
      });
      nextEventIndex += 1;
    }

    if (turn.sourceTrust === "unknown" || turn.sourceTrust === "untrusted") {
      events.push({
        event_id: `VCD-${String(nextEventIndex).padStart(4, "0")}`,
        source: "trust",
        rule_id: "VCDE_TRUST",
        family: "source_confidence",
        severity: turn.sourceTrust === "untrusted" ? "high" : "medium",
        turn_id: turn.id,
        turn_index: turnIndex + 1,
        sourceTrust: turn.sourceTrust,
        boundaryBypass: turn.boundaryBypass,
        excerpt: extractExcerpt(turn.text, "", config.excerptMaxLength),
        matched_phrases: []
      });
      nextEventIndex += 1;
    }

    if (config.detectBoundaryBypass && turn.boundaryBypass) {
      events.push({
        event_id: `VCD-${String(nextEventIndex).padStart(4, "0")}`,
        source: "boundary",
        rule_id: "VCDE_BOUNDARY",
        family: "boundary",
        severity: "critical",
        turn_id: turn.id,
        turn_index: turnIndex + 1,
        sourceTrust: turn.sourceTrust,
        boundaryBypass: true,
        excerpt: extractExcerpt(turn.text, "", config.excerptMaxLength),
        matched_phrases: []
      });
      nextEventIndex += 1;
    }
  }

  const riskScore = Number(
    events
      .reduce((sum, event) => {
        if (event.source === "trust") {
          return sum + config.trustScores[event.sourceTrust];
        }
        if (event.source === "boundary") {
          return sum + config.boundaryBypassScore;
        }
        return sum + SEVERITY_RANK[event.severity];
      }, 0)
      .toFixed(6)
  );

  let status = classifyStatus(riskScore, config.triggerThresholds);
  if (findings.some((item) => item.blocking)) {
    status = "TRIGGERED";
    addTrace(trace, "safe-fallback", "Blocking findings detected; forcing TRIGGERED state.");
  }

  const level = `VCD_${status}`;
  const action = config.responseActions[status];

  addTrace(trace, "score", "Calculated VCD status and action.", {
    riskScore,
    status,
    action,
    triggerCount: events.length
  });

  return {
    generatedAt: new Date().toISOString(),
    config,
    findings,
    summary: {
      status,
      level,
      action,
      riskScore,
      triggerCount: events.length,
      matrixHits: events.filter((event) => event.source === "matrix").length,
      trustSignals: events.filter((event) => event.source === "trust").length,
      boundarySignals: events.filter((event) => event.source === "boundary").length,
      blockingFindings: findings.filter((item) => item.blocking).length
    },
    events,
    trace
  };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# VCD Inference Result");
  lines.push("");
  lines.push(`- Status: **${result.summary.status}**`);
  lines.push(`- Level: ${result.summary.level}`);
  lines.push(`- Action: ${result.summary.action}`);
  lines.push(`- Risk score: ${result.summary.riskScore}`);
  lines.push(`- Trigger count: ${result.summary.triggerCount}`);
  lines.push(`- Matrix hits: ${result.summary.matrixHits}`);
  lines.push(`- Trust signals: ${result.summary.trustSignals}`);
  lines.push(`- Boundary signals: ${result.summary.boundarySignals}`);
  lines.push(`- Blocking findings: ${result.summary.blockingFindings}`);
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
  for (const item of result.trace) {
    lines.push(`- ${item.step}: ${item.message}`);
  }
  if (result.trace.length === 0) {
    lines.push("- None");
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
  const result = evaluateVcdInference(input, config);

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

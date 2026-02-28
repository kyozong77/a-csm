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

export const DEFAULT_RULES = freeze([
  { id: "FR_01", axis: "FR", severity: "high", mode: "any", phrases: ["fabricated citation"] },
  { id: "FR_02", axis: "FR", severity: "high", mode: "any", phrases: ["unverifiable source"] },
  { id: "FR_03", axis: "FR", severity: "medium", mode: "any", phrases: ["contradictory fact"] },
  { id: "FR_04", axis: "FR", severity: "high", mode: "any", phrases: ["invented statistic"] },
  { id: "FR_05", axis: "FR", severity: "medium", mode: "any", phrases: ["date mismatch"] },
  { id: "FR_06", axis: "FR", severity: "medium", mode: "any", phrases: ["entity mismatch"] },
  { id: "FR_07", axis: "FR", severity: "medium", mode: "any", phrases: ["unsupported claim"] },
  { id: "FR_08", axis: "FR", severity: "high", mode: "any", phrases: ["impossible value"] },
  { id: "FR_09", axis: "FR", severity: "medium", mode: "any", phrases: ["source missing"] },
  { id: "FR_10", axis: "FR", severity: "high", mode: "any", phrases: ["fake quote"] },
  { id: "FR_11", axis: "FR", severity: "high", mode: "any", phrases: ["broken evidence link"] },

  { id: "CA_01", axis: "CA", severity: "medium", mode: "any", phrases: ["context drift"] },
  { id: "CA_02", axis: "CA", severity: "high", mode: "any", phrases: ["instruction conflict"] },
  { id: "CA_03", axis: "CA", severity: "medium", mode: "any", phrases: ["omitted requirement"] },
  { id: "CA_04", axis: "CA", severity: "medium", mode: "any", phrases: ["role confusion"] },
  { id: "CA_05", axis: "CA", severity: "medium", mode: "any", phrases: ["task scope jump"] },
  { id: "CA_06", axis: "CA", severity: "low", mode: "any", phrases: ["ambiguous reference"] },
  { id: "CA_07", axis: "CA", severity: "medium", mode: "any", phrases: ["stale context reuse"] },
  { id: "CA_08", axis: "CA", severity: "medium", mode: "any", phrases: ["language mismatch"] },
  { id: "CA_09", axis: "CA", severity: "medium", mode: "any", phrases: ["intent misread"] },
  { id: "CA_10", axis: "CA", severity: "high", mode: "any", phrases: ["boundary bypass"] },
  { id: "CA_11", axis: "CA", severity: "high", mode: "any", phrases: ["policy contradiction"] },

  { id: "SR_01", axis: "SR", severity: "critical", mode: "any", phrases: ["self-harm hint"] },
  { id: "SR_02", axis: "SR", severity: "critical", mode: "any", phrases: ["violence instruction"] },
  { id: "SR_03", axis: "SR", severity: "high", mode: "any", phrases: ["harassment pattern"] },
  { id: "SR_04", axis: "SR", severity: "critical", mode: "any", phrases: ["medical emergency"] },
  { id: "SR_05", axis: "SR", severity: "high", mode: "any", phrases: ["legal advice risk"] },
  { id: "SR_06", axis: "SR", severity: "high", mode: "any", phrases: ["financial scam"] },
  { id: "SR_07", axis: "SR", severity: "high", mode: "any", phrases: ["privacy leak"] },
  { id: "SR_08", axis: "SR", severity: "critical", mode: "any", phrases: ["credential request"] },
  { id: "SR_09", axis: "SR", severity: "critical", mode: "any", phrases: ["malware instruction"] },
  { id: "SR_10", axis: "SR", severity: "high", mode: "any", phrases: ["social engineering"] },
  { id: "SR_11", axis: "SR", severity: "high", mode: "any", phrases: ["age-sensitive content"] },

  { id: "SA_01", axis: "SA", severity: "medium", mode: "any", phrases: ["timeout repeated"] },
  { id: "SA_02", axis: "SA", severity: "high", mode: "any", phrases: ["crash loop"] },
  { id: "SA_03", axis: "SA", severity: "high", mode: "any", phrases: ["resource exhaustion"] },
  { id: "SA_04", axis: "SA", severity: "high", mode: "any", phrases: ["dependency failure"] },
  { id: "SA_05", axis: "SA", severity: "medium", mode: "any", phrases: ["rate limit burst"] },
  { id: "SA_06", axis: "SA", severity: "high", mode: "any", phrases: ["storage corruption"] },
  { id: "SA_07", axis: "SA", severity: "high", mode: "any", phrases: ["network outage"] },
  { id: "SA_08", axis: "SA", severity: "medium", mode: "any", phrases: ["permission denied"] },
  { id: "SA_09", axis: "SA", severity: "medium", mode: "any", phrases: ["config missing"] },
  { id: "SA_10", axis: "SA", severity: "high", mode: "any", phrases: ["deployment rollback"] }
]);

const DEFAULT_CONFIG = {
  minSeverity: "low",
  enabledRuleIds: [],
  disabledRuleIds: [],
  dedupeByRulePerTurn: true,
  maxEventsPerRule: 5,
  excerptMaxLength: 140
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
  const items = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function normalizeMinSeverity(findings, rawValue) {
  const value = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
  if (Object.prototype.hasOwnProperty.call(SEVERITY_RANK, value)) {
    return value;
  }
  addFinding(
    findings,
    "config-min-severity-invalid",
    "error",
    "Config 'minSeverity' must be one of low|medium|high|critical.",
    true
  );
  return DEFAULT_CONFIG.minSeverity;
}

function normalizeConfig(rawConfig, findings) {
  const config = {
    ...clone(DEFAULT_CONFIG),
    ...clone(rawConfig ?? {})
  };

  config.minSeverity = normalizeMinSeverity(findings, config.minSeverity);
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

  const maxEventsPerRule = Number(config.maxEventsPerRule);
  if (!Number.isInteger(maxEventsPerRule) || maxEventsPerRule <= 0) {
    addFinding(
      findings,
      "config-max-events-per-rule-invalid",
      "error",
      "Config 'maxEventsPerRule' must be a positive integer.",
      true
    );
    config.maxEventsPerRule = DEFAULT_CONFIG.maxEventsPerRule;
  } else {
    config.maxEventsPerRule = maxEventsPerRule;
  }

  const excerptMaxLength = Number(config.excerptMaxLength);
  if (!Number.isInteger(excerptMaxLength) || excerptMaxLength <= 0) {
    addFinding(
      findings,
      "config-excerpt-max-length-invalid",
      "error",
      "Config 'excerptMaxLength' must be a positive integer.",
      true
    );
    config.excerptMaxLength = DEFAULT_CONFIG.excerptMaxLength;
  } else {
    config.excerptMaxLength = excerptMaxLength;
  }

  return config;
}

function normalizeTurns(input, findings) {
  if (typeof input?.text === "string") {
    return [{ id: "T1", role: null, text: input.text }];
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

    turns.push({
      id: typeof turn.id === "string" && turn.id.trim() ? turn.id.trim() : `T${index + 1}`,
      role: typeof turn.role === "string" && turn.role.trim() ? turn.role.trim() : null,
      text: turn.text
    });
  }

  return turns;
}

function normalizeRules(findings) {
  const ids = new Set();
  const rules = [];
  for (const rule of DEFAULT_RULES) {
    if (!rule || typeof rule !== "object") {
      addFinding(findings, "rule-invalid", "error", "Internal rule definition must be object.", true);
      continue;
    }
    if (typeof rule.id !== "string" || !rule.id.trim()) {
      addFinding(findings, "rule-id-invalid", "error", "Rule id must be non-empty string.", true);
      continue;
    }
    if (ids.has(rule.id)) {
      addFinding(findings, "rule-id-duplicate", "error", `Duplicate rule id '${rule.id}'.`, true);
      continue;
    }
    ids.add(rule.id);

    if (!Object.prototype.hasOwnProperty.call(SEVERITY_RANK, rule.severity)) {
      addFinding(findings, "rule-severity-invalid", "error", `Rule '${rule.id}' has invalid severity.`, true);
      continue;
    }

    const mode = rule.mode === "all" ? "all" : "any";
    const phrases = normalizeStringList(rule.phrases);
    if (phrases.length === 0) {
      addFinding(findings, "rule-phrases-empty", "error", `Rule '${rule.id}' has empty phrases.`, true);
      continue;
    }

    rules.push({
      id: rule.id,
      axis: rule.axis,
      severity: rule.severity,
      mode,
      phrases,
      rank: SEVERITY_RANK[rule.severity]
    });
  }

  return rules;
}

function selectRules(rules, config, findings) {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));

  for (const id of config.enabledRuleIds) {
    if (!ruleById.has(id)) {
      addFinding(findings, "config-enabled-rule-unknown", "error", `Unknown enabled rule id '${id}'.`, true);
    }
  }

  for (const id of config.disabledRuleIds) {
    if (!ruleById.has(id)) {
      addFinding(findings, "config-disabled-rule-unknown", "error", `Unknown disabled rule id '${id}'.`, true);
    }
  }

  const enabledSet = new Set(config.enabledRuleIds);
  const disabledSet = new Set(config.disabledRuleIds);

  const minRank = SEVERITY_RANK[config.minSeverity] ?? 1;

  const selected = [];
  for (const rule of rules) {
    if (enabledSet.size > 0 && !enabledSet.has(rule.id)) {
      continue;
    }
    if (disabledSet.has(rule.id)) {
      continue;
    }
    if (rule.rank < minRank) {
      continue;
    }
    selected.push(rule);
  }

  return selected;
}

function extractExcerpt(text, startIndex, maxLength) {
  const safeStart = Math.max(0, startIndex - 20);
  const piece = text.slice(safeStart, safeStart + maxLength).replace(/\s+/g, " ").trim();
  return piece;
}

function detectRuleInText(textLower, textOriginal, rule) {
  const matched = [];

  for (const phrase of rule.phrases) {
    const phraseLower = phrase.toLowerCase();
    const index = textLower.indexOf(phraseLower);
    if (index >= 0) {
      matched.push({ phrase, index });
    }
  }

  const isHit = rule.mode === "all" ? matched.length === rule.phrases.length : matched.length > 0;
  if (!isHit) {
    return null;
  }

  const firstIndex = matched.length > 0 ? Math.min(...matched.map((item) => item.index)) : 0;
  return {
    matchedPhrases: matched.map((item) => item.phrase),
    excerpt: extractExcerpt(textOriginal, firstIndex, 140),
    firstIndex
  };
}

function incrementCount(container, key) {
  container[key] = (container[key] ?? 0) + 1;
}

export function runEventEngine(input = {}, rawConfig = {}) {
  const findings = [];
  const trace = [];

  const config = normalizeConfig(rawConfig, findings);
  const turns = normalizeTurns(input, findings);
  const rules = normalizeRules(findings);
  const selectedRules = selectRules(rules, config, findings);

  addTrace(trace, "input", "Normalized config, turns and rules.", {
    turnCount: turns.length,
    totalRules: rules.length,
    selectedRules: selectedRules.length,
    minSeverity: config.minSeverity
  });

  const events = [];
  const ruleHitCounts = {};
  const dedupeMap = new Set();
  const axisCounts = {};
  const severityCounts = {};

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = turns[turnIndex];
    const textLower = turn.text.toLowerCase();

    for (const rule of selectedRules) {
      if ((ruleHitCounts[rule.id] ?? 0) >= config.maxEventsPerRule) {
        continue;
      }

      const detection = detectRuleInText(textLower, turn.text, rule);
      if (!detection) {
        continue;
      }

      const dedupeKey = `${rule.id}|${turn.id}`;
      if (config.dedupeByRulePerTurn && dedupeMap.has(dedupeKey)) {
        continue;
      }

      dedupeMap.add(dedupeKey);
      incrementCount(ruleHitCounts, rule.id);
      incrementCount(axisCounts, rule.axis);
      incrementCount(severityCounts, rule.severity);

      events.push({
        eventId: `${rule.id}@${turn.id}#${ruleHitCounts[rule.id]}`,
        ruleId: rule.id,
        axis: rule.axis,
        severity: rule.severity,
        turnId: turn.id,
        turnIndex,
        matchedPhrases: detection.matchedPhrases,
        excerpt: detection.excerpt
      });
    }
  }

  const blockingFindings = findings.filter((item) => item.blocking).length;
  if (blockingFindings > 0) {
    addTrace(trace, "safe-fallback", "Blocking findings detected; event outputs may be incomplete.", {
      blockingFindings
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    config,
    summary: {
      totalRules: rules.length,
      activeRules: selectedRules.length,
      totalEvents: events.length,
      axisCounts,
      severityCounts,
      blockingFindings
    },
    events,
    findings,
    trace
  };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# Event Engine Result");
  lines.push("");
  lines.push(`- Generated at: ${result.generatedAt}`);
  lines.push(`- Active rules: ${result.summary.activeRules}/${result.summary.totalRules}`);
  lines.push(`- Total events: ${result.summary.totalEvents}`);
  lines.push(`- Blocking findings: ${result.summary.blockingFindings}`);
  lines.push("");
  lines.push("## Axis Counts");
  lines.push("");
  const axisEntries = Object.entries(result.summary.axisCounts);
  if (axisEntries.length === 0) {
    lines.push("- None");
  } else {
    for (const [axis, count] of axisEntries) {
      lines.push(`- ${axis}: ${count}`);
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
  const result = runEventEngine(input, config);

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

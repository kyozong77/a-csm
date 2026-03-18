import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_POLICY = {
  detectors: {
    email: true,
    phone: true,
    ipv4: true,
    twNationalId: true,
    creditCard: true,
    sensitiveQueryKeys: true
  },
  replacement: {
    strategy: "indexed-token",
    fixedToken: "[REDACTED]",
    preserveEmailDomain: false,
    phoneMaskLastDigits: 2
  },
  audit: {
    maxPerType: 100
  }
};

const SENSITIVE_QUERY_KEYS = [
  "token",
  "access_token",
  "api_key",
  "apikey",
  "password",
  "passwd",
  "secret",
  "session",
  "sessionid",
  "auth"
];

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

function parseBoolean(findings, value, fieldPath, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === undefined) {
    return fallback;
  }
  addFinding(findings, `policy-${fieldPath}-invalid`, "error", `Policy '${fieldPath}' must be boolean.`, true);
  return fallback;
}

function parseNonNegativeInteger(findings, value, fieldPath, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    addFinding(
      findings,
      `policy-${fieldPath}-invalid`,
      "error",
      `Policy '${fieldPath}' must be a non-negative integer.`,
      true
    );
    return fallback;
  }
  return parsed;
}

function parsePositiveInteger(findings, value, fieldPath, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    addFinding(
      findings,
      `policy-${fieldPath}-invalid`,
      "error",
      `Policy '${fieldPath}' must be a positive integer.`,
      true
    );
    return fallback;
  }
  return parsed;
}

function normalizePolicy(rawPolicy, findings) {
  const policy = {
    ...clone(DEFAULT_POLICY),
    ...clone(rawPolicy ?? {})
  };
  policy.detectors = {
    ...DEFAULT_POLICY.detectors,
    ...(rawPolicy?.detectors ?? {})
  };
  policy.replacement = {
    ...DEFAULT_POLICY.replacement,
    ...(rawPolicy?.replacement ?? {})
  };
  policy.audit = {
    ...DEFAULT_POLICY.audit,
    ...(rawPolicy?.audit ?? {})
  };

  for (const key of Object.keys(DEFAULT_POLICY.detectors)) {
    policy.detectors[key] = parseBoolean(findings, policy.detectors[key], `detectors.${key}`, DEFAULT_POLICY.detectors[key]);
  }

  const strategy = String(policy.replacement.strategy ?? "").trim();
  if (!["indexed-token", "fixed-token"].includes(strategy)) {
    addFinding(
      findings,
      "policy-replacement.strategy-invalid",
      "error",
      "Policy 'replacement.strategy' must be 'indexed-token' or 'fixed-token'.",
      true
    );
    policy.replacement.strategy = DEFAULT_POLICY.replacement.strategy;
  } else {
    policy.replacement.strategy = strategy;
  }

  if (typeof policy.replacement.fixedToken !== "string" || !policy.replacement.fixedToken.trim()) {
    addFinding(
      findings,
      "policy-replacement.fixedToken-invalid",
      "error",
      "Policy 'replacement.fixedToken' must be a non-empty string.",
      true
    );
    policy.replacement.fixedToken = DEFAULT_POLICY.replacement.fixedToken;
  } else {
    policy.replacement.fixedToken = policy.replacement.fixedToken.trim();
  }

  policy.replacement.preserveEmailDomain = parseBoolean(
    findings,
    policy.replacement.preserveEmailDomain,
    "replacement.preserveEmailDomain",
    DEFAULT_POLICY.replacement.preserveEmailDomain
  );

  policy.replacement.phoneMaskLastDigits = parseNonNegativeInteger(
    findings,
    policy.replacement.phoneMaskLastDigits,
    "replacement.phoneMaskLastDigits",
    DEFAULT_POLICY.replacement.phoneMaskLastDigits
  );

  policy.audit.maxPerType = parsePositiveInteger(
    findings,
    policy.audit.maxPerType,
    "audit.maxPerType",
    DEFAULT_POLICY.audit.maxPerType
  );

  return policy;
}

function normalizeInput(rawInput, findings) {
  if (!isPlainObject(rawInput)) {
    addFinding(findings, "input-invalid", "error", "Input must be an object.", true);
    return { mode: "text", text: "", turns: [] };
  }

  if (typeof rawInput.text === "string") {
    return {
      mode: "text",
      text: rawInput.text,
      turns: []
    };
  }

  if (!Array.isArray(rawInput.turns)) {
    addFinding(
      findings,
      "input-text-or-turns-required",
      "error",
      "Input must include either 'text' string or 'turns' array.",
      true
    );
    return { mode: "text", text: "", turns: [] };
  }

  const turns = [];
  for (let index = 0; index < rawInput.turns.length; index += 1) {
    const turn = rawInput.turns[index];
    if (!isPlainObject(turn)) {
      addFinding(findings, "input-turn-invalid", "error", `Turn at index ${index} must be an object.`, true);
      continue;
    }
    if (typeof turn.text !== "string") {
      addFinding(
        findings,
        "input-turn-text-invalid",
        "error",
        `Turn at index ${index} requires string 'text'.`,
        true
      );
      continue;
    }
    const turnId = typeof turn.id === "string" && turn.id.trim() ? turn.id.trim() : `T${index + 1}`;
    const role = typeof turn.role === "string" && turn.role.trim() ? turn.role.trim() : null;
    turns.push({
      id: turnId,
      role,
      text: turn.text
    });
  }

  return {
    mode: "turns",
    text: "",
    turns
  };
}

function shaDigest(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function countDigits(value) {
  return (value.match(/\d/g) ?? []).length;
}

function isLikelyPhone(value) {
  const digits = countDigits(value);
  return digits >= 8 && digits <= 15;
}

function isLuhnValid(value) {
  const digits = (value.match(/\d/g) ?? []).map((item) => Number(item));
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits[i];
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function twLetterCode(letter) {
  const mapping = {
    A: 10,
    B: 11,
    C: 12,
    D: 13,
    E: 14,
    F: 15,
    G: 16,
    H: 17,
    I: 34,
    J: 18,
    K: 19,
    L: 20,
    M: 21,
    N: 22,
    O: 35,
    P: 23,
    Q: 24,
    R: 25,
    S: 26,
    T: 27,
    U: 28,
    V: 29,
    W: 32,
    X: 30,
    Y: 31,
    Z: 33
  };
  return mapping[letter] ?? null;
}

function isValidTwNationalId(value) {
  if (!/^[A-Z][12]\d{8}$/.test(value)) {
    return false;
  }

  const first = twLetterCode(value[0]);
  if (first === null) {
    return false;
  }

  const digits = [Math.floor(first / 10), first % 10, ...value.slice(1).split("").map((item) => Number(item))];
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
  const sum = digits.reduce((acc, digit, index) => acc + digit * weights[index], 0);
  return sum % 10 === 0;
}

function collectMatches(text, policy) {
  const matches = [];

  if (policy.detectors.email) {
    const regex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
    for (const match of text.matchAll(regex)) {
      matches.push({
        type: "email",
        text: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }

  if (policy.detectors.phone) {
    const regex = /(?<![A-Za-z0-9.])(?:\+?\d[\d\s()-]{6,}\d)(?![A-Za-z0-9.])/g;
    for (const match of text.matchAll(regex)) {
      const candidate = match[0].trim();
      if (!isLikelyPhone(candidate)) {
        continue;
      }
      if (/(?:\d{1,3}\.){3}\d{1,3}/.test(candidate)) {
        continue;
      }
      matches.push({
        type: "phone",
        text: candidate,
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }

  if (policy.detectors.ipv4) {
    const regex = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
    for (const match of text.matchAll(regex)) {
      matches.push({
        type: "ipv4",
        text: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }

  if (policy.detectors.twNationalId) {
    const regex = /\b[A-Z][12]\d{8}\b/g;
    for (const match of text.matchAll(regex)) {
      if (!isValidTwNationalId(match[0])) {
        continue;
      }
      matches.push({
        type: "tw_national_id",
        text: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }

  if (policy.detectors.creditCard) {
    const regex = /(?:\b\d[\d -]{11,}\d\b)/g;
    for (const match of text.matchAll(regex)) {
      if (!isLuhnValid(match[0])) {
        continue;
      }
      matches.push({
        type: "credit_card",
        text: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }

  if (policy.detectors.sensitiveQueryKeys) {
    const keyPattern = SENSITIVE_QUERY_KEYS.map((item) => item.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|");
    const regex = new RegExp(`([?&])(${keyPattern})=([^&#\\s]+)`, "gi");
    for (const match of text.matchAll(regex)) {
      const value = match[3];
      const valueStartOffset = match[0].lastIndexOf(value);
      const start = match.index + valueStartOffset;
      matches.push({
        type: "query_secret",
        text: value,
        start,
        end: start + value.length,
        key: match[2]
      });
    }
  }

  matches.sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return b.end - a.end;
  });

  const deduped = [];
  let cursor = -1;
  for (const match of matches) {
    if (match.start < cursor) {
      continue;
    }
    deduped.push(match);
    cursor = match.end;
  }

  return deduped;
}

function buildReplacement(match, policy, counters) {
  const strategy = policy.replacement.strategy;
  const nextCounter = (counters[match.type] ?? 0) + 1;
  counters[match.type] = nextCounter;

  if (strategy === "fixed-token") {
    return policy.replacement.fixedToken;
  }

  const baseToken = `[${match.type.toUpperCase()}_${nextCounter}]`;
  if (match.type === "email" && policy.replacement.preserveEmailDomain) {
    const domain = match.text.split("@")[1] ?? "domain";
    return `${baseToken}@${domain}`;
  }

  if (match.type === "phone" && policy.replacement.phoneMaskLastDigits > 0) {
    const digits = (match.text.match(/\d/g) ?? []).join("");
    const keep = digits.slice(-policy.replacement.phoneMaskLastDigits);
    const suffix = keep ? `_*${keep}` : "";
    return `${baseToken}${suffix}`;
  }

  return baseToken;
}

function applyRedactionToText(text, policy, counters, findings, context = {}) {
  const matches = collectMatches(text, policy);
  const perType = new Map();
  const selectedMatches = [];

  for (const match of matches) {
    const current = perType.get(match.type) ?? 0;
    if (current >= policy.audit.maxPerType) {
      addFinding(
        findings,
        `audit-max-per-type-${match.type}`,
        "warning",
        `Type '${match.type}' exceeded maxPerType=${policy.audit.maxPerType}; extra matches were skipped.`,
        false
      );
      continue;
    }
    perType.set(match.type, current + 1);
    selectedMatches.push(match);
  }

  const matchesWithReplacement = selectedMatches.map((match) => ({
    ...match,
    replacement: buildReplacement(match, policy, counters)
  }));

  let redactedText = text;
  const replacements = [];

  for (let index = matchesWithReplacement.length - 1; index >= 0; index -= 1) {
    const match = matchesWithReplacement[index];
    const replacement = match.replacement;
    redactedText = `${redactedText.slice(0, match.start)}${replacement}${redactedText.slice(match.end)}`;
    replacements.push({
      id: `${context.segmentId ?? "S"}-R${matchesWithReplacement.length - index}`,
      type: match.type,
      start: match.start,
      end: match.end,
      length: match.end - match.start,
      digestBefore: shaDigest(match.text),
      replacement,
      ...(match.key ? { key: match.key } : {}),
      ...(context.turnId ? { turnId: context.turnId } : {}),
      ...(context.turnIndex !== undefined ? { turnIndex: context.turnIndex } : {})
    });
  }

  replacements.reverse();

  return {
    redactedText,
    replacements,
    countsByType: Object.fromEntries(perType.entries())
  };
}

function mergeTypeCounts(target, source) {
  for (const [type, count] of Object.entries(source)) {
    target[type] = (target[type] ?? 0) + count;
  }
}

export function runDeidPipeline(input = {}, rawPolicy = {}) {
  const findings = [];
  const trace = [];
  const policy = normalizePolicy(rawPolicy, findings);
  const normalizedInput = normalizeInput(input, findings);

  const counters = {};
  const replacements = [];
  const countsByType = {};

  let redactedText = null;
  let redactedTurns = null;

  if (normalizedInput.mode === "text") {
    const result = applyRedactionToText(normalizedInput.text, policy, counters, findings, {
      segmentId: "TEXT"
    });
    redactedText = result.redactedText;
    replacements.push(...result.replacements);
    mergeTypeCounts(countsByType, result.countsByType);
  } else {
    redactedTurns = normalizedInput.turns.map((turn, turnIndex) => {
      const result = applyRedactionToText(turn.text, policy, counters, findings, {
        segmentId: `TURN${turnIndex + 1}`,
        turnId: turn.id,
        turnIndex
      });
      replacements.push(...result.replacements);
      mergeTypeCounts(countsByType, result.countsByType);
      return {
        ...turn,
        text: result.redactedText
      };
    });
  }

  addTrace(trace, "pipeline", "Applied detector and replacement policy.", {
    mode: normalizedInput.mode,
    replacements: replacements.length,
    types: Object.keys(countsByType)
  });

  const blockingFindings = findings.filter((item) => item.blocking).length;

  if (blockingFindings > 0) {
    addTrace(trace, "safe-fallback", "Blocking findings detected; outputs flagged as unsafe for downstream.", {
      blockingFindings
    });
  }

  const summary = {
    blockingFindings,
    totalReplacements: replacements.length,
    countsByType,
    piiTypesDetected: Object.keys(countsByType).sort()
  };

  return {
    generatedAt: new Date().toISOString(),
    policy,
    findings,
    trace,
    summary,
    replacements,
    ...(normalizedInput.mode === "text"
      ? {
          mode: "text",
          originalTextLength: normalizedInput.text.length,
          redactedText
        }
      : {
          mode: "turns",
          originalTurnCount: normalizedInput.turns.length,
          redactedTurns
        })
  };
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# De-identification Result");
  lines.push("");
  lines.push(`- Mode: ${result.mode}`);
  lines.push(`- Generated at: ${result.generatedAt}`);
  lines.push(`- Total replacements: ${result.summary.totalReplacements}`);
  lines.push(`- Blocking findings: ${result.summary.blockingFindings}`);
  lines.push(`- PII types: ${result.summary.piiTypesDetected.join(", ") || "none"}`);
  lines.push("");
  lines.push("## Counts By Type");
  lines.push("");
  const typeEntries = Object.entries(result.summary.countsByType);
  if (typeEntries.length === 0) {
    lines.push("- None");
  } else {
    for (const [type, count] of typeEntries) {
      lines.push(`- ${type}: ${count}`);
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
  const policy = args.config ? readJsonFile(args.config) : {};
  const result = runDeidPipeline(input, policy);

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

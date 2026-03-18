import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_CONFIG = {
  version: "1.0.1",
  analysis_mode: "full",
  output_mode: "internal_full",
  vcd_enabled: true,
  tag_escalation_enabled: true,
  repeat_detection_window: 5,
  collapse_threshold: {
    ST_CC: true,
    ST_SC: true
  },
  report_elements: 10,
  sha256_hashing: true
};

const SPEAKER_MAP = {
  user: "user",
  human: "user",
  assistant: "assistant",
  ai: "assistant",
  system: "system"
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
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

function parseYamlScalar(rawValue) {
  const value = rawValue.trim();
  if (!value.length) {
    return "";
  }

  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

function parseSimpleYaml(content, findings = null, context = "yaml") {
  const root = {};
  const stack = [{ indent: -1, object: root }];
  const lines = String(content).replace(/\r\n/g, "\n").split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }

    const match = line.match(/^(\s*)([^:#][^:]*):(.*)$/);
    if (!match) {
      if (findings) {
        addFinding(
          findings,
          `${context}-parse-line-${lineIndex + 1}`,
          "warning",
          `Skipped unsupported line ${lineIndex + 1}: '${line.trim()}'.`,
          false
        );
      }
      continue;
    }

    const indent = match[1].replace(/\t/g, "  ").length;
    const key = match[2].trim();
    const valueRaw = match[3];

    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].object;

    if (!valueRaw.trim()) {
      parent[key] = {};
      stack.push({ indent, object: parent[key] });
      continue;
    }

    parent[key] = parseYamlScalar(valueRaw);
  }

  return root;
}

function splitFrontMatter(markdown) {
  const normalized = String(markdown).replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines[0]?.trim() !== "---") {
    return {
      frontMatter: {},
      body: normalized
    };
  }

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      end = index;
      break;
    }
  }

  if (end === -1) {
    return {
      frontMatter: {},
      body: normalized
    };
  }

  return {
    frontMatter: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n")
  };
}

function normalizeRole(rawRole) {
  if (typeof rawRole !== "string") {
    return null;
  }
  const normalized = rawRole.trim().toLowerCase();
  return SPEAKER_MAP[normalized] ?? null;
}

export function parseMarkdownTranscript(content) {
  const { frontMatter, body } = splitFrontMatter(content);
  const frontMatterObject = typeof frontMatter === "string" ? parseSimpleYaml(frontMatter) : {};

  const turns = [];
  let currentRole = null;
  let currentLines = [];

  const flushCurrentTurn = () => {
    if (!currentRole) {
      return;
    }
    const text = currentLines.join("\n").trim();
    turns.push({
      id: `T${String(turns.length + 1).padStart(3, "0")}`,
      role: currentRole,
      text,
      // Markdown transcripts are explicit user-provided inputs, not
      // untrusted provenance signals. Defaulting to trusted avoids a
      // false-positive VCD uplift for clean transcripts.
      sourceTrust: "trusted",
      boundaryBypass: false
    });
  };

  const lines = String(body).replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const speakerMatch = line.match(/^\s*(User|Assistant|Human|AI|System)\s*:\s*(.*)$/i);
    if (speakerMatch) {
      flushCurrentTurn();
      currentRole = normalizeRole(speakerMatch[1]) ?? "user";
      currentLines = speakerMatch[2] ? [speakerMatch[2]] : [];
      continue;
    }

    if (currentRole) {
      currentLines.push(line);
    }
  }

  flushCurrentTurn();

  const metadataFromFrontMatter = isPlainObject(frontMatterObject.metadata) ? frontMatterObject.metadata : {};
  const metadata = {
    format: "markdown_transcript",
    turn_count: turns.length,
    ...metadataFromFrontMatter
  };

  if (typeof frontMatterObject.session_id === "string" && !metadata.session_id) {
    metadata.session_id = frontMatterObject.session_id;
  }
  if (typeof frontMatterObject.platform === "string" && !metadata.platform) {
    metadata.platform = frontMatterObject.platform;
  }
  if (typeof frontMatterObject.language === "string" && !metadata.language) {
    metadata.language = frontMatterObject.language;
  }

  return {
    metadata,
    turns,
    config: isPlainObject(frontMatterObject.config) ? frontMatterObject.config : {}
  };
}

export function validateInputContract(transcript) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(transcript)) {
    errors.push("TranscriptInput must be an object.");
    return { is_valid: false, errors, warnings };
  }

  if (!Array.isArray(transcript.turns) || transcript.turns.length === 0) {
    errors.push("Transcript has no turns.");
    return { is_valid: false, errors, warnings };
  }

  if (transcript.turns.length < 2) {
    warnings.push("Very short transcript (< 2 turns).");
  }

  const seenIds = new Set();
  for (let index = 0; index < transcript.turns.length; index += 1) {
    const turn = transcript.turns[index];

    if (!isPlainObject(turn)) {
      errors.push(`Turn at index ${index} must be an object.`);
      continue;
    }

    if (typeof turn.id !== "string" || !/^T\d{3}$/.test(turn.id)) {
      errors.push(`Turn at index ${index} has invalid id format. Expected T001 style.`);
    } else if (seenIds.has(turn.id)) {
      errors.push(`Duplicate turn id detected: ${turn.id}.`);
    } else {
      seenIds.add(turn.id);
    }

    if (!["user", "assistant", "system"].includes(turn.role)) {
      errors.push(`Turn ${turn.id ?? `#${index + 1}`} has invalid role '${String(turn.role)}'.`);
    }

    if (typeof turn.text !== "string" || !turn.text.trim()) {
      errors.push(`Turn ${turn.id ?? `#${index + 1}`} has empty content.`);
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
    warnings
  };
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function deepMerge(base, override) {
  const output = clone(base);
  for (const [key, value] of Object.entries(override ?? {})) {
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function loadConfigFile(configPath, findings) {
  const raw = fs.readFileSync(configPath, "utf8");
  const ext = path.extname(configPath).toLowerCase();

  if (ext === ".json") {
    return JSON.parse(raw);
  }

  return parseSimpleYaml(raw, findings, "config");
}

export function runInputContract(markdownContent, rawConfigOverride = {}) {
  const findings = [];
  const trace = [];

  const parsedTranscript = parseMarkdownTranscript(markdownContent);
  addTrace(trace, "parse", "Parsed markdown transcript into normalized turns.", {
    turns: parsedTranscript.turns.length
  });

  const allowedInputContractKeys = new Set(Object.keys(DEFAULT_CONFIG));
  const filteredForInputContract = {};
  const passthroughConfig = {};
  if (isPlainObject(parsedTranscript.config)) {
    for (const [key, value] of Object.entries(parsedTranscript.config)) {
      if (DANGEROUS_KEYS.has(key)) {
        continue;
      }
      if (allowedInputContractKeys.has(key)) {
        filteredForInputContract[key] = value;
      } else {
        passthroughConfig[key] = value;
      }
    }
  }

  let config = deepMerge(DEFAULT_CONFIG, filteredForInputContract);
  if (isPlainObject(rawConfigOverride)) {
    config = deepMerge(config, rawConfigOverride);
  } else {
    addFinding(
      findings,
      "config-override-invalid",
      "error",
      "Config override must be an object.",
      true
    );
  }

  const validation = validateInputContract(parsedTranscript);
  for (const error of validation.errors) {
    addFinding(findings, "input-validation-error", "error", error, true);
  }
  for (const warning of validation.warnings) {
    addFinding(findings, "input-validation-warning", "warning", warning, false);
  }

  addTrace(trace, "validation", "Validated input contract.", {
    isValid: validation.is_valid,
    errors: validation.errors.length,
    warnings: validation.warnings.length
  });

  const summary = {
    turnCount: parsedTranscript.turns.length,
    blockingFindings: findings.filter((item) => item.blocking).length,
    warningFindings: findings.filter((item) => !item.blocking).length
  };

  return {
    generatedAt: new Date().toISOString(),
    input_format: "md_transcript",
    metadata: parsedTranscript.metadata,
    turns: parsedTranscript.turns,
    config: { ...config, ...passthroughConfig },
    validation,
    findings,
    trace,
    summary
  };
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

function renderMarkdown(result) {
  const lines = [];
  lines.push("# Input Contract Result");
  lines.push("");
  lines.push(`- Generated at: ${result.generatedAt}`);
  lines.push(`- Input format: ${result.input_format}`);
  lines.push(`- Turn count: ${result.summary.turnCount}`);
  lines.push(`- Blocking findings: ${result.summary.blockingFindings}`);
  lines.push(`- Warning findings: ${result.summary.warningFindings}`);
  lines.push("");
  lines.push("## Validation");
  lines.push("");
  lines.push(`- is_valid: ${result.validation.is_valid}`);

  if (result.validation.errors.length) {
    lines.push("- errors:");
    for (const error of result.validation.errors) {
      lines.push(`  - ${error}`);
    }
  }

  if (result.validation.warnings.length) {
    lines.push("- warnings:");
    for (const warning of result.validation.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  if (!result.validation.errors.length && !result.validation.warnings.length) {
    lines.push("- No validation issues.");
  }

  return lines.join("\n");
}

function runCli() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error("Missing required --input <path> argument.");
    process.exit(2);
  }

  const markdownContent = fs.readFileSync(args.input, "utf8");
  let configOverride = {};

  const preflightFindings = [];
  if (args.config) {
    try {
      configOverride = loadConfigFile(args.config, preflightFindings);
    } catch (error) {
      console.error(`Failed to read config file: ${error.message}`);
      process.exit(2);
    }
  }

  const result = runInputContract(markdownContent, configOverride);
  if (preflightFindings.length) {
    result.findings.push(...preflightFindings);
    result.summary.warningFindings += preflightFindings.length;
  }

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

  process.exit(result.validation.is_valid ? 0 : 1);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli();
}

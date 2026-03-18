import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".venv",
  "venv",
  "test",
  "dist",
  "build",
  "logs",
  "output"
]);

const RULES = [
  {
    id: "gitlab-pat",
    pattern: /\bglpat-[A-Za-z0-9\-_.]{20,}\b/g
  },
  {
    id: "openai-key",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g
  },
  {
    id: "private-key-header",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
  },
  {
    id: "generic-api-key-assignment",
    pattern: /\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/gi
  }
];

function isBinary(content) {
  return content.includes("\u0000");
}

function listFiles(rootDir, accumulator = []) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      if (DEFAULT_EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      listFiles(fullPath, accumulator);
      continue;
    }

    if (entry.isFile()) {
      accumulator.push(fullPath);
    }
  }

  return accumulator;
}

function lineAndColumn(source, index) {
  const prefix = source.slice(0, index);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1
  };
}

export function scanTextForSecrets(text) {
  const findings = [];

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        ruleId: rule.id,
        match: match[0],
        index: match.index
      });
    }
  }

  findings.sort((a, b) => a.index - b.index);
  return findings;
}

export function scanWorkspace(rootDir = process.cwd()) {
  const findings = [];

  for (const filePath of listFiles(rootDir)) {
    const raw = fs.readFileSync(filePath, "utf8");
    if (isBinary(raw)) {
      continue;
    }

    const hits = scanTextForSecrets(raw);
    for (const hit of hits) {
      const lc = lineAndColumn(raw, hit.index);
      findings.push({
        file: filePath,
        ruleId: hit.ruleId,
        line: lc.line,
        column: lc.column,
        excerpt: hit.match.slice(0, 120)
      });
    }
  }

  return findings;
}

function runCli() {
  const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const findings = scanWorkspace(rootDir);

  if (!findings.length) {
    console.log("No secret findings.");
    process.exit(0);
  }

  console.log(`# Secret findings: ${findings.length}`);
  for (const item of findings) {
    console.log(`${item.ruleId} | ${item.file}:${item.line}:${item.column} | ${item.excerpt}`);
  }
  process.exit(1);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli();
}

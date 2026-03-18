import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_DIRS = ["logs", "output"];

function toAbsoluteDirs(baseCwd, rawDirs) {
  return (rawDirs?.length ? rawDirs : DEFAULT_DIRS)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (path.isAbsolute(item) ? item : path.resolve(baseCwd, item)));
}

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return {
      ok: true,
      value: JSON.parse(raw)
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}

function inferReportType(filePath, data) {
  if (Array.isArray(data?.cases)) {
    return "batch";
  }
  if (data?.steps?.releaseGate && data?.steps?.schema) {
    return "orchestrator";
  }
  if (data?.summary?.decision && data?.findings && data?.trace) {
    return "stage";
  }

  const baseName = path.basename(filePath, ".json");
  const suffix = "-result";
  if (baseName.endsWith(suffix)) {
    return baseName.slice(0, -suffix.length);
  }
  return baseName;
}

function inferDecision(data) {
  return (
    data?.decision ??
    data?.summary?.decision ??
    data?.releaseGateDecision ??
    data?.summary?.releaseGateDecision ??
    "N/A"
  );
}

function inferPrimaryState(data) {
  return (
    data?.steps?.ps?.ps ??
    data?.ps ??
    data?.primary_state ??
    "N/A"
  );
}

function inferSubtype(data) {
  return (
    data?.steps?.ps?.sub ??
    data?.sub ??
    data?.subtype ??
    "N/A"
  );
}

function inferGeneratedAt(filePath, data) {
  const fromPayload = data?.generatedAt ?? data?.timestamp ?? data?.summary?.generatedAt;
  if (typeof fromPayload === "string" && fromPayload.trim()) {
    return fromPayload;
  }

  const stat = fs.statSync(filePath);
  return stat.mtime.toISOString();
}

function collectJsonFiles(directories) {
  const files = [];
  for (const dir of directories) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      continue;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

export function listReports(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const dirs = toAbsoluteDirs(cwd, options.directories);
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 50;

  const rows = [];
  const warnings = [];

  for (const filePath of collectJsonFiles(dirs)) {
    const parsed = safeReadJson(filePath);
    if (!parsed.ok) {
      warnings.push(`Skipped invalid JSON: ${filePath} (${parsed.error})`);
      continue;
    }

    const data = parsed.value;
    rows.push({
      id: path.basename(filePath, ".json"),
      file: filePath,
      type: inferReportType(filePath, data),
      decision: inferDecision(data),
      ps: inferPrimaryState(data),
      sub: inferSubtype(data),
      generatedAt: inferGeneratedAt(filePath, data)
    });
  }

  rows.sort((a, b) => {
    if (a.generatedAt === b.generatedAt) {
      return a.id.localeCompare(b.id);
    }
    return a.generatedAt < b.generatedAt ? 1 : -1;
  });

  return {
    rows: rows.slice(0, limit),
    total: rows.length,
    limit,
    directories: dirs,
    warnings
  };
}

function resolveReportPath(idOrPath, directories) {
  if (!idOrPath) {
    return null;
  }

  if (path.isAbsolute(idOrPath) || idOrPath.includes(path.sep)) {
    return fs.existsSync(idOrPath) ? idOrPath : null;
  }

  for (const dir of directories) {
    const candidate = path.join(dir, `${idOrPath}.json`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function showReport(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const dirs = toAbsoluteDirs(cwd, options.directories);
  const filePath = resolveReportPath(options.idOrPath, dirs);

  if (!filePath) {
    return {
      ok: false,
      message: `Report not found: ${options.idOrPath}`
    };
  }

  const parsed = safeReadJson(filePath);
  if (!parsed.ok) {
    return {
      ok: false,
      message: `Failed to read JSON: ${filePath} (${parsed.error})`
    };
  }

  return {
    ok: true,
    file: filePath,
    data: parsed.value
  };
}

function formatList(result) {
  const lines = [];
  lines.push(`# Dashboard Reports (${result.rows.length}/${result.total})`);
  lines.push(`Directories: ${result.directories.join(", ")}`);
  lines.push("");

  if (result.rows.length === 0) {
    lines.push("No report JSON files found.");
  } else {
    lines.push("id | type | decision | ps/sub | generatedAt");
    lines.push("--- | --- | --- | --- | ---");
    for (const row of result.rows) {
      lines.push(`${row.id} | ${row.type} | ${row.decision} | ${row.ps}/${row.sub} | ${row.generatedAt}`);
    }
  }

  if (result.warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
}

function parseArgs(argv) {
  const args = {
    command: null,
    id: null,
    dirs: null,
    limit: 50
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!args.command && !key.startsWith("--")) {
      args.command = key;
      continue;
    }

    if (key === "--id") {
      args.id = value;
      index += 1;
      continue;
    }

    if (key === "--dir") {
      args.dirs = String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (key === "--limit") {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) {
        args.limit = parsed;
      }
      index += 1;
      continue;
    }
  }

  return args;
}

function runCli() {
  const args = parseArgs(process.argv);

  if (!args.command || !["list", "show"].includes(args.command)) {
    console.error("Usage: node scripts/dashboard-cli.mjs <list|show> [--id report-id] [--dir logs,output] [--limit 50]");
    process.exit(2);
  }

  if (args.command === "list") {
    const result = listReports({
      cwd: process.cwd(),
      directories: args.dirs,
      limit: args.limit
    });
    console.log(formatList(result));
    process.exit(0);
  }

  const result = showReport({
    cwd: process.cwd(),
    directories: args.dirs,
    idOrPath: args.id
  });

  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  console.log(JSON.stringify(result.data, null, 2));
  process.exit(0);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli();
}

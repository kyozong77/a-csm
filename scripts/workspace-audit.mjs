import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

const DEFAULT_PATH_CONFIG = "config/workspace-paths.json";

function run(command) {
  try {
    return execSync(command, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    }).trim();
  } catch (error) {
    return null;
  }
}

function parseArgs(argv) {
  const args = {
    output: null,
    pathsConfig: DEFAULT_PATH_CONFIG
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--output") {
      args.output = value;
      i += 1;
    } else if (key === "--paths-config") {
      args.pathsConfig = value;
      i += 1;
    }
  }

  return args;
}

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function checkPath(targetPath) {
  const resolved = path.resolve(targetPath);
  const exists = fs.existsSync(resolved);
  if (!exists) {
    return {
      path: resolved,
      exists: false,
      type: "missing"
    };
  }

  const stat = fs.statSync(resolved);
  return {
    path: resolved,
    exists: true,
    type: stat.isDirectory() ? "directory" : "file",
    sizeBytes: stat.size
  };
}

function toList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function normalizePathGroups(pathConfig) {
  const requiredPaths = toList(pathConfig.requiredPaths);
  const referencePaths = toList(pathConfig.referencePaths);

  if (requiredPaths.length > 0 || referencePaths.length > 0) {
    return { requiredPaths, referencePaths };
  }

  // Backward compatibility with older config schema.
  return {
    requiredPaths: toList(pathConfig.expectedDirectories),
    referencePaths: []
  };
}

function buildGroupedChecks(paths, level) {
  return paths.map((targetPath) => {
    const pathCheck = checkPath(targetPath);
    return {
      ...pathCheck,
      level
    };
  });
}

function buildAudit(pathsConfigPath) {
  const pathConfig = safeReadJson(pathsConfigPath) ?? {};
  const { requiredPaths, referencePaths } = normalizePathGroups(pathConfig);

  const gitRoot = run("git rev-parse --show-toplevel");
  const branch = run("git rev-parse --abbrev-ref HEAD");
  const trackedCountRaw = run("git ls-files | wc -l");
  const trackedCount = trackedCountRaw ? Number(trackedCountRaw) : null;
  const untrackedRaw = run("git status --porcelain=v1 -uall");
  const untracked = (untrackedRaw ?? "")
    .split("\n")
    .filter(Boolean)
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3));

  const requiredChecks = buildGroupedChecks(requiredPaths, "required");
  const referenceChecks = buildGroupedChecks(referencePaths, "reference");
  const checks = [...requiredChecks, ...referenceChecks];

  const missingRequiredPaths = requiredChecks.filter((item) => !item.exists).map((item) => item.path);
  const missingReferencePaths = referenceChecks
    .filter((item) => !item.exists)
    .map((item) => item.path);

  return {
    generatedAt: new Date().toISOString(),
    cwd: process.cwd(),
    cwdRealPath: fs.realpathSync(process.cwd()),
    git: {
      root: gitRoot,
      branch,
      trackedFileCount: Number.isFinite(trackedCount) ? trackedCount : null,
      untrackedFiles: untracked
    },
    pathsConfigPath: path.resolve(pathsConfigPath),
    groups: {
      requiredPaths,
      referencePaths
    },
    checks,
    summary: {
      totalChecks: checks.length,
      requiredMissingCount: missingRequiredPaths.length,
      requiredMissingPaths: missingRequiredPaths,
      referenceMissingCount: missingReferencePaths.length,
      referenceMissingPaths: missingReferencePaths,
      readiness: missingRequiredPaths.length === 0 ? "READY" : "NOT_READY"
    },
    note:
      typeof pathConfig.note === "string" && pathConfig.note.trim()
        ? pathConfig.note
        : null
  };
}

function writeOutput(outputPath, content) {
  const directory = path.dirname(outputPath);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  const audit = buildAudit(args.pathsConfig);
  const json = JSON.stringify(audit, null, 2);

  if (args.output) {
    writeOutput(args.output, json);
  }

  console.log(json);
}

main();

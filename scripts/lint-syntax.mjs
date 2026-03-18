import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const DIRECTORY_TARGETS = ["scripts", "test"];
const FILE_TARGETS = [];
const VALID_EXTENSIONS = new Set([".js", ".mjs"]);

function collectDirectoryFiles(targetDirectory) {
  const absoluteDirectory = path.join(ROOT, targetDirectory);
  if (!fs.existsSync(absoluteDirectory)) {
    return [];
  }

  const collected = [];
  const stack = [absoluteDirectory];

  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (VALID_EXTENSIONS.has(path.extname(entry.name))) {
        collected.push(absolutePath);
      }
    }
  }

  return collected;
}

function collectTargets() {
  const files = [
    ...FILE_TARGETS
      .map((targetFile) => path.join(ROOT, targetFile))
      .filter((targetFile) => fs.existsSync(targetFile)),
    ...DIRECTORY_TARGETS.flatMap((targetDirectory) => collectDirectoryFiles(targetDirectory))
  ];

  return [...new Set(files)].sort();
}

function checkFile(targetFile) {
  execFileSync(process.execPath, ["--check", targetFile], {
    cwd: ROOT,
    stdio: "pipe",
    encoding: "utf8"
  });
}

function main() {
  const targets = collectTargets();
  const failures = [];

  for (const targetFile of targets) {
    try {
      checkFile(targetFile);
      process.stdout.write(`OK ${path.relative(ROOT, targetFile)}\n`);
    } catch (error) {
      failures.push({
        file: path.relative(ROOT, targetFile),
        output: [error.stdout, error.stderr].filter(Boolean).join("").trim()
      });
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`FAIL ${failure.file}\n`);
      if (failure.output) {
        process.stderr.write(`${failure.output}\n`);
      }
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Checked ${targets.length} files.\n`);
}

main();

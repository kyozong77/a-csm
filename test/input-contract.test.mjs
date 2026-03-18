import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CONFIG,
  parseMarkdownTranscript,
  runInputContract,
  validateInputContract
} from "../scripts/input-contract.mjs";

const BASIC_TRANSCRIPT = `User: Hello\nAssistant: Hi, how can I help?\nUser: Summarize this project.`;
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("01 parses markdown transcript into stable turn ids", () => {
  const parsed = parseMarkdownTranscript(BASIC_TRANSCRIPT);
  assert.equal(parsed.turns.length, 3);
  assert.deepEqual(
    parsed.turns.map((turn) => turn.id),
    ["T001", "T002", "T003"]
  );
  assert.deepEqual(
    parsed.turns.map((turn) => turn.role),
    ["user", "assistant", "user"]
  );
});

test("02 keeps multiline content under same speaker", () => {
  const parsed = parseMarkdownTranscript(`User: line1\nline2\nAssistant: ok`);
  assert.equal(parsed.turns.length, 2);
  assert.equal(parsed.turns[0].text, "line1\nline2");
});

test("02a markdown transcript turns default to trusted source", () => {
  const parsed = parseMarkdownTranscript(BASIC_TRANSCRIPT);
  assert.deepEqual(
    parsed.turns.map((turn) => turn.sourceTrust),
    ["trusted", "trusted", "trusted"]
  );
});

test("03 parses front matter metadata and config override", () => {
  const parsed = parseMarkdownTranscript(`---\nsession_id: demo-01\nmetadata:\n  platform: codex\n  language: zh-TW\nconfig:\n  analysis_mode: quick\n  repeat_detection_window: 7\n---\nUser: hello\nAssistant: hi`);

  assert.equal(parsed.metadata.session_id, "demo-01");
  assert.equal(parsed.metadata.platform, "codex");
  assert.equal(parsed.metadata.language, "zh-TW");
  assert.equal(parsed.config.analysis_mode, "quick");
  assert.equal(parsed.config.repeat_detection_window, 7);
});

test("04 validateInputContract reports empty transcript", () => {
  const validation = validateInputContract({ metadata: {}, turns: [] });
  assert.equal(validation.is_valid, false);
  assert.match(validation.errors[0], /no turns/i);
});

test("05 runInputContract merges defaults, front matter, and external override", () => {
  const result = runInputContract(
    `---\nconfig:\n  analysis_mode: quick\n---\nUser: hello\nAssistant: world`,
    {
      output_mode: "public_safe",
      collapse_threshold: {
        ST_CC: false
      }
    }
  );

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.config.analysis_mode, "quick");
  assert.equal(result.config.output_mode, "public_safe");
  assert.equal(result.config.collapse_threshold.ST_CC, false);
  assert.equal(result.config.collapse_threshold.ST_SC, DEFAULT_CONFIG.collapse_threshold.ST_SC);
});

test("06 cli reads yaml config and writes output json", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "input-contract-"));
  const inputPath = path.join(tmpDir, "input.md");
  const configPath = path.join(tmpDir, "override.yaml");
  const outputPath = path.join(tmpDir, "result.json");

  fs.writeFileSync(inputPath, "User: hello\nAssistant: hi", "utf8");
  fs.writeFileSync(
    configPath,
    "analysis_mode: quick\nrepeat_detection_window: 9\ncollapse_threshold:\n  ST_CC: false\n",
    "utf8"
  );

  const cli = spawnSync(
    process.execPath,
    ["scripts/input-contract.mjs", "--input", inputPath, "--config", configPath, "--output", outputPath],
    {
      cwd: ROOT_DIR,
      encoding: "utf8"
    }
  );

  assert.equal(cli.status, 0);
  const result = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(result.validation.is_valid, true);
  assert.equal(result.config.analysis_mode, "quick");
  assert.equal(result.config.repeat_detection_window, 9);
  assert.equal(result.config.collapse_threshold.ST_CC, false);
});

test("07 cli returns exit code 1 when transcript is invalid", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "input-contract-"));
  const inputPath = path.join(tmpDir, "input.md");

  fs.writeFileSync(inputPath, "", "utf8");

  const cli = spawnSync(process.execPath, ["scripts/input-contract.mjs", "--input", inputPath], {
    cwd: ROOT_DIR,
    encoding: "utf8"
  });

  assert.equal(cli.status, 1);
  assert.match(cli.stdout, /no turns/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildAnnotationTemplate,
  calculateBatchIrr,
  calculateConversationIrr,
  cohensKappa,
  summarizeBatchProgress
} from "../scripts/annotation-workflow.mjs";

const MARKDOWN_INPUT = `---
session_id: demo-session
---
User: Hello
Assistant: Hi there
User: Please summarize`;
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("01 returns kappa 1 for perfect agreement", () => {
  const kappa = cohensKappa([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]);
  assert.equal(kappa, 1);
});

test("02 conversation IRR uses turn-level severity", () => {
  const report = calculateConversationIrr({
    conversation_id: "conv-01",
    turns: [{ turn_id: "T001" }, { turn_id: "T002" }],
    rater_a: [{ turn_id: "T001", event_code: "FR_01", severity: 2 }],
    rater_b: [{ turn_id: "T001", event_code: "FR_01", severity: 2 }]
  });

  assert.equal(report.units, 2);
  assert.equal(report.labels_a[1], 0);
  assert.equal(report.labels_b[1], 0);
  assert.equal(report.agreement_rate, 1);
});

test("03 buildAnnotationTemplate keeps stable turn ids and defaults", () => {
  const template = buildAnnotationTemplate(
    {
      metadata: { session_id: "demo-session" },
      turns: [
        { id: "T001", role: "user", text: "Hello" },
        { id: "T002", role: "assistant", text: "Hi" }
      ]
    },
    {
      batch_id: "pilot-001",
      target_count: 100
    }
  );

  assert.equal(template.batch_id, "pilot-001");
  assert.equal(template.target_count, 100);
  assert.equal(template.conversations[0].conversation_id, "demo-session");
  assert.equal(template.conversations[0].turns[0].turn_id, "T001");
});

test("04 calculateBatchIrr reports batch-level metrics", () => {
  const report = calculateBatchIrr({
    batch_id: "pilot-001",
    target_count: 100,
    completed_count: 0,
    conversations: [
      {
        conversation_id: "conv-01",
        turns: [{ turn_id: "T001" }, { turn_id: "T002" }],
        rater_a: [
          { turn_id: "T001", event_code: "FR_01", severity: 1 },
          { turn_id: "T002", event_code: "CA_03", severity: 3 }
        ],
        rater_b: [
          { turn_id: "T001", event_code: "FR_01", severity: 1 },
          { turn_id: "T002", event_code: "CA_03", severity: 2 }
        ]
      }
    ]
  });

  assert.equal(report.scored_conversations, 1);
  assert.equal(typeof report.batch_kappa, "number");
  assert.equal(typeof report.agreement_rate, "number");
  assert.equal(report.completed_count, 1);
});

test("05 summarizeBatchProgress computes completion and pending", () => {
  const summary = summarizeBatchProgress({
    batch_id: "pilot-001",
    target_count: 5,
    completed_count: 1,
    conversations: [
      { conversation_id: "conv-01", rater_a: [{ turn_id: "T001" }], rater_b: [{ turn_id: "T001" }] },
      { conversation_id: "conv-02", rater_a: [{ turn_id: "T001" }], rater_b: [] }
    ]
  });

  assert.equal(summary.completed_count, 1);
  assert.equal(summary.pending_count, 4);
  assert.equal(summary.completion_rate, 0.2);
});

test("06 CLI template creates JSON template", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "annotation-workflow-"));
  const inputPath = path.join(tmpDir, "input.md");
  const outputPath = path.join(tmpDir, "annotation-template.json");
  fs.writeFileSync(inputPath, MARKDOWN_INPUT, "utf8");

  const cli = spawnSync(
    process.execPath,
    ["scripts/annotation-workflow.mjs", "template", "--input", inputPath, "--output", outputPath, "--batch-id", "pilot-a"],
    {
      cwd: ROOT_DIR,
      encoding: "utf8"
    }
  );

  assert.equal(cli.status, 0);
  const generated = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(generated.batch_id, "pilot-a");
  assert.equal(generated.conversations.length, 1);
  assert.equal(generated.conversations[0].turns.length, 3);
});

test("07 CLI irr enforces target threshold", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "annotation-workflow-"));
  const inputPath = path.join(tmpDir, "batch.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify(
      {
        batch_id: "pilot-001",
        target_count: 100,
        completed_count: 0,
        conversations: [
          {
            conversation_id: "conv-01",
            turns: [{ turn_id: "T001" }, { turn_id: "T002" }, { turn_id: "T003" }],
            rater_a: [
              { turn_id: "T001", event_code: "FR_01", severity: 4 },
              { turn_id: "T002", event_code: "CA_03", severity: 0 },
              { turn_id: "T003", event_code: "SR_01", severity: 4 }
            ],
            rater_b: [
              { turn_id: "T001", event_code: "FR_01", severity: 0 },
              { turn_id: "T002", event_code: "CA_03", severity: 4 },
              { turn_id: "T003", event_code: "SR_01", severity: 0 }
            ]
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const cli = spawnSync(
    process.execPath,
    ["scripts/annotation-workflow.mjs", "irr", "--input", inputPath, "--target-kappa", "0.61", "--enforce-target"],
    {
      cwd: ROOT_DIR,
      encoding: "utf8"
    }
  );

  assert.equal(cli.status, 1);
});

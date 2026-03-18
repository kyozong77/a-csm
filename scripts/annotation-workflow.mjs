import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runInputContract } from "./input-contract.mjs";

const DEFAULT_TARGET_COUNT = 100;
const DEFAULT_TARGET_KAPPA = 0.61;

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toBoundedNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeTurn(rawTurn) {
  const turnId = String(rawTurn?.turn_id ?? rawTurn?.turnId ?? rawTurn?.id ?? "").trim();
  const text = String(rawTurn?.text ?? "").trim();
  const role = String(rawTurn?.role ?? "").trim().toLowerCase() || "unknown";
  if (!turnId) {
    return null;
  }
  return {
    turn_id: turnId,
    role,
    text
  };
}

function normalizeAnnotationItem(rawItem, conversationId, defaultRaterId) {
  const turnId = String(rawItem?.turn_id ?? rawItem?.turnId ?? "").trim();
  if (!turnId) {
    return null;
  }

  const eventCode = String(rawItem?.event_code ?? rawItem?.eventCode ?? "UNSPECIFIED").trim().toUpperCase();
  const axis = String(rawItem?.axis ?? eventCode.split("_")[0] ?? "GEN").trim().toUpperCase();
  const severity = toBoundedNumber(rawItem?.severity, 0, 4, 0);
  const confidence = toBoundedNumber(rawItem?.confidence, 0, 1, 0.8);
  const notes = String(rawItem?.notes ?? "").trim();

  return {
    conversation_id: String(rawItem?.conversation_id ?? rawItem?.conversationId ?? conversationId).trim() || conversationId,
    turn_id: turnId,
    rater_id: String(rawItem?.rater_id ?? rawItem?.raterId ?? defaultRaterId).trim() || defaultRaterId,
    axis,
    event_code: eventCode,
    severity,
    confidence,
    notes
  };
}

function normalizeAnnotationList(rawList, conversationId, defaultRaterId) {
  if (!Array.isArray(rawList)) {
    return [];
  }

  return rawList
    .map((item) => normalizeAnnotationItem(item, conversationId, defaultRaterId))
    .filter(Boolean);
}

function normalizeConversation(rawConversation) {
  const conversationId = String(rawConversation?.conversation_id ?? rawConversation?.conversationId ?? "").trim();
  if (!conversationId) {
    return null;
  }

  const turns = Array.isArray(rawConversation?.turns)
    ? rawConversation.turns.map((turn) => normalizeTurn(turn)).filter(Boolean)
    : [];

  const raterA = normalizeAnnotationList(rawConversation?.rater_a ?? rawConversation?.raterA, conversationId, "rater_A");
  const raterB = normalizeAnnotationList(rawConversation?.rater_b ?? rawConversation?.raterB, conversationId, "rater_B");

  return {
    conversation_id: conversationId,
    turns,
    rater_a: raterA,
    rater_b: raterB,
    consensus: Array.isArray(rawConversation?.consensus) ? rawConversation.consensus : null,
    cohens_kappa: typeof rawConversation?.cohens_kappa === "number" ? rawConversation.cohens_kappa : null
  };
}

export function normalizeAnnotationBatch(rawBatch) {
  const batchId = String(rawBatch?.batch_id ?? rawBatch?.batchId ?? "pilot-study-001").trim();
  const targetCount = toPositiveInteger(rawBatch?.target_count ?? rawBatch?.targetCount, DEFAULT_TARGET_COUNT);
  const completedCount = toPositiveInteger(rawBatch?.completed_count ?? rawBatch?.completedCount, 0);

  const conversations = Array.isArray(rawBatch?.conversations)
    ? rawBatch.conversations.map((conversation) => normalizeConversation(conversation)).filter(Boolean)
    : [];

  return {
    batch_id: batchId,
    target_count: targetCount,
    completed_count: completedCount,
    conversations
  };
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJsonFile(filePath, payload) {
  const outputDir = path.dirname(filePath);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveTemplateContract(inputPath) {
  const extension = path.extname(inputPath).toLowerCase();
  const raw = fs.readFileSync(inputPath, "utf8");

  if (extension === ".json") {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.turns)) {
      return parsed;
    }
    if (Array.isArray(parsed?.steps?.input?.turns)) {
      return parsed.steps.input;
    }
    throw new Error("JSON input must include `turns` or `steps.input.turns`.");
  }

  const result = runInputContract(raw);
  if (!result.validation?.is_valid) {
    throw new Error(`Invalid transcript input: ${(result.validation?.errors ?? []).join("; ")}`);
  }
  return result;
}

export function buildAnnotationTemplate(contract, options = {}) {
  const turns = Array.isArray(contract?.turns)
    ? contract.turns.map((turn) => normalizeTurn(turn)).filter(Boolean)
    : [];

  if (!turns.length) {
    throw new Error("Input contract does not contain usable turns.");
  }

  const batchId = String(options.batch_id ?? options.batchId ?? "pilot-study-001").trim() || "pilot-study-001";
  const targetCount = toPositiveInteger(options.target_count ?? options.targetCount, DEFAULT_TARGET_COUNT);
  const conversationId =
    String(options.conversation_id ?? options.conversationId ?? contract?.metadata?.session_id ?? "conversation-001").trim() ||
    "conversation-001";

  return {
    batch_id: batchId,
    target_count: targetCount,
    completed_count: 0,
    conversations: [
      {
        conversation_id: conversationId,
        turns,
        rater_a: [],
        rater_b: [],
        consensus: null,
        cohens_kappa: null
      }
    ],
    trace: {
      generatedAt: new Date().toISOString(),
      source: options.source ?? null
    }
  };
}

function collectTurnIds(conversation) {
  const turnIds = new Set();
  for (const turn of conversation.turns) {
    turnIds.add(turn.turn_id);
  }
  for (const item of conversation.rater_a) {
    turnIds.add(item.turn_id);
  }
  for (const item of conversation.rater_b) {
    turnIds.add(item.turn_id);
  }
  return Array.from(turnIds).sort((a, b) => a.localeCompare(b));
}

function buildSeverityMap(items) {
  const map = new Map();
  for (const item of items) {
    const current = map.get(item.turn_id) ?? 0;
    map.set(item.turn_id, Math.max(current, item.severity));
  }
  return map;
}

export function cohensKappa(raterA, raterB, categoryCount = 5) {
  if (!Array.isArray(raterA) || !Array.isArray(raterB) || raterA.length !== raterB.length || raterA.length === 0) {
    return 0;
  }

  const n = raterA.length;
  let agree = 0;
  const freqA = new Array(categoryCount).fill(0);
  const freqB = new Array(categoryCount).fill(0);

  for (let index = 0; index < n; index += 1) {
    const valueA = toBoundedNumber(raterA[index], 0, categoryCount - 1, 0);
    const valueB = toBoundedNumber(raterB[index], 0, categoryCount - 1, 0);
    if (valueA === valueB) {
      agree += 1;
    }
    freqA[valueA] += 1;
    freqB[valueB] += 1;
  }

  const observed = agree / n;
  let expected = 0;
  for (let category = 0; category < categoryCount; category += 1) {
    expected += (freqA[category] / n) * (freqB[category] / n);
  }

  if (expected === 1) {
    return observed === 1 ? 1 : 0;
  }
  return Number(((observed - expected) / (1 - expected)).toFixed(6));
}

function computeAgreementRate(raterA, raterB) {
  if (!Array.isArray(raterA) || !Array.isArray(raterB) || raterA.length !== raterB.length || raterA.length === 0) {
    return 0;
  }
  let agree = 0;
  for (let index = 0; index < raterA.length; index += 1) {
    if (raterA[index] === raterB[index]) {
      agree += 1;
    }
  }
  return Number((agree / raterA.length).toFixed(6));
}

export function calculateConversationIrr(conversation) {
  const normalized = normalizeConversation(conversation);
  if (!normalized) {
    return {
      conversation_id: "unknown",
      units: 0,
      kappa: null,
      agreement_rate: null
    };
  }

  const turnIds = collectTurnIds(normalized);
  if (!turnIds.length) {
    return {
      conversation_id: normalized.conversation_id,
      units: 0,
      kappa: null,
      agreement_rate: null
    };
  }

  const severityA = buildSeverityMap(normalized.rater_a);
  const severityB = buildSeverityMap(normalized.rater_b);
  const labelsA = turnIds.map((turnId) => severityA.get(turnId) ?? 0);
  const labelsB = turnIds.map((turnId) => severityB.get(turnId) ?? 0);

  return {
    conversation_id: normalized.conversation_id,
    units: turnIds.length,
    kappa: cohensKappa(labelsA, labelsB, 5),
    agreement_rate: computeAgreementRate(labelsA, labelsB),
    labels_a: labelsA,
    labels_b: labelsB
  };
}

function roundIfNumber(value, digits = 6) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

export function calculateBatchIrr(rawBatch, options = {}) {
  const batch = normalizeAnnotationBatch(rawBatch);
  const targetKappa = toBoundedNumber(options.target_kappa ?? options.targetKappa, -1, 1, DEFAULT_TARGET_KAPPA);
  const conversationReports = batch.conversations.map((conversation) => calculateConversationIrr(conversation));
  const scored = conversationReports.filter((item) => typeof item.kappa === "number");
  const totalUnits = scored.reduce((sum, item) => sum + item.units, 0);

  const weightedKappa =
    totalUnits > 0
      ? scored.reduce((sum, item) => sum + item.kappa * item.units, 0) / totalUnits
      : null;
  const weightedAgreement =
    totalUnits > 0
      ? scored.reduce((sum, item) => sum + item.agreement_rate * item.units, 0) / totalUnits
      : null;

  const autoCompletedCount = batch.conversations.filter(
    (conversation) => conversation.rater_a.length > 0 && conversation.rater_b.length > 0
  ).length;

  return {
    batch_id: batch.batch_id,
    target_count: batch.target_count,
    completed_count: Math.max(batch.completed_count, autoCompletedCount),
    conversation_count: batch.conversations.length,
    scored_conversations: scored.length,
    target_kappa: targetKappa,
    batch_kappa: roundIfNumber(weightedKappa),
    agreement_rate: roundIfNumber(weightedAgreement),
    meets_target_kappa: typeof weightedKappa === "number" ? weightedKappa >= targetKappa : false,
    conversations: conversationReports
  };
}

export function summarizeBatchProgress(rawBatch) {
  const batch = normalizeAnnotationBatch(rawBatch);
  const completedByData = batch.conversations.filter(
    (conversation) => conversation.rater_a.length > 0 && conversation.rater_b.length > 0
  ).length;
  const completedCount = Math.max(batch.completed_count, completedByData);
  const completionRate = batch.target_count > 0 ? completedCount / batch.target_count : 0;

  return {
    batch_id: batch.batch_id,
    target_count: batch.target_count,
    conversation_count: batch.conversations.length,
    completed_count: completedCount,
    pending_count: Math.max(batch.target_count - completedCount, 0),
    completion_rate: roundIfNumber(completionRate, 4)
  };
}

function parseArgs(argv) {
  const args = {
    command: null,
    input: null,
    output: null,
    batch_id: null,
    conversation_id: null,
    target_count: DEFAULT_TARGET_COUNT,
    target_kappa: DEFAULT_TARGET_KAPPA,
    enforce_target: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!args.command && !key.startsWith("--")) {
      args.command = key;
      continue;
    }

    if (key === "--input") {
      args.input = value;
      index += 1;
      continue;
    }

    if (key === "--output") {
      args.output = value;
      index += 1;
      continue;
    }

    if (key === "--batch-id") {
      args.batch_id = value;
      index += 1;
      continue;
    }

    if (key === "--conversation-id") {
      args.conversation_id = value;
      index += 1;
      continue;
    }

    if (key === "--target-count") {
      args.target_count = toPositiveInteger(value, DEFAULT_TARGET_COUNT);
      index += 1;
      continue;
    }

    if (key === "--target-kappa") {
      args.target_kappa = toBoundedNumber(value, -1, 1, DEFAULT_TARGET_KAPPA);
      index += 1;
      continue;
    }

    if (key === "--enforce-target") {
      args.enforce_target = true;
      continue;
    }
  }

  return args;
}

function printUsage() {
  console.error(
    "Usage:\n" +
      "  node scripts/annotation-workflow.mjs template --input <path> [--output <path>] [--batch-id <id>] [--conversation-id <id>] [--target-count 100]\n" +
      "  node scripts/annotation-workflow.mjs irr --input <annotation-batch.json> [--output <path>] [--target-kappa 0.61] [--enforce-target]\n" +
      "  node scripts/annotation-workflow.mjs progress --input <annotation-batch.json>"
  );
}

function runTemplateCommand(args) {
  if (!args.input) {
    throw new Error("template command requires --input.");
  }

  const inputPath = path.resolve(args.input);
  const contract = resolveTemplateContract(inputPath);
  const template = buildAnnotationTemplate(contract, {
    batch_id: args.batch_id,
    conversation_id: args.conversation_id,
    target_count: args.target_count,
    source: inputPath
  });

  if (args.output) {
    writeJsonFile(path.resolve(args.output), template);
    console.log(`Annotation template saved: ${path.resolve(args.output)}`);
  } else {
    console.log(JSON.stringify(template, null, 2));
  }
}

function runIrrCommand(args) {
  if (!args.input) {
    throw new Error("irr command requires --input.");
  }
  const inputPath = path.resolve(args.input);
  const batch = readJsonFile(inputPath);
  const report = calculateBatchIrr(batch, {
    target_kappa: args.target_kappa
  });

  if (args.output) {
    writeJsonFile(path.resolve(args.output), report);
    console.log(`IRR report saved: ${path.resolve(args.output)}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (args.enforce_target && !report.meets_target_kappa) {
    process.exit(1);
  }
}

function runProgressCommand(args) {
  if (!args.input) {
    throw new Error("progress command requires --input.");
  }
  const inputPath = path.resolve(args.input);
  const batch = readJsonFile(inputPath);
  const summary = summarizeBatchProgress(batch);
  console.log(JSON.stringify(summary, null, 2));
}

function runCli() {
  const args = parseArgs(process.argv);
  const commands = new Set(["template", "irr", "progress"]);
  if (!args.command || !commands.has(args.command)) {
    printUsage();
    process.exit(2);
  }

  try {
    if (args.command === "template") {
      runTemplateCommand(args);
      process.exit(0);
    }
    if (args.command === "irr") {
      runIrrCommand(args);
      process.exit(0);
    }
    runProgressCommand(args);
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli();
}

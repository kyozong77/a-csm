import process from "node:process";
import { pathToFileURL } from "node:url";

function freeze(value) {
  return Object.freeze(value);
}

function createPrng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function nextInt(prng, min, max) {
  return min + Math.floor(prng() * (max - min + 1));
}

function pick(prng, values) {
  return values[nextInt(prng, 0, values.length - 1)];
}

export const GENERATOR_SEED = 20260306;

export const EXPECTED_DISTRIBUTION = freeze({
  Normal: 80,
  Observe: 50,
  Deviate: 40,
  Alert: 30
});

const CASE_ID_PREFIX = freeze({
  Normal: "normal",
  Observe: "observe",
  Deviate: "deviate",
  Alert: "alert"
});

const BENIGN_USER_LINES = freeze([
  "Please summarize confirmed requirements only.",
  "Keep the answer aligned with the approved scope.",
  "Restate the documented plan without adding new claims.",
  "Use only the verified project notes in this recap."
]);

const BENIGN_ASSISTANT_LINES = freeze([
  "I will stay within the documented scope.",
  "The reply will follow the confirmed requirements.",
  "No unsupported details will be added in the summary.",
  "I will keep the response constrained to the approved notes."
]);

const OBSERVE_TRIGGER_LINES = freeze([
  "One note for audit: ambiguous reference appears in the appendix.",
  "The source excerpt contains an ambiguous reference that needs follow-up.",
  "Flag this line because an ambiguous reference remains unresolved."
]);

const DEVIATE_TRIGGER_LINES = freeze([
  "The cited draft still has source missing in the evidence chain.",
  "An operational review found timeout repeated during execution.",
  "The log shows rate limit burst across the service boundary.",
  "Reviewer notes indicate language mismatch in the output.",
  "The summary currently relies on an unsupported claim."
]);

const ALERT_TRIGGER_LINES = freeze([
  "This escalation contains self-harm hint and must trigger safety flow.",
  "The triage note describes a medical emergency and needs urgent review.",
  "The transcript includes violence instruction and must be escalated.",
  "The content now asks for credential request handling without approval.",
  "This sample includes malware instruction and must be blocked."
]);

function buildBenignTurn(prng, caseId, turnIndex) {
  const role = turnIndex % 2 === 0 ? "user" : "assistant";
  const template = role === "user" ? pick(prng, BENIGN_USER_LINES) : pick(prng, BENIGN_ASSISTANT_LINES);
  return {
    id: `T${turnIndex + 1}`,
    role,
    sourceTrust: "trusted",
    boundaryBypass: false,
    text: `${template} (${caseId} turn ${turnIndex + 1})`
  };
}

function buildTriggeredTurn(prng, caseId, category, turnIndex) {
  const role = turnIndex % 2 === 0 ? "user" : "assistant";
  const triggerSource =
    category === "Observe"
      ? OBSERVE_TRIGGER_LINES
      : category === "Deviate"
        ? DEVIATE_TRIGGER_LINES
        : ALERT_TRIGGER_LINES;

  return {
    id: `T${turnIndex + 1}`,
    role,
    sourceTrust: "trusted",
    boundaryBypass: false,
    text: `${pick(prng, triggerSource)} (${caseId} turn ${turnIndex + 1})`
  };
}

function buildTurns(prng, caseId, category) {
  const turnCount = nextInt(prng, 2, 8);
  const triggerTurnIndex = category === "Normal" ? -1 : nextInt(prng, 0, turnCount - 1);
  const turns = [];

  for (let turnIndex = 0; turnIndex < turnCount; turnIndex += 1) {
    if (turnIndex === triggerTurnIndex) {
      turns.push(buildTriggeredTurn(prng, caseId, category, turnIndex));
      continue;
    }
    turns.push(buildBenignTurn(prng, caseId, turnIndex));
  }

  return turns;
}

function buildCase(prng, category, ordinal) {
  const caseId = `${CASE_ID_PREFIX[category]}-${String(ordinal).padStart(3, "0")}`;
  return {
    id: caseId,
    input: {
      turns: buildTurns(prng, caseId, category)
    }
  };
}

export function buildBatchPayload(seed = GENERATOR_SEED) {
  const prng = createPrng(seed);
  const cases = [];

  for (const [category, count] of Object.entries(EXPECTED_DISTRIBUTION)) {
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      cases.push(buildCase(prng, category, ordinal));
    }
  }

  return {
    meta: {
      seed,
      expectedDistribution: EXPECTED_DISTRIBUTION,
      generatedBy: "test/fixtures/generate-batch-200.mjs"
    },
    cases
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  process.env.NODE_TEST_CONTEXT === undefined &&
  !process.execArgv.some((arg) => arg.startsWith("--test"))
) {
  process.stdout.write(`${JSON.stringify(buildBatchPayload(), null, 2)}\n`);
}

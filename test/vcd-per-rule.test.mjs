import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MATRIX, evaluateVcdInference } from "../scripts/vcd-inference.mjs";

const BASE_CONFIG = {
  enabled: true,
  minSeverity: "low",
  enabledRuleIds: [],
  disabledRuleIds: [],
  dedupeByRulePerTurn: true,
  maxTriggersPerRule: 5,
  excerptMaxLength: 120,
  trustScores: {
    trusted: 0,
    unknown: 1,
    untrusted: 2
  },
  boundaryBypassScore: 3,
  detectBoundaryBypass: true,
  triggerThresholds: {
    guarded: 1,
    triggered: 4,
    lockdown: 8
  },
  responseActions: {
    CLEAR: "ALLOW",
    GUARDED: "WARN_AND_CONSTRAIN",
    TRIGGERED: "SAFE_REPLY_ONLY",
    LOCKDOWN: "ESCALATE_AND_HALT",
    DISABLED: "ALLOW"
  }
};

function buildTurns(entries) {
  return {
    turns: entries.map((entry, index) => ({
      id: entry.id ?? `T${index + 1}`,
      role: entry.role ?? "user",
      text: entry.text,
      sourceTrust: entry.sourceTrust ?? "trusted",
      boundaryBypass: entry.boundaryBypass === true
    }))
  };
}

const NEGATIVE_CASES = [
  {
    ruleId: "VCDE_01",
    description: "clean request does not trigger ignore previous instruction",
    text: "Please summarize the approved troubleshooting guide in three bullet points."
  },
  {
    ruleId: "VCDE_04",
    description: "normal clarification does not trigger disable guardrail",
    text: "Clarify the refund policy and cite the published support article."
  },
  {
    ruleId: "VCDE_07",
    description: "partial all-mode phrase does not trigger source spoofing rule",
    text: "The note claims to be an official source but provides no further proof."
  },
  {
    ruleId: "VCDE_13",
    description: "security guidance does not trigger export credential",
    text: "Store credentials in the vault and rotate them through the internal process."
  },
  {
    ruleId: "VCDE_19",
    description: "plain project note does not trigger fake memory",
    text: "Yesterday's update only changed the deployment checklist and status board."
  }
];

for (const rule of DEFAULT_MATRIX) {
  test(`per-rule trigger ${rule.id} surfaces expected family and severity`, () => {
    const triggerText =
      rule.mode === "all"
        ? `Escalation attempt: ${rule.phrases.join(" and ")}.`
        : `Escalation attempt: ${rule.phrases[0]}.`;
    const result = evaluateVcdInference(buildTurns([{ text: triggerText, sourceTrust: "trusted" }]), BASE_CONFIG);
    const event = result.events.find((item) => item.rule_id === rule.id);

    assert.ok(event, `${rule.id} should be detected`);
    assert.equal(event.source, "matrix");
    assert.equal(event.rule_id, rule.id);
    assert.equal(event.family, rule.family);
    assert.equal(event.severity, rule.severity);
    assert.deepEqual(
      event.matched_phrases,
      rule.mode === "all" ? rule.phrases : [rule.phrases[0]]
    );
  });
}

test("threshold CLEAR when risk score stays at zero", () => {
  const result = evaluateVcdInference(
    buildTurns([{ text: "Please restate the verified changelog entry.", sourceTrust: "trusted" }]),
    BASE_CONFIG
  );

  assert.equal(result.summary.status, "CLEAR");
  assert.equal(result.summary.riskScore, 0);
  assert.equal(result.summary.triggerCount, 0);
});

test("threshold GUARDED when one unknown-source signal contributes score 1", () => {
  const result = evaluateVcdInference(
    buildTurns([{ text: "Please summarize the note as written.", sourceTrust: "unknown" }]),
    BASE_CONFIG
  );

  assert.equal(result.summary.status, "GUARDED");
  assert.equal(result.summary.riskScore, 1);
  assert.equal(result.summary.trustSignals, 1);
});

test("threshold TRIGGERED when four unknown-source signals contribute score 4", () => {
  const result = evaluateVcdInference(
    buildTurns(
      Array.from({ length: 4 }, (_, index) => ({
        id: `U${index + 1}`,
        text: `Please summarize note ${index + 1} without extra assumptions.`,
        sourceTrust: "unknown"
      }))
    ),
    BASE_CONFIG
  );

  assert.equal(result.summary.status, "TRIGGERED");
  assert.equal(result.summary.riskScore, 4);
  assert.equal(result.summary.triggerCount, 4);
});

test("threshold capped TRIGGERED when eight unknown-source signals are capped by maxTriggersPerRule", () => {
  const result = evaluateVcdInference(
    buildTurns(
      Array.from({ length: 8 }, (_, index) => ({
        id: `L${index + 1}`,
        text: `Please summarize note ${index + 1} without extra assumptions.`,
        sourceTrust: "unknown"
      }))
    ),
    BASE_CONFIG
  );

  assert.equal(result.summary.status, "TRIGGERED");
  assert.equal(result.summary.riskScore, 5);
  assert.equal(result.summary.triggerCount, 5);
});

for (const scenario of NEGATIVE_CASES) {
  test(`negative case ${scenario.ruleId}: ${scenario.description}`, () => {
    const result = evaluateVcdInference(
      buildTurns([{ text: scenario.text, sourceTrust: "trusted", boundaryBypass: false }]),
      BASE_CONFIG
    );
    const event = result.events.find((item) => item.rule_id === scenario.ruleId);

    assert.equal(event, undefined);
    assert.equal(result.summary.matrixHits, 0);
    assert.equal(result.summary.triggerCount, 0);
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, runEventEngine } from "../scripts/event-engine-v1.mjs";

const BASE_CONFIG = {
  minSeverity: "low",
  enabledRuleIds: [],
  disabledRuleIds: [],
  dedupeByRulePerTurn: true,
  maxEventsPerRule: 5,
  excerptMaxLength: 140
};

function buildInput(text, role = "assistant") {
  return {
    turns: [
      {
        id: "T1",
        role,
        text
      }
    ]
  };
}

const NEGATIVE_CASES = [
  {
    ruleId: "FR_01",
    description: "clean factual summary does not trigger fabricated citation",
    text: "The release summary references the internal changelog and approved support article."
  },
  {
    ruleId: "FR_05",
    description: "clean date statement does not trigger date mismatch",
    text: "The meeting is scheduled for next Tuesday at 10 AM in the Taipei office."
  },
  {
    ruleId: "CA_02",
    description: "clear aligned instructions do not trigger instruction conflict",
    text: "Please summarize the incident, list follow-up owners, and keep the tone concise."
  },
  {
    ruleId: "CA_06",
    description: "specific references do not trigger ambiguous reference",
    text: "Section three of the onboarding guide explains how to reset the device token."
  },
  {
    ruleId: "CA_11",
    description: "policy-compliant reminder does not trigger policy contradiction",
    text: "Follow the support policy and escalate any unresolved billing issue to finance."
  },
  {
    ruleId: "SR_01",
    description: "wellbeing resources do not trigger self-harm hint",
    text: "If stress feels overwhelming, contact local support resources or a licensed counselor."
  },
  {
    ruleId: "SR_08",
    description: "security reminder does not trigger credential request",
    text: "Never share passwords in chat and rotate tokens through the secure admin console."
  },
  {
    ruleId: "SA_02",
    description: "single restart note does not trigger crash loop",
    text: "The service restarted once after maintenance and recovered normally."
  },
  {
    ruleId: "SA_07",
    description: "healthy connectivity update does not trigger network outage",
    text: "All regions are reachable and the heartbeat monitor is reporting nominal status."
  },
  {
    ruleId: "SA_10",
    description: "forward deployment note does not trigger deployment rollback",
    text: "Deployment completed successfully and traffic was shifted to the new version."
  }
];

for (const rule of DEFAULT_RULES) {
  test(`per-rule trigger ${rule.id} surfaces expected severity and axis`, () => {
    const triggerText = `Incident note: ${rule.phrases[0]}. Please investigate immediately.`;
    const result = runEventEngine(buildInput(triggerText), BASE_CONFIG);
    const event = result.events.find((item) => item.ruleId === rule.id);

    assert.ok(event, `${rule.id} should be detected`);
    assert.equal(event.ruleId, rule.id);
    assert.equal(event.severity, rule.severity);
    assert.equal(event.axis, rule.axis);
    assert.ok(event.matchedPhrases.includes(rule.phrases[0]));
  });
}

for (const scenario of NEGATIVE_CASES) {
  test(`negative case ${scenario.ruleId}: ${scenario.description}`, () => {
    const result = runEventEngine(buildInput(scenario.text), BASE_CONFIG);
    const event = result.events.find((item) => item.ruleId === scenario.ruleId);

    assert.equal(event, undefined);
    assert.equal(result.summary.totalEvents, 0);
    assert.deepEqual(result.summary.axisCounts, {});
  });
}

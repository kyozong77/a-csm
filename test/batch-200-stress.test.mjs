import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { runAcsmOrchestrator, validateReportConsistency } from "../scripts/acsm-orchestrator.mjs";
import { runAcsmBatch } from "../scripts/acsm-batch-runner.mjs";
import { DEFAULT_RULES } from "../scripts/event-engine-v1.mjs";

// ══════════════════════════════════════════════════════════════════════════
// RZV-222: Batch 200 Stress Test & Performance Baseline
// ══════════════════════════════════════════════════════════════════════════

const orchestratorConfig = {
  releaseGate: {
    requiredChecks: ["tests"],
    maxHighPriorityOpen: 0,
    maxRegressionFailures: 0,
    maxCriticalSecurity: 0,
    maxOpenIncidents: 0,
    warningHighPriorityOpenAt: null,
    minApprovals: 0,
    requireSecurityApproval: false,
    requireQaApproval: false,
    requireExceptionApprovalWhenFrozen: true,
    requireRollbackPlanWhenFrozen: true,
    requireExceptionTicketWhenFrozen: false,
    requireExceptionExpiryWhenFrozen: false,
    requireRollbackOwnerWhenFrozen: false,
    requireArtifactHashes: false,
    requiredArtifacts: []
  }
};

// ---------------------------------------------------------------------------
// Case generators
// ---------------------------------------------------------------------------

function turn(role, text) {
  return { role, text };
}

function conv(...turns) {
  return {
    turns: turns.map((t, i) => ({
      id: `T${i + 1}`,
      role: t.role || (i % 2 === 0 ? "user" : "assistant"),
      sourceTrust: t.sourceTrust || "trusted",
      boundaryBypass: t.boundaryBypass || false,
      text: t.text
    }))
  };
}

function run(input) {
  return runAcsmOrchestrator(input, orchestratorConfig);
}

const CLEAN_TOPICS = [
  "How do I make scrambled eggs?",
  "What is the capital of Japan?",
  "Explain how photosynthesis works.",
  "Help me write a thank-you email to my manager.",
  "What are some good hiking trails in Colorado?",
  "How do I center a div in CSS?",
  "What is the Pythagorean theorem?",
  "Recommend a good science fiction book.",
  "How do I change a flat tire?",
  "What is the difference between a crocodile and an alligator?",
  "Help me plan a weekly meal prep.",
  "What programming language should I learn first?",
  "How does compound interest work?",
  "What are the benefits of meditation?",
  "Explain the water cycle for a 10-year-old.",
  "How do I start a small vegetable garden?",
  "What is the best way to study for exams?",
  "How do I remove a coffee stain from a shirt?",
  "What is machine learning in simple terms?",
  "Help me write a birthday message for my friend."
];

const CLEAN_RESPONSES = [
  "Here are step-by-step instructions for making scrambled eggs.",
  "The capital of Japan is Tokyo.",
  "Photosynthesis is the process by which plants convert sunlight into energy.",
  "Here is a professional thank-you email template for your manager.",
  "Colorado has many great trails including the Colorado Trail and Hanging Lake.",
  "You can center a div using flexbox with display: flex and justify-content: center.",
  "The Pythagorean theorem states that a squared plus b squared equals c squared.",
  "I recommend Dune by Frank Herbert for an epic science fiction experience.",
  "First, find a safe flat surface, loosen the lug nuts, and jack up the vehicle.",
  "Crocodiles have V-shaped snouts while alligators have wider U-shaped snouts.",
  "A good meal prep strategy is to choose 3-4 recipes and cook them on Sunday.",
  "Python is often recommended as a great first programming language.",
  "Compound interest means earning interest on both the principal and accumulated interest.",
  "Meditation can reduce stress, improve focus, and promote emotional well-being.",
  "Water goes from the ocean to clouds through evaporation, then falls as rain.",
  "Start with easy vegetables like tomatoes, lettuce, and herbs in a sunny spot.",
  "Active recall and spaced repetition are two of the most effective study techniques.",
  "Blot the stain with cold water, apply dish soap, and wash as normal.",
  "Machine learning is teaching computers to learn patterns from data.",
  "Happy birthday! Wishing you a wonderful day filled with joy and laughter."
];

const RISKY_PHRASES = DEFAULT_RULES.map((r) => r.phrases[0]);

function cleanCase(index) {
  const topicIndex = index % CLEAN_TOPICS.length;
  return {
    id: `clean-${String(index + 1).padStart(3, "0")}`,
    input: conv(
      turn("user", CLEAN_TOPICS[topicIndex]),
      turn("assistant", CLEAN_RESPONSES[topicIndex])
    )
  };
}

function riskyCase(index, phrase) {
  return {
    id: `risky-${String(index + 1).padStart(3, "0")}`,
    input: conv(
      turn("user", "Please review this text for issues."),
      turn("assistant", `The analysis found a potential ${phrase} in the submitted content.`)
    )
  };
}

function multiTurnCleanCase(index) {
  const topicIndex = index % CLEAN_TOPICS.length;
  const nextTopicIndex = (index + 1) % CLEAN_TOPICS.length;
  return {
    id: `multi-${String(index + 1).padStart(3, "0")}`,
    input: conv(
      turn("user", CLEAN_TOPICS[topicIndex]),
      turn("assistant", CLEAN_RESPONSES[topicIndex]),
      turn("user", "Can you tell me more about that?"),
      turn("assistant", "Of course, here are additional details on the topic."),
      turn("user", CLEAN_TOPICS[nextTopicIndex]),
      turn("assistant", CLEAN_RESPONSES[nextTopicIndex])
    )
  };
}

function longTextCase(index) {
  const paragraph = "This is a standard informational paragraph about everyday topics. " +
    "It covers basic knowledge that is commonly discussed in educational settings. " +
    "The content is straightforward and does not contain any problematic material. " +
    "Students and professionals alike find this type of information useful. ";
  const fullText = paragraph.repeat(10);
  return {
    id: `long-${String(index + 1).padStart(3, "0")}`,
    input: conv(
      turn("user", "Please summarize the following text."),
      turn("assistant", fullText)
    )
  };
}

let caseIndex = 1;
function cid() {
  return String(caseIndex++).padStart(3, "0");
}

// ══════════════════════════════════════════════════════════════════════════
// A: Full 200-Case Batch Stress (5 tests)
// ══════════════════════════════════════════════════════════════════════════

test(`${cid()} 200 clean cases: all GO`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(result.decision, "GO");
  assert.equal(result.summary.processedCases, 200);
  assert.equal(result.summary.goCases, 200);
  assert.equal(result.summary.noGoCases, 0);
  assert.equal(result.summary.skippedCases, 0);
});

test(`${cid()} 200 clean cases: batch completes under 5 seconds`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const start = performance.now();
  runAcsmBatch({ cases }, orchestratorConfig);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 5000, `Batch took ${elapsed.toFixed(0)}ms, expected < 5000ms`);
});

test(`${cid()} 200 mixed cases: 157 clean + 43 risky`, () => {
  const clean = Array.from({ length: 157 }, (_, i) => cleanCase(i));
  const risky = RISKY_PHRASES.map((phrase, i) => riskyCase(i, phrase));
  const cases = [...clean, ...risky];

  assert.equal(cases.length, 200);

  const result = runAcsmBatch({ cases }, orchestratorConfig);
  assert.equal(result.summary.processedCases, 200);
  // Not all risky phrases trigger NO_GO (medium-severity rules may still GO)
  assert.ok(result.summary.noGoCases >= 27, `Expected >= 27 NO_GO, got ${result.summary.noGoCases}`);
  assert.equal(result.summary.goCases + result.summary.noGoCases, 200);
  assert.equal(result.decision, "NO_GO");
});

test(`${cid()} 200 multi-turn cases: all GO`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => multiTurnCleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(result.decision, "GO");
  assert.equal(result.summary.processedCases, 200);
  assert.equal(result.summary.goCases, 200);
});

test(`${cid()} 200 long-text cases: all GO`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => longTextCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(result.decision, "GO");
  assert.equal(result.summary.processedCases, 200);
  assert.equal(result.summary.goCases, 200);
});

// ══════════════════════════════════════════════════════════════════════════
// B: Performance Baseline (10 tests)
// ══════════════════════════════════════════════════════════════════════════

test(`${cid()} single case throughput: under 10ms`, () => {
  const input = conv(turn("user", "Hello"), turn("assistant", "Hi there!"));
  const start = performance.now();
  run(input);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 10, `Single case took ${elapsed.toFixed(2)}ms, expected < 10ms`);
});

test(`${cid()} 50-case batch throughput: under 500ms`, () => {
  const cases = Array.from({ length: 50 }, (_, i) => cleanCase(i));
  const start = performance.now();
  runAcsmBatch({ cases }, orchestratorConfig);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 500, `50-case batch took ${elapsed.toFixed(0)}ms, expected < 500ms`);
});

test(`${cid()} 100-case batch throughput: under 1500ms`, () => {
  const cases = Array.from({ length: 100 }, (_, i) => cleanCase(i));
  const start = performance.now();
  runAcsmBatch({ cases }, orchestratorConfig);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 1500, `100-case batch took ${elapsed.toFixed(0)}ms, expected < 1500ms`);
});

test(`${cid()} 200-case batch throughput: under 5000ms`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const start = performance.now();
  runAcsmBatch({ cases }, orchestratorConfig);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 5000, `200-case batch took ${elapsed.toFixed(0)}ms, expected < 5000ms`);
});

test(`${cid()} 200-case multi-turn throughput: under 8000ms`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => multiTurnCleanCase(i));
  const start = performance.now();
  runAcsmBatch({ cases }, orchestratorConfig);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 8000, `200-case multi-turn took ${elapsed.toFixed(0)}ms, expected < 8000ms`);
});

test(`${cid()} per-case average under 25ms for 200 cases`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const start = performance.now();
  runAcsmBatch({ cases }, orchestratorConfig);
  const elapsed = performance.now() - start;
  const perCase = elapsed / 200;

  assert.ok(perCase < 25, `Per-case average ${perCase.toFixed(2)}ms, expected < 25ms`);
});

test(`${cid()} long-text case under 20ms average`, () => {
  const cases = Array.from({ length: 50 }, (_, i) => longTextCase(i));
  const start = performance.now();
  runAcsmBatch({ cases }, orchestratorConfig);
  const elapsed = performance.now() - start;
  const perCase = elapsed / 50;

  assert.ok(perCase < 20, `Long-text per-case average ${perCase.toFixed(2)}ms, expected < 20ms`);
});

test(`${cid()} risky case detection under 20ms average`, () => {
  const cases = RISKY_PHRASES.map((phrase, i) => riskyCase(i, phrase));
  const start = performance.now();
  runAcsmBatch({ cases }, orchestratorConfig);
  const elapsed = performance.now() - start;
  const perCase = elapsed / cases.length;

  assert.ok(perCase < 20, `Risky per-case average ${perCase.toFixed(2)}ms, expected < 20ms`);
});

test(`${cid()} includeResults adds negligible overhead for 200 cases`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));

  const start1 = performance.now();
  runAcsmBatch({ cases }, orchestratorConfig, { includeResults: false });
  const noResults = performance.now() - start1;

  const start2 = performance.now();
  runAcsmBatch({ cases }, orchestratorConfig, { includeResults: true });
  const withResults = performance.now() - start2;

  const overhead = withResults - noResults;
  assert.ok(overhead < 1000, `includeResults overhead ${overhead.toFixed(0)}ms, expected < 1000ms`);
});

test(`${cid()} throughput is consistent across consecutive batch runs`, () => {
  const cases = Array.from({ length: 100 }, (_, i) => cleanCase(i));
  const times = [];
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    runAcsmBatch({ cases }, orchestratorConfig);
    times.push(performance.now() - start);
  }
  const maxRatio = Math.max(...times) / Math.min(...times);
  assert.ok(maxRatio < 3.0, `Max/min ratio ${maxRatio.toFixed(2)}, expected < 3.0`);
});

// ══════════════════════════════════════════════════════════════════════════
// C: Batch Result Integrity (10 tests)
// ══════════════════════════════════════════════════════════════════════════

test(`${cid()} 200 cases: each case summary has required fields`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  for (const c of result.cases) {
    assert.equal(typeof c.id, "string");
    assert.ok(["GO", "NO_GO"].includes(c.decision));
    assert.equal(typeof c.blockingFindings, "number");
    assert.equal(typeof c.unifiedEventCount, "number");
  }
});

test(`${cid()} 200 cases: case IDs preserved in output`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  const ids = new Set(result.cases.map((c) => c.id));
  assert.equal(ids.size, 200);
  assert.ok(ids.has("clean-001"));
  assert.ok(ids.has("clean-200"));
});

test(`${cid()} 200 cases: case order matches input order`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  for (let i = 0; i < 200; i++) {
    assert.equal(result.cases[i].id, cases[i].id);
  }
});

test(`${cid()} mixed 200: GO/NO_GO counts sum to 200`, () => {
  const clean = Array.from({ length: 157 }, (_, i) => cleanCase(i));
  const risky = RISKY_PHRASES.map((phrase, i) => riskyCase(i, phrase));
  const cases = [...clean, ...risky];
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(result.summary.goCases + result.summary.noGoCases, 200);
  assert.equal(result.summary.processedCases, 200);
  assert.equal(result.summary.skippedCases, 0);
});

test(`${cid()} 200 with includeResults: result array length matches`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig, { includeResults: true });

  assert.equal(Array.isArray(result.results), true);
  assert.equal(result.results.length, 200);
});

test(`${cid()} 200 with includeResults: each result has decision and summary`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig, { includeResults: true });

  for (const r of result.results) {
    assert.equal(typeof r.id, "string");
    assert.equal(typeof r.result, "object");
    assert.ok(["GO", "NO_GO"].includes(r.result.decision));
    assert.equal(typeof r.result.summary, "object");
  }
});

test(`${cid()} batch trace includes input and summary steps`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.ok(result.trace.some((t) => t.step === "input"));
  assert.ok(result.trace.some((t) => t.step === "summary"));
});

test(`${cid()} batch findings empty for 200 clean cases`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(result.findings.length, 0);
});

test(`${cid()} batch generatedAt is valid ISO timestamp`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  const parsed = new Date(result.generatedAt);
  assert.equal(isNaN(parsed.getTime()), false);
});

test(`${cid()} batch result is deterministic for identical input`, () => {
  const cases = Array.from({ length: 50 }, (_, i) => cleanCase(i));
  const a = runAcsmBatch({ cases }, orchestratorConfig);
  const b = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(a.decision, b.decision);
  assert.equal(a.summary.goCases, b.summary.goCases);
  for (let i = 0; i < 50; i++) {
    assert.equal(a.cases[i].decision, b.cases[i].decision);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// D: Batch Options & Edge Cases (10 tests)
// ══════════════════════════════════════════════════════════════════════════

test(`${cid()} stopOnNoGo with risky case at position 50 stops early`, () => {
  const cases = [
    ...Array.from({ length: 49 }, (_, i) => cleanCase(i)),
    riskyCase(49, "fabricated citation"),
    ...Array.from({ length: 150 }, (_, i) => cleanCase(i + 50))
  ];
  const result = runAcsmBatch({ cases }, orchestratorConfig, { stopOnNoGo: true });

  assert.equal(result.decision, "NO_GO");
  assert.equal(result.summary.processedCases, 50);
  assert.equal(result.summary.skippedCases, 150);
  assert.equal(result.summary.stopReason, "no-go");
});

test(`${cid()} stopOnNoGo false processes all 200 even with risky cases`, () => {
  const cases = [
    ...Array.from({ length: 100 }, (_, i) => cleanCase(i)),
    riskyCase(100, "self-harm hint"),
    ...Array.from({ length: 99 }, (_, i) => cleanCase(i + 101))
  ];
  const result = runAcsmBatch({ cases }, orchestratorConfig, { stopOnNoGo: false });

  assert.equal(result.summary.processedCases, 200);
  assert.equal(result.summary.noGoCases, 1);
  assert.equal(result.summary.goCases, 199);
  assert.equal(result.summary.skippedCases, 0);
});

test(`${cid()} 201 cases rejected with default maxCases`, () => {
  const cases = Array.from({ length: 201 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(result.decision, "NO_GO");
  assert.ok(result.findings.some((f) => f.id === "batch-max-cases-exceeded"));
});

test(`${cid()} maxCases=250 allows 201 cases`, () => {
  const cases = Array.from({ length: 201 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig, { maxCases: 250 });

  assert.equal(result.decision, "GO");
  assert.equal(result.summary.processedCases, 201);
});

test(`${cid()} empty batch produces GO with zero processed`, () => {
  const result = runAcsmBatch({ cases: [] }, orchestratorConfig);

  assert.equal(result.decision, "GO");
  assert.equal(result.summary.processedCases, 0);
  assert.equal(result.summary.goCases, 0);
});

test(`${cid()} single case batch works correctly`, () => {
  const cases = [cleanCase(0)];
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(result.decision, "GO");
  assert.equal(result.summary.processedCases, 1);
  assert.equal(result.cases.length, 1);
});

test(`${cid()} all 43 risky phrases processed in batch`, () => {
  const cases = RISKY_PHRASES.map((phrase, i) => riskyCase(i, phrase));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(result.summary.processedCases, 43);
  // Medium-severity rules may still produce GO; at least 27 should be NO_GO
  assert.ok(result.summary.noGoCases >= 27, `Expected >= 27 NO_GO, got ${result.summary.noGoCases}`);
  assert.equal(result.summary.goCases + result.summary.noGoCases, 43);
  assert.equal(result.decision, "NO_GO");
});

test(`${cid()} risky cases at random positions detected in 200-case batch`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const riskyPositions = [3, 42, 99, 150, 199];
  for (const pos of riskyPositions) {
    cases[pos] = riskyCase(pos, "fabricated citation");
  }
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(result.summary.noGoCases, 5);
  assert.equal(result.summary.goCases, 195);
});

test(`${cid()} batch with duplicate IDs still processes all cases`, () => {
  const cases = Array.from({ length: 10 }, () => ({
    id: "dup-id",
    input: conv(turn("user", "Hello"), turn("assistant", "Hi"))
  }));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(result.summary.processedCases, 10);
});

test(`${cid()} consistency validation passes for all 200 batch results`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig, { includeResults: true });

  for (const entry of result.results) {
    const v = validateReportConsistency(entry.result);
    assert.equal(v.consistent, true, `Case ${entry.id} failed consistency: ${JSON.stringify(v.violations)}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// E: Determinism & Reproducibility (5 tests)
// ══════════════════════════════════════════════════════════════════════════

test(`${cid()} 200-case batch is fully deterministic`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const a = runAcsmBatch({ cases }, orchestratorConfig);
  const b = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(a.decision, b.decision);
  assert.equal(a.summary.processedCases, b.summary.processedCases);
  assert.equal(a.summary.goCases, b.summary.goCases);
  assert.equal(a.summary.noGoCases, b.summary.noGoCases);
  for (let i = 0; i < 200; i++) {
    assert.equal(a.cases[i].id, b.cases[i].id);
    assert.equal(a.cases[i].decision, b.cases[i].decision);
  }
});

test(`${cid()} mixed batch determinism: decisions match across runs`, () => {
  const clean = Array.from({ length: 157 }, (_, i) => cleanCase(i));
  const risky = RISKY_PHRASES.map((phrase, i) => riskyCase(i, phrase));
  const cases = [...clean, ...risky];

  const a = runAcsmBatch({ cases }, orchestratorConfig);
  const b = runAcsmBatch({ cases }, orchestratorConfig);

  for (let i = 0; i < 200; i++) {
    assert.equal(a.cases[i].decision, b.cases[i].decision, `Case ${i} mismatch`);
  }
});

test(`${cid()} individual run matches batch result for same input`, () => {
  const input = conv(turn("user", "How do I boil an egg?"), turn("assistant", "Place eggs in cold water, bring to a boil, then simmer for 9-12 minutes."));
  const single = run(input);
  const batch = runAcsmBatch(
    { cases: [{ id: "c1", input }] },
    orchestratorConfig,
    { includeResults: true }
  );

  assert.equal(single.decision, batch.results[0].result.decision);
  assert.equal(single.summary.unifiedEventCount, batch.results[0].result.summary.unifiedEventCount);
});

test(`${cid()} batch with includeResults deterministic`, () => {
  const cases = Array.from({ length: 50 }, (_, i) => cleanCase(i));
  const a = runAcsmBatch({ cases }, orchestratorConfig, { includeResults: true });
  const b = runAcsmBatch({ cases }, orchestratorConfig, { includeResults: true });

  assert.equal(a.results.length, b.results.length);
  for (let i = 0; i < 50; i++) {
    assert.equal(a.results[i].result.decision, b.results[i].result.decision);
  }
});

test(`${cid()} multi-turn batch determinism`, () => {
  const cases = Array.from({ length: 100 }, (_, i) => multiTurnCleanCase(i));
  const a = runAcsmBatch({ cases }, orchestratorConfig);
  const b = runAcsmBatch({ cases }, orchestratorConfig);

  for (let i = 0; i < 100; i++) {
    assert.equal(a.cases[i].decision, b.cases[i].decision);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// F: Scale & Distribution Analysis (10 tests)
// ══════════════════════════════════════════════════════════════════════════

test(`${cid()} 200 cases: zero unified events for all clean`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  for (const c of result.cases) {
    assert.equal(c.unifiedEventCount, 0, `Case ${c.id} has ${c.unifiedEventCount} events`);
  }
});

test(`${cid()} 200 cases: all clean have CLEAR vcdStatus`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  for (const c of result.cases) {
    assert.equal(c.vcdStatus, "CLEAR", `Case ${c.id} has vcd ${c.vcdStatus}`);
  }
});

test(`${cid()} 200 cases: all clean have LOW tagDecisionLevel`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  for (const c of result.cases) {
    assert.equal(c.tagDecisionLevel, "LOW", `Case ${c.id} has tag ${c.tagDecisionLevel}`);
  }
});

test(`${cid()} 200 cases: all clean have PASS schemaDecision`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  for (const c of result.cases) {
    assert.equal(c.schemaDecision, "PASS", `Case ${c.id} has schema ${c.schemaDecision}`);
  }
});

test(`${cid()} 200 cases: all clean have GO releaseGateDecision`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => cleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  for (const c of result.cases) {
    assert.equal(c.releaseGateDecision, "GO", `Case ${c.id} has gate ${c.releaseGateDecision}`);
  }
});

test(`${cid()} mixed batch: risky cases have nonzero events`, () => {
  const clean = Array.from({ length: 10 }, (_, i) => cleanCase(i));
  const risky = RISKY_PHRASES.slice(0, 10).map((phrase, i) => riskyCase(i, phrase));
  const cases = [...clean, ...risky];
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  const riskyCases = result.cases.filter((c) => c.id.startsWith("risky-"));
  for (const c of riskyCases) {
    assert.ok(c.unifiedEventCount > 0, `Risky case ${c.id} has 0 events`);
  }
});

test(`${cid()} all 4 axes detectable in a 200-case batch`, () => {
  const cases = [
    ...Array.from({ length: 196 }, (_, i) => cleanCase(i)),
    riskyCase(196, "fabricated citation"),
    riskyCase(197, "instruction conflict"),
    riskyCase(198, "self-harm hint"),
    riskyCase(199, "crash loop")
  ];
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(result.summary.noGoCases, 4);
  assert.equal(result.summary.goCases, 196);
});

test(`${cid()} 200 multi-turn cases: zero blocking findings`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => multiTurnCleanCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  for (const c of result.cases) {
    assert.equal(c.blockingFindings, 0, `Case ${c.id} has ${c.blockingFindings} blocking findings`);
  }
});

test(`${cid()} 200 long-text cases: none trigger false positives`, () => {
  const cases = Array.from({ length: 200 }, (_, i) => longTextCase(i));
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  assert.equal(result.summary.goCases, 200);
  assert.equal(result.summary.noGoCases, 0);
});

test(`${cid()} batch with alternating clean and risky cases`, () => {
  const cases = [];
  const riskyCount = Math.min(Math.ceil(200 / 5), RISKY_PHRASES.length);
  for (let i = 0; i < 200; i++) {
    if (i % 5 === 0 && i / 5 < RISKY_PHRASES.length) {
      cases.push(riskyCase(i, RISKY_PHRASES[i / 5]));
    } else {
      cases.push(cleanCase(i));
    }
  }
  const result = runAcsmBatch({ cases }, orchestratorConfig);

  // Medium-severity risky phrases may still produce GO
  assert.ok(result.summary.noGoCases >= 1, "At least some risky cases should be NO_GO");
  assert.equal(result.summary.goCases + result.summary.noGoCases, 200);
  assert.equal(result.summary.processedCases, 200);
  assert.equal(result.decision, "NO_GO");
});

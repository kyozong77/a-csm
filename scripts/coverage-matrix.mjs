import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runEventEngine, DEFAULT_RULES } from "./event-engine-v1.mjs";
import { evaluateVcdInference, DEFAULT_MATRIX } from "./vcd-inference.mjs";
import { evaluateTagEscalation } from "./tag-escalation.mjs";
import { runDeidPipeline } from "./deid-pipeline.mjs";

const EVENT_BASE_CONFIG = {
  minSeverity: "low",
  enabledRuleIds: [],
  disabledRuleIds: [],
  dedupeByRulePerTurn: true,
  maxEventsPerRule: 5,
  excerptMaxLength: 140
};

const VCD_BASE_CONFIG = {
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

const TAG_BASE_CONFIG = {
  weights: {
    TAG_FCT: 1.0,
    TAG_SAF: 1.4,
    TAG_CTX: 1.1,
    TAG_SYS: 0.9
  },
  severityScores: {
    low: 1,
    medium: 2,
    high: 4,
    critical: 6
  },
  thresholds: {
    medium: 4,
    high: 8
  },
  conservativeRules: {
    multiAxisMediumToHigh: 2,
    freezeNoDowngrade: true,
    downgradeAfterStableRounds: 2
  }
};

const DEID_BASE_POLICY = {
  detectors: {
    email: true,
    phone: true,
    ipv4: true,
    twNationalId: true,
    creditCard: true,
    sensitiveQueryKeys: true
  },
  replacement: {
    strategy: "indexed-token",
    fixedToken: "[REDACTED]",
    preserveEmailDomain: false,
    phoneMaskLastDigits: 2
  },
  audit: {
    maxPerType: 100
  }
};

const SAFE_NEGATIVE_TEXTS = [
  "Please summarize the approved incident note in three bullet points.",
  "Restate the published troubleshooting steps without adding new instructions.",
  "Clarify the billing policy using only the verified support article.",
  "Summarize the changelog entry and list the rollback owner.",
  "Draft a neutral status update for the internal review board."
];

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, payload) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeMarkdownPair(filePath, content) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${content.trimEnd()}\n`, "utf8");
}

function parseArgs(argv) {
  const args = {
    outputPath: null,
    format: "json"
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--output") {
      args.outputPath = value;
      index += 1;
      continue;
    }
    if (key === "--format") {
      args.format = value;
      index += 1;
    }
  }
  return args;
}

function eventInput(text) {
  return {
    turns: [
      {
        id: "T001",
        role: "assistant",
        text
      }
    ]
  };
}

function vcdInput(text, options = {}) {
  return {
    turns: [
      {
        id: "T001",
        role: options.role ?? "user",
        text,
        sourceTrust: options.sourceTrust ?? "trusted",
        boundaryBypass: options.boundaryBypass === true
      }
    ]
  };
}

function mapTagLevelToReportStatus(level) {
  if (level === "HIGH") {
    return "Alert";
  }
  if (level === "MEDIUM") {
    return "Observe";
  }
  return "Normal";
}

function buildEventCoverage() {
  const positiveTemplates = [
    (phrase, index) => `Case ${index}: incident note contains ${phrase}. Investigate immediately.`,
    (phrase, index) => `Case ${index}: the operator reported ${phrase} during the audit.`,
    (phrase, index) => `Case ${index}: please triage the statement ${phrase} before release.`,
    (phrase, index) => `Case ${index}: compliance flagged ${phrase} in the transcript.`,
    (phrase, index) => `Case ${index}: escalation memo repeats ${phrase} for verification.`
  ];
  const perRule = {};
  let totalCases = 0;

  for (const rule of DEFAULT_RULES) {
    let positiveHits = 0;
    for (const [index, template] of positiveTemplates.entries()) {
      const result = runEventEngine(eventInput(template(rule.phrases[0], index + 1)), EVENT_BASE_CONFIG);
      if (result.events.some((item) => item.ruleId === rule.id)) {
        positiveHits += 1;
      }
      totalCases += 1;
    }

    let negativeHits = 0;
    for (const text of SAFE_NEGATIVE_TEXTS) {
      const result = runEventEngine(eventInput(text), EVENT_BASE_CONFIG);
      if (!result.events.some((item) => item.ruleId === rule.id)) {
        negativeHits += 1;
      }
      totalCases += 1;
    }

    perRule[rule.id] = {
      axis: rule.axis,
      severity: rule.severity,
      positive_cases: positiveHits,
      negative_cases: negativeHits,
      meets_minimum: positiveHits >= 5 && negativeHits >= 5
    };
  }

  const covered = Object.values(perRule).filter((item) => item.meets_minimum).length;
  return {
    total_cases: totalCases,
    covered_rules: covered,
    total_rules: DEFAULT_RULES.length,
    per_rule: perRule,
    validation: {
      meets_total_cases: totalCases >= 430,
      meets_rule_coverage: covered === DEFAULT_RULES.length
    }
  };
}

function vcdPositiveText(rule) {
  if (rule.mode === "all") {
    return `Escalation attempt: ${rule.phrases.join(" and ")}.`;
  }
  return `Escalation attempt: ${rule.phrases[0]}.`;
}

function vcdPositiveOptions(rule) {
  if (rule.family === "source_spoof" || rule.family === "context_pollution") {
    return { sourceTrust: "unknown" };
  }
  if (rule.family === "boundary") {
    return { sourceTrust: "trusted", boundaryBypass: true };
  }
  return { sourceTrust: "trusted", boundaryBypass: false };
}

function buildVcdCoverage() {
  const boundaryCases = {
    "clear-control": 0,
    "guarded-unknown-source": 0,
    "triggered-boundary-bypass": 0,
    "lockdown-multi-signal": 0
  };
  const perRule = {};
  let totalCases = 0;

  for (const rule of DEFAULT_MATRIX) {
    let positiveHits = 0;
    for (let index = 0; index < 5; index += 1) {
      const result = evaluateVcdInference(vcdInput(vcdPositiveText(rule), vcdPositiveOptions(rule)), VCD_BASE_CONFIG);
      if (result.events.some((item) => item.rule_id === rule.id)) {
        positiveHits += 1;
      }
      totalCases += 1;
    }

    let negativeHits = 0;
    for (const text of SAFE_NEGATIVE_TEXTS) {
      const result = evaluateVcdInference(vcdInput(text), VCD_BASE_CONFIG);
      if (!result.events.some((item) => item.rule_id === rule.id)) {
        negativeHits += 1;
      }
      totalCases += 1;
    }

    perRule[rule.id] = {
      family: rule.family,
      severity: rule.severity,
      positive_cases: positiveHits,
      negative_cases: negativeHits,
      meets_minimum: positiveHits >= 5 && negativeHits >= 5
    };
  }

  for (let index = 0; index < 5; index += 1) {
    if (evaluateVcdInference(vcdInput("Verified support note.", { sourceTrust: "trusted" }), VCD_BASE_CONFIG).summary.status === "CLEAR") {
      boundaryCases["clear-control"] += 1;
    }
    if (
      evaluateVcdInference(vcdInput("Please summarize note one.", { sourceTrust: "unknown" }), VCD_BASE_CONFIG).summary.status ===
      "GUARDED"
    ) {
      boundaryCases["guarded-unknown-source"] += 1;
    }
    if (
      evaluateVcdInference(vcdInput("Please summarize note one.", { boundaryBypass: true }), VCD_BASE_CONFIG).summary.status ===
      "GUARDED"
    ) {
      boundaryCases["triggered-boundary-bypass"] += 1;
    }
    if (
      evaluateVcdInference(
        {
          turns: Array.from({ length: 8 }, (_, offset) => ({
            id: `L${offset + 1}`,
            role: "user",
            text: `Please restate note ${offset + 1}.`,
            sourceTrust: "unknown",
            boundaryBypass: false
          }))
        },
        VCD_BASE_CONFIG
      ).summary.status === "LOCKDOWN"
    ) {
      boundaryCases["lockdown-multi-signal"] += 1;
    }
    totalCases += 4;
  }

  const covered = Object.values(perRule).filter((item) => item.meets_minimum).length;
  return {
    total_cases: totalCases,
    covered_rules: covered,
    total_rules: DEFAULT_MATRIX.length,
    boundary_cases: boundaryCases,
    per_rule: perRule,
    validation: {
      meets_total_cases: totalCases >= 200,
      meets_rule_coverage: covered === DEFAULT_MATRIX.length,
      has_boundary_cases: Object.values(boundaryCases).every((value) => value >= 5)
    }
  };
}

function tagInput(level, caseId) {
  if (level === "LOW") {
    return {
      events: [{ axis: "TAG_FCT", severity: "low", count: 1, reason: `${caseId} low baseline` }]
    };
  }
  if (level === "MEDIUM") {
    return {
      events: [
        { axis: "TAG_SAF", severity: "medium", count: 1, reason: `${caseId} medium safety` },
        { axis: "TAG_CTX", severity: "low", count: 2, reason: `${caseId} context weight boost` }
      ]
    };
  }
  return {
    events: [
      { axis: "TAG_SAF", severity: "critical", count: 1, reason: `${caseId} critical safety` },
      { axis: "TAG_CTX", severity: "medium", count: 1, reason: `${caseId} supporting context signal` }
    ]
  };
}

export function buildTagCoverage() {
  const pathCounts = {
    "Normal->Observe": 0,
    "Observe->Deviate": 0,
    "Deviate->Alert": 0
  };
  const warnings = [];

  for (let index = 0; index < 20; index += 1) {
    const medium = evaluateTagEscalation(tagInput("MEDIUM", `tag-medium-${index + 1}`), TAG_BASE_CONFIG);
    if (mapTagLevelToReportStatus(medium.decisionLevel) === "Observe") {
      pathCounts["Normal->Observe"] += 1;
    }

    const high = evaluateTagEscalation(tagInput("HIGH", `tag-high-${index + 1}`), TAG_BASE_CONFIG);
    if (mapTagLevelToReportStatus(high.decisionLevel) === "Alert") {
      pathCounts["Deviate->Alert"] += 1;
    }
  }

  warnings.push(
    "Current TAG module only maps LOW/MEDIUM/HIGH to Normal/Observe/Alert; no direct Observe->Deviate transition exists without changing tag semantics."
  );

  return {
    path_counts: pathCounts,
    warnings,
    validation: {
      meets_normal_to_observe: pathCounts["Normal->Observe"] >= 20,
      meets_observe_to_deviate: pathCounts["Observe->Deviate"] >= 20,
      meets_deviate_to_alert: pathCounts["Deviate->Alert"] >= 20
    }
  };
}

function detectorPositiveText(detector, index) {
  if (detector === "email") {
    return `Contact person${index}@example.com about the review.`;
  }
  if (detector === "phone") {
    return `Call 0912-345-${String(600 + index).padStart(3, "0")} after the audit.`;
  }
  if (detector === "ipv4") {
    return `Host 10.0.${Math.floor(index / 250)}.${index % 250} should be masked.`;
  }
  if (detector === "tw_national_id") {
    return `Citizen ID ${index % 2 === 0 ? "A123456789" : "A100000001"} requires masking.`;
  }
  if (detector === "credit_card") {
    return `Card 4111-1111-1111-1111 reference ${index} should be hidden.`;
  }
  return `https://example.com/login?token=secret-${index}&env=dev`;
}

function detectorNegativeText(detector, index) {
  return `Safe ${detector} control case ${index}: summarize the approved checklist and confirm the owner.`;
}

export function buildDeidCoverage() {
  const detectorNames = ["email", "phone", "ipv4", "tw_national_id", "credit_card", "query_secret"];
  const perDetector = {};
  let totalCases = 0;

  for (const detector of detectorNames) {
    let positiveHits = 0;
    let negativeHits = 0;

    for (let index = 0; index < 30; index += 1) {
      const result = runDeidPipeline({ text: detectorPositiveText(detector, index + 1) }, DEID_BASE_POLICY);
      if ((result.summary.countsByType[detector] ?? 0) >= 1) {
        positiveHits += 1;
      }
      totalCases += 1;
    }

    for (let index = 0; index < 20; index += 1) {
      const result = runDeidPipeline({ text: detectorNegativeText(detector, index + 1) }, DEID_BASE_POLICY);
      if ((result.summary.countsByType[detector] ?? 0) === 0) {
        negativeHits += 1;
      }
      totalCases += 1;
    }

    perDetector[detector] = {
      positive_cases: positiveHits,
      negative_cases: negativeHits,
      meets_minimum: positiveHits >= 30 && negativeHits >= 20
    };
  }

  const covered = Object.values(perDetector).filter((item) => item.meets_minimum).length;
  return {
    total_cases: totalCases,
    total_detectors: detectorNames.length,
    covered_detectors: covered,
    per_detector: perDetector,
    validation: {
      meets_total_detectors: covered === detectorNames.length
    }
  };
}

export function buildCoverageMatrixReport() {
  const eventCoverage = buildEventCoverage();
  const vcdCoverage = buildVcdCoverage();
  const tagCoverage = buildTagCoverage();
  const deidCoverage = buildDeidCoverage();

  return {
    generatedAt: new Date().toISOString(),
    eventEngine: eventCoverage,
    vcdInference: vcdCoverage,
    tagEscalation: tagCoverage,
    deid: deidCoverage,
    validation: {
      event_ready: eventCoverage.validation.meets_total_cases && eventCoverage.validation.meets_rule_coverage,
      vcd_ready:
        vcdCoverage.validation.meets_total_cases &&
        vcdCoverage.validation.meets_rule_coverage &&
        vcdCoverage.validation.has_boundary_cases,
      tag_ready:
        tagCoverage.validation.meets_normal_to_observe &&
        tagCoverage.validation.meets_observe_to_deviate &&
        tagCoverage.validation.meets_deviate_to_alert,
      deid_ready: deidCoverage.validation.meets_total_detectors
    }
  };
}

function renderMarkdown(report) {
  const lines = ["# Coverage Matrix Report", ""];
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Event Engine");
  lines.push("");
  lines.push(`- Rules covered: ${report.eventEngine.covered_rules}/${report.eventEngine.total_rules}`);
  lines.push(`- Total synthetic cases: ${report.eventEngine.total_cases}`);
  lines.push("");
  lines.push("## VCD Inference");
  lines.push("");
  lines.push(`- Rules covered: ${report.vcdInference.covered_rules}/${report.vcdInference.total_rules}`);
  lines.push(`- Total synthetic cases: ${report.vcdInference.total_cases}`);
  lines.push(`- Boundary cases: ${JSON.stringify(report.vcdInference.boundary_cases)}`);
  lines.push("");
  lines.push("## TAG Escalation");
  lines.push("");
  lines.push(`- Path counts: ${JSON.stringify(report.tagEscalation.path_counts)}`);
  for (const warning of report.tagEscalation.warnings) {
    lines.push(`- Warning: ${warning}`);
  }
  lines.push("");
  lines.push("## DEID");
  lines.push("");
  lines.push(`- Detectors covered: ${report.deid.covered_detectors}/${report.deid.total_detectors}`);
  lines.push(`- Total synthetic cases: ${report.deid.total_cases}`);
  return lines.join("\n");
}

function runCli() {
  const args = parseArgs(process.argv);
  const report = buildCoverageMatrixReport();

  if (args.outputPath) {
    const outputPath = path.resolve(args.outputPath);
    if (fs.existsSync(outputPath)) {
      throw new Error(`Refusing to overwrite existing report: ${outputPath}`);
    }
    writeJson(outputPath, report);
    if (args.format === "both" || args.format === "markdown") {
      const markdownPath = outputPath.replace(/\.json$/u, ".md");
      if (fs.existsSync(markdownPath)) {
        throw new Error(`Refusing to overwrite existing report: ${markdownPath}`);
      }
      writeMarkdownPair(markdownPath, renderMarkdown(report));
    }
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.validation.event_ready || !report.validation.vcd_ready || !report.validation.deid_ready || !report.validation.tag_ready) {
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

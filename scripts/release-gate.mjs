import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG = {
  requiredChecks: ["tests", "lint", "build"],
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
};

function normalizeStringList(items = []) {
  const normalized = [];
  const seen = new Set();
  for (const item of items) {
    if (typeof item !== "string") {
      continue;
    }
    const value = item.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function mergeConfig(rawConfig = {}) {
  const requiredChecks = Array.isArray(rawConfig.requiredChecks)
    ? normalizeStringList(rawConfig.requiredChecks)
    : DEFAULT_CONFIG.requiredChecks;
  const requiredArtifacts = Array.isArray(rawConfig.requiredArtifacts)
    ? normalizeStringList(rawConfig.requiredArtifacts)
    : DEFAULT_CONFIG.requiredArtifacts;

  return {
    ...DEFAULT_CONFIG,
    ...rawConfig,
    requiredChecks,
    requiredArtifacts
  };
}

function normalizeCheckStatus(value) {
  if (value === true || value === "pass" || value === "passed") {
    return "pass";
  }
  if (value === false || value === "fail" || value === "failed") {
    return "fail";
  }
  return "unknown";
}

function getMissingArtifacts(requiredArtifacts, presentArtifacts = []) {
  const required = normalizeStringList(requiredArtifacts);
  const present = new Set(normalizeStringList(presentArtifacts));
  return required.filter((item) => !present.has(item));
}

function addFinding(findings, id, severity, message, blocking) {
  findings.push({ id, severity, message, blocking: Boolean(blocking) });
}

function toKebabCase(value) {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function parseMetric(findings, metrics, key) {
  const rawValue = metrics[key];
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return 0;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue)) {
    addFinding(
      findings,
      `metric-${key}-invalid`,
      "error",
      `Metric '${key}' must be a finite number.`,
      true
    );
    return null;
  }
  if (!Number.isInteger(parsedValue)) {
    addFinding(
      findings,
      `metric-${key}-not-integer`,
      "error",
      `Metric '${key}' must be an integer.`,
      true
    );
    return null;
  }
  if (parsedValue < 0) {
    addFinding(
      findings,
      `metric-${key}-negative`,
      "error",
      `Metric '${key}' cannot be negative.`,
      true
    );
    return null;
  }

  return parsedValue;
}

function parseNonNegativeConfigInteger(findings, config, key, options = {}) {
  const { allowNull = false } = options;
  const rawValue = config[key];

  if (allowNull && (rawValue === undefined || rawValue === null || rawValue === "")) {
    return null;
  }

  const parsedValue = Number(rawValue);
  const field = toKebabCase(key);
  if (!Number.isFinite(parsedValue) || !Number.isInteger(parsedValue) || parsedValue < 0) {
    addFinding(
      findings,
      `config-${field}-invalid`,
      "error",
      `Config '${key}' must be a non-negative integer${allowNull ? " or null" : ""}.`,
      true
    );
    return allowNull ? null : DEFAULT_CONFIG[key];
  }
  return parsedValue;
}

function normalizeConfig(findings, rawConfig) {
  const config = mergeConfig(rawConfig);

  config.maxHighPriorityOpen = parseNonNegativeConfigInteger(findings, config, "maxHighPriorityOpen");
  config.maxRegressionFailures = parseNonNegativeConfigInteger(
    findings,
    config,
    "maxRegressionFailures"
  );
  config.maxCriticalSecurity = parseNonNegativeConfigInteger(findings, config, "maxCriticalSecurity");
  config.maxOpenIncidents = parseNonNegativeConfigInteger(findings, config, "maxOpenIncidents");
  config.minApprovals = parseNonNegativeConfigInteger(findings, config, "minApprovals");
  config.warningHighPriorityOpenAt = parseNonNegativeConfigInteger(
    findings,
    config,
    "warningHighPriorityOpenAt",
    { allowNull: true }
  );

  if (
    config.warningHighPriorityOpenAt !== null &&
    config.warningHighPriorityOpenAt > config.maxHighPriorityOpen
  ) {
    addFinding(
      findings,
      "config-warning-high-priority-open-at-range",
      "error",
      "Config 'warningHighPriorityOpenAt' cannot exceed 'maxHighPriorityOpen'.",
      true
    );
  }

  return config;
}

function parseIsoDate(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSha256(value) {
  return typeof value === "string" && /^[A-Fa-f0-9]{64}$/.test(value.trim());
}

export function evaluateGate(input = {}, rawConfig = {}) {
  const findings = [];
  const config = normalizeConfig(findings, rawConfig);

  const checks = input.checks ?? {};
  for (const checkName of config.requiredChecks) {
    const status = normalizeCheckStatus(checks[checkName]);
    if (status === "pass") {
      continue;
    }
    if (status === "unknown") {
      addFinding(
        findings,
        `check-${checkName}-missing`,
        "error",
        `Required check '${checkName}' is missing.`,
        true
      );
      continue;
    }
    addFinding(
      findings,
      `check-${checkName}-failed`,
      "error",
      `Required check '${checkName}' failed.`,
      true
    );
  }

  const metrics = input.metrics ?? {};
  const criticalOpen = parseMetric(findings, metrics, "criticalOpen");
  const highOpen = parseMetric(findings, metrics, "highOpen");
  const regressionFailures = parseMetric(findings, metrics, "regressionFailures");
  const openIncidents = parseMetric(findings, metrics, "openIncidents");

  if (criticalOpen !== null && criticalOpen > config.maxCriticalSecurity) {
    addFinding(
      findings,
      "critical-security-open",
      "error",
      `Critical security items open: ${criticalOpen} > ${config.maxCriticalSecurity}.`,
      true
    );
  }

  if (highOpen !== null && highOpen > config.maxHighPriorityOpen) {
    addFinding(
      findings,
      "high-priority-open",
      "error",
      `High priority items open: ${highOpen} > ${config.maxHighPriorityOpen}.`,
      true
    );
  }

  if (regressionFailures !== null && regressionFailures > config.maxRegressionFailures) {
    addFinding(
      findings,
      "regression-failures",
      "error",
      `Regression failures: ${regressionFailures} > ${config.maxRegressionFailures}.`,
      true
    );
  }

  if (openIncidents !== null && openIncidents > config.maxOpenIncidents) {
    addFinding(
      findings,
      "open-incidents",
      "error",
      `Open incidents: ${openIncidents} > ${config.maxOpenIncidents}.`,
      true
    );
  }

  if (
    highOpen !== null &&
    config.warningHighPriorityOpenAt !== null &&
    highOpen >= config.warningHighPriorityOpenAt &&
    highOpen <= config.maxHighPriorityOpen
  ) {
    addFinding(
      findings,
      "high-priority-near-threshold",
      "warning",
      `High priority items open reached warning threshold: ${highOpen} >= ${config.warningHighPriorityOpenAt}.`,
      false
    );
  }

  const approvals = input.approvals ?? {};
  const totalApprovals = parseMetric(findings, approvals, "totalApprovals");
  if (totalApprovals !== null && totalApprovals < config.minApprovals) {
    addFinding(
      findings,
      "approvals-below-min",
      "error",
      `Total approvals: ${totalApprovals} < ${config.minApprovals}.`,
      true
    );
  }

  if (config.requireSecurityApproval && !approvals.securityApproved) {
    addFinding(
      findings,
      "approvals-missing-security",
      "error",
      "Security approval is required.",
      true
    );
  }

  if (config.requireQaApproval && !approvals.qaApproved) {
    addFinding(findings, "approvals-missing-qa", "error", "QA approval is required.", true);
  }

  const freeze = input.freeze ?? {};
  const freezeActive = Boolean(freeze.active);

  if (freezeActive && config.requireExceptionApprovalWhenFrozen && !freeze.exceptionApproved) {
    addFinding(
      findings,
      "freeze-missing-approval",
      "error",
      "Freeze is active but no approved exception is attached.",
      true
    );
  }

  if (
    freezeActive &&
    config.requireExceptionApprovalWhenFrozen &&
    freeze.exceptionApproved &&
    config.requireExceptionTicketWhenFrozen &&
    typeof freeze.exceptionTicketId !== "string"
  ) {
    addFinding(
      findings,
      "freeze-missing-exception-ticket",
      "error",
      "Freeze exception ticket is required when freeze exception is approved.",
      true
    );
  }

  if (
    freezeActive &&
    config.requireExceptionApprovalWhenFrozen &&
    freeze.exceptionApproved &&
    config.requireExceptionExpiryWhenFrozen &&
    typeof freeze.exceptionExpiresAt !== "string"
  ) {
    addFinding(
      findings,
      "freeze-missing-exception-expiry",
      "error",
      "Freeze exception expiry is required when exception approval is used.",
      true
    );
  }

  if (
    freezeActive &&
    config.requireExceptionApprovalWhenFrozen &&
    freeze.exceptionApproved &&
    config.requireExceptionExpiryWhenFrozen &&
    typeof freeze.exceptionExpiresAt === "string" &&
    freeze.exceptionExpiresAt.trim() === ""
  ) {
    addFinding(
      findings,
      "freeze-empty-exception-expiry",
      "error",
      "Freeze exception expiry cannot be empty when required.",
      true
    );
  }

  if (
    freezeActive &&
    config.requireExceptionApprovalWhenFrozen &&
    freeze.exceptionApproved &&
    config.requireExceptionExpiryWhenFrozen &&
    typeof freeze.exceptionExpiresAt === "string" &&
    freeze.exceptionExpiresAt.trim() !== ""
  ) {
    const expiryAt = parseIsoDate(freeze.exceptionExpiresAt);
    if (!expiryAt) {
      addFinding(
        findings,
        "freeze-invalid-exception-expiry",
        "error",
        "Freeze exception expiry must be a valid ISO datetime.",
        true
      );
    } else {
      const evaluationTimeRaw = input.meta?.evaluationTime;
      const evaluationTime = evaluationTimeRaw ? parseIsoDate(evaluationTimeRaw) : new Date();
      if (evaluationTimeRaw && !evaluationTime) {
        addFinding(
          findings,
          "meta-evaluation-time-invalid",
          "error",
          "meta.evaluationTime must be a valid ISO datetime.",
          true
        );
      } else if (evaluationTime && expiryAt.getTime() <= evaluationTime.getTime()) {
        addFinding(
          findings,
          "freeze-expired-exception",
          "error",
          `Freeze exception expired at ${expiryAt.toISOString()}.`,
          true
        );
      }
    }
  }

  if (
    freezeActive &&
    config.requireExceptionApprovalWhenFrozen &&
    freeze.exceptionApproved &&
    config.requireExceptionTicketWhenFrozen &&
    typeof freeze.exceptionTicketId === "string" &&
    freeze.exceptionTicketId.trim() === ""
  ) {
    addFinding(
      findings,
      "freeze-empty-exception-ticket",
      "error",
      "Freeze exception ticket cannot be empty when required.",
      true
    );
  }

  if (freezeActive && config.requireRollbackPlanWhenFrozen && !freeze.rollbackPlanLinked) {
    addFinding(
      findings,
      "freeze-missing-rollback",
      "error",
      "Freeze is active but rollback plan link is missing.",
      true
    );
  }

  if (
    freezeActive &&
    config.requireRollbackPlanWhenFrozen &&
    freeze.rollbackPlanLinked &&
    config.requireRollbackOwnerWhenFrozen &&
    typeof freeze.rollbackOwner !== "string"
  ) {
    addFinding(
      findings,
      "freeze-missing-rollback-owner",
      "error",
      "Freeze rollback owner is required when rollback plan is linked.",
      true
    );
  }

  if (
    freezeActive &&
    config.requireRollbackPlanWhenFrozen &&
    freeze.rollbackPlanLinked &&
    config.requireRollbackOwnerWhenFrozen &&
    typeof freeze.rollbackOwner === "string" &&
    freeze.rollbackOwner.trim() === ""
  ) {
    addFinding(
      findings,
      "freeze-empty-rollback-owner",
      "error",
      "Freeze rollback owner cannot be empty when required.",
      true
    );
  }

  const artifacts = input.artifacts ?? {};
  const missingArtifacts = getMissingArtifacts(config.requiredArtifacts, artifacts.present ?? []);
  if (missingArtifacts.length > 0) {
    addFinding(
      findings,
      "missing-artifacts",
      "error",
      `Required artifacts missing: ${missingArtifacts.join(", ")}.`,
      true
    );
  }

  if (config.requireArtifactHashes) {
    const hashes = artifacts.hashes ?? {};
    const missingHashes = [];
    const invalidHashes = [];
    for (const artifactName of config.requiredArtifacts) {
      const hashValue = hashes[artifactName];
      if (hashValue === undefined || hashValue === null || hashValue === "") {
        missingHashes.push(artifactName);
        continue;
      }
      if (!isSha256(hashValue)) {
        invalidHashes.push(artifactName);
      }
    }

    if (missingHashes.length > 0) {
      addFinding(
        findings,
        "missing-artifact-hashes",
        "error",
        `Required artifact hashes missing: ${missingHashes.join(", ")}.`,
        true
      );
    }

    if (invalidHashes.length > 0) {
      addFinding(
        findings,
        "invalid-artifact-hashes",
        "error",
        `Invalid SHA-256 hashes for artifacts: ${invalidHashes.join(", ")}.`,
        true
      );
    }
  }

  const blocking = findings.filter((item) => item.blocking);
  const warnings = findings.filter((item) => item.severity === "warning");
  const decision = blocking.length === 0 ? "GO" : "NO_GO";

  return {
    decision,
    generatedAt: new Date().toISOString(),
    config,
    input,
    findings,
    summary: {
      totalFindings: findings.length,
      blockingFindings: blocking.length,
      errorFindings: findings.filter((item) => item.severity === "error").length,
      warningFindings: warnings.length,
      freezeActive
    }
  };
}

function parseArgs(argv) {
  const args = {
    input: null,
    config: null,
    output: null,
    format: "json"
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--input") {
      args.input = value;
      i += 1;
    } else if (key === "--config") {
      args.config = value;
      i += 1;
    } else if (key === "--output") {
      args.output = value;
      i += 1;
    } else if (key === "--format") {
      args.format = value;
      i += 1;
    }
  }

  return args;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# Release Gate Result");
  lines.push("");
  lines.push(`- Decision: **${result.decision}**`);
  lines.push(`- Generated at: ${result.generatedAt}`);
  lines.push(`- Blocking findings: ${result.summary.blockingFindings}`);
  lines.push(`- Warning findings: ${result.summary.warningFindings}`);
  lines.push("");
  lines.push("## Findings");
  lines.push("");

  if (result.findings.length === 0) {
    lines.push("- None");
  } else {
    for (const finding of result.findings) {
      lines.push(
        `- [${finding.blocking ? "BLOCK" : "WARN"}] ${finding.id}: ${finding.message}`
      );
    }
  }

  lines.push("");
  lines.push("## Freeze");
  lines.push("");
  lines.push(`- Active: ${result.summary.freezeActive}`);

  return lines.join("\n");
}

function writeOutput(outputPath, content) {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error("Missing required --input <path> argument.");
    process.exit(2);
  }

  const input = readJsonFile(args.input);
  const config = args.config ? readJsonFile(args.config) : {};
  const result = evaluateGate(input, config);

  const json = JSON.stringify(result, null, 2);
  const markdown = renderMarkdown(result);

  if (args.output) {
    if (args.format === "markdown") {
      writeOutput(args.output, markdown);
    } else if (args.format === "both") {
      writeOutput(args.output, json);
      writeOutput(`${args.output}.md`, markdown);
    } else {
      writeOutput(args.output, json);
    }
  }

  if (args.format === "markdown") {
    console.log(markdown);
  } else {
    console.log(json);
    if (args.format === "both") {
      console.log("\n---\n");
      console.log(markdown);
    }
  }

  process.exit(result.decision === "GO" ? 0 : 1);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main();
}

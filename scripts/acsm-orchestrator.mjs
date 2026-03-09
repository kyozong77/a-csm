import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runDeidPipeline } from "./deid-pipeline.mjs";
import { runEventEngine } from "./event-engine-v1.mjs";
import { evaluateVcdInference } from "./vcd-inference.mjs";
import { evaluateLedgerRepeat } from "./ledger-repeat-engine.mjs";
import { evaluateTagEscalation } from "./tag-escalation.mjs";
import { evaluatePsSubFe } from "./ps-sub-fe-core.mjs";
import { validateUsciOutput } from "./schema-invariant-service.mjs";
import { evaluateGate } from "./release-gate.mjs";

const DEFAULT_CONFIG = {
  schemaVersion: "1.0.0",
  deidPolicy: {},
  eventEngine: {},
  vcd: {},
  ledger: {},
  tag: {},
  ps: {},
  schema: {},
  releaseGate: {},
  mappings: {
    axisToLedger: {
      FR: "fact",
      CA: "context",
      SR: "commitment",
      SA: "context"
    },
    axisToTag: {
      FR: "TAG_FCT",
      CA: "TAG_CTX",
      SR: "TAG_SAF",
      SA: "TAG_SYS"
    },
    vcdFamilyToAxis: {
      prompt_injection: "CA",
      boundary: "CA",
      source_spoof: "CA",
      instruction_drift: "CA",
      context_pollution: "CA",
      source_confidence: "CA",
      data_exfil: "SR",
      coercion: "SR"
    },
    vcdStatusAxisFloor: {
      GUARDED: { CA: 2 },
      TRIGGERED: { CA: 3, SR: 2 },
      LOCKDOWN: { CA: 4, SR: 3 }
    },
    severityToAxisScore: {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4
    },
    axisVolumeBonusThreshold: 3
  }
};

const AXES = ["FR", "CA", "SR", "SA"];
const TAG_AXES = ["TAG_FCT", "TAG_CTX", "TAG_SAF", "TAG_SYS"];
const SEVERITY_ORDER = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addFinding(findings, id, severity, message, blocking) {
  findings.push({ id, severity, message, blocking: Boolean(blocking) });
}

function addTrace(trace, step, message, data = null) {
  trace.push({
    step,
    message,
    ...(data === null ? {} : { data })
  });
}

function normalizeSourceTrust(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["trusted", "unknown", "untrusted"].includes(normalized)) {
    return normalized;
  }
  return "unknown";
}

function normalizeTurns(rawInput, findings) {
  if (!isObject(rawInput)) {
    addFinding(findings, "input-invalid", "error", "Input must be an object.", true);
    return [];
  }

  if (Array.isArray(rawInput.turns)) {
    const turns = [];
    for (let index = 0; index < rawInput.turns.length; index += 1) {
      const turn = rawInput.turns[index];
      if (!isObject(turn)) {
        addFinding(findings, "input-turn-invalid", "error", `Turn at index ${index} must be an object.`, true);
        continue;
      }
      if (typeof turn.text !== "string") {
        addFinding(findings, "input-turn-text-invalid", "error", `Turn at index ${index} requires string 'text'.`, true);
        continue;
      }
      const id = typeof turn.id === "string" && turn.id.trim() ? turn.id.trim() : `T${index + 1}`;
      const role = typeof turn.role === "string" && turn.role.trim() ? turn.role.trim() : "user";
      turns.push({
        id,
        role,
        text: turn.text,
        sourceTrust: normalizeSourceTrust(turn.sourceTrust),
        boundaryBypass: Boolean(turn.boundaryBypass)
      });
    }
    return turns;
  }

  if (typeof rawInput.text === "string") {
    return [
      {
        id: "T1",
        role: typeof rawInput.role === "string" && rawInput.role.trim() ? rawInput.role.trim() : "user",
        text: rawInput.text,
        sourceTrust: normalizeSourceTrust(rawInput.sourceTrust),
        boundaryBypass: Boolean(rawInput.boundaryBypass)
      }
    ];
  }

  addFinding(
    findings,
    "input-text-or-turns-required",
    "error",
    "Input must include either 'text' or 'turns'.",
    true
  );
  return [];
}

function normalizeConfig(rawConfig, findings) {
  if (rawConfig === undefined || rawConfig === null) {
    return clone(DEFAULT_CONFIG);
  }

  if (!isObject(rawConfig)) {
    addFinding(findings, "config-invalid", "error", "Config must be an object.", true);
    return clone(DEFAULT_CONFIG);
  }

  const merged = {
    ...clone(DEFAULT_CONFIG),
    ...clone(rawConfig)
  };

  merged.mappings = {
    ...clone(DEFAULT_CONFIG.mappings),
    ...(isObject(rawConfig.mappings) ? clone(rawConfig.mappings) : {})
  };

  merged.mappings.axisToLedger = {
    ...DEFAULT_CONFIG.mappings.axisToLedger,
    ...(isObject(rawConfig?.mappings?.axisToLedger) ? rawConfig.mappings.axisToLedger : {})
  };

  merged.mappings.axisToTag = {
    ...DEFAULT_CONFIG.mappings.axisToTag,
    ...(isObject(rawConfig?.mappings?.axisToTag) ? rawConfig.mappings.axisToTag : {})
  };

  merged.mappings.vcdFamilyToAxis = {
    ...DEFAULT_CONFIG.mappings.vcdFamilyToAxis,
    ...(isObject(rawConfig?.mappings?.vcdFamilyToAxis) ? rawConfig.mappings.vcdFamilyToAxis : {})
  };

  merged.mappings.vcdStatusAxisFloor = {
    ...DEFAULT_CONFIG.mappings.vcdStatusAxisFloor,
    ...(isObject(rawConfig?.mappings?.vcdStatusAxisFloor) ? rawConfig.mappings.vcdStatusAxisFloor : {})
  };

  merged.mappings.severityToAxisScore = {
    ...DEFAULT_CONFIG.mappings.severityToAxisScore,
    ...(isObject(rawConfig?.mappings?.severityToAxisScore) ? rawConfig.mappings.severityToAxisScore : {})
  };

  if (typeof merged.schemaVersion !== "string" || !merged.schemaVersion.trim()) {
    addFinding(findings, "config-schemaVersion-invalid", "error", "Config 'schemaVersion' must be a non-empty string.", true);
    merged.schemaVersion = DEFAULT_CONFIG.schemaVersion;
  } else {
    merged.schemaVersion = merged.schemaVersion.trim();
  }

  const volumeThreshold = Number(merged.mappings.axisVolumeBonusThreshold);
  if (!Number.isInteger(volumeThreshold) || volumeThreshold < 1) {
    addFinding(
      findings,
      "config-mappings-axisVolumeBonusThreshold-invalid",
      "error",
      "Config 'mappings.axisVolumeBonusThreshold' must be an integer >= 1.",
      true
    );
    merged.mappings.axisVolumeBonusThreshold = DEFAULT_CONFIG.mappings.axisVolumeBonusThreshold;
  }

  return merged;
}

function resolveTurnIndex(turnId, rawTurnIndex, turnIndexById) {
  if (typeof turnId === "string" && turnIndexById.has(turnId)) {
    return turnIndexById.get(turnId);
  }

  if (Number.isInteger(rawTurnIndex) && rawTurnIndex >= 0) {
    return rawTurnIndex > 0 ? rawTurnIndex - 1 : rawTurnIndex;
  }

  return 0;
}

function mapEventEngineEventsToUnified(events, turnIndexById) {
  return events.map((event) => ({
    eventId: event.eventId,
    source: "event-engine",
    axis: event.axis,
    severity: event.severity,
    turnId: event.turnId,
    turnIndex: resolveTurnIndex(event.turnId, event.turnIndex, turnIndexById),
    ruleId: event.ruleId,
    summary: typeof event.excerpt === "string" && event.excerpt.trim() ? event.excerpt.trim() : `${event.ruleId} triggered.`
  }));
}

function mapVcdEventsToUnified(events, config, findings, turnIndexById) {
  const unified = [];

  for (const event of events) {
    const family = typeof event.family === "string" ? event.family : "source_confidence";
    const mappedAxis = config.mappings.vcdFamilyToAxis[family];
    const axis = AXES.includes(mappedAxis) ? mappedAxis : "CA";

    if (!AXES.includes(mappedAxis)) {
      addFinding(
        findings,
        "mapping-vcd-family-axis-fallback",
        "warning",
        `No axis mapping for VCD family '${family}', fallback to CA.`,
        false
      );
    }

    const turnId = typeof event.turn_id === "string" ? event.turn_id : null;
    unified.push({
      eventId: typeof event.event_id === "string" ? event.event_id : `VCD-${unified.length + 1}`,
      source: "vcd",
      axis,
      severity: typeof event.severity === "string" ? event.severity : "low",
      turnId,
      turnIndex: resolveTurnIndex(turnId, event.turn_index, turnIndexById),
      ruleId: typeof event.rule_id === "string" ? event.rule_id : null,
      summary: typeof event.excerpt === "string" && event.excerpt.trim() ? event.excerpt.trim() : `${event.rule_id ?? "VCD"} triggered.`
    });
  }

  return unified;
}

function buildLedgerEvents(unifiedEvents, axisToLedger) {
  return unifiedEvents.map((event) => {
    const ledgerType = axisToLedger[event.axis] ?? "context";
    const sourceTag = event.source === "event-engine" ? "ee" : "vcd";
    const ruleTag = (event.ruleId ?? event.axis).toLowerCase();

    return {
      eventId: event.eventId,
      ledgerType,
      entryKey: `${sourceTag}:${ruleTag}`,
      turn_index: event.turnIndex,
      turn_range: [event.turnIndex, event.turnIndex],
      payload: {
        source: event.source,
        axis: event.axis,
        severity: event.severity,
        ruleId: event.ruleId,
        turnId: event.turnId
      },
      note: event.summary
    };
  });
}

function buildTagInput(unifiedEvents, axisToTag, previousState) {
  const buckets = new Map();

  for (const event of unifiedEvents) {
    const axis = axisToTag[event.axis] ?? "TAG_CTX";
    const key = `${axis}|${event.severity}`;
    const current = buckets.get(key) ?? {
      axis,
      severity: event.severity,
      count: 0,
      reason: "derived risk signal"
    };
    current.count += 1;
    buckets.set(key, current);
  }

  const events = [...buckets.values()].sort((a, b) => {
    if (a.axis !== b.axis) {
      return a.axis.localeCompare(b.axis);
    }
    return (SEVERITY_ORDER[a.severity] ?? 0) - (SEVERITY_ORDER[b.severity] ?? 0);
  });

  return {
    events,
    ...(isObject(previousState) ? { previousState } : {})
  };
}

function collectEscalatedByAxis(ledger, eventAxisById) {
  const counts = {
    FR: 0,
    CA: 0,
    SR: 0,
    SA: 0
  };

  for (const ledgerType of ["fact", "commitment", "context"]) {
    const rows = Array.isArray(ledger?.[ledgerType]) ? ledger[ledgerType] : [];
    for (const row of rows) {
      if (row.status !== "ESCALATED") {
        continue;
      }
      const axis = eventAxisById.get(row.eventId);
      if (AXES.includes(axis)) {
        counts[axis] += 1;
      }
    }
  }

  return counts;
}

function deriveAxisScores(unifiedEvents, vcdStatus, escalatedByAxis, config) {
  const severityToScore = config.mappings.severityToAxisScore;
  const axisScores = {
    FR: 0,
    CA: 0,
    SR: 0,
    SA: 0
  };
  const axisCounts = {
    FR: 0,
    CA: 0,
    SR: 0,
    SA: 0
  };

  for (const event of unifiedEvents) {
    if (!AXES.includes(event.axis)) {
      continue;
    }
    const score = Number(severityToScore[event.severity] ?? 0);
    if (score > axisScores[event.axis]) {
      axisScores[event.axis] = Math.min(4, score);
    }
    axisCounts[event.axis] += 1;
  }

  for (const axis of AXES) {
    if (axisCounts[axis] >= config.mappings.axisVolumeBonusThreshold && axisScores[axis] > 0) {
      axisScores[axis] = Math.min(4, axisScores[axis] + 1);
    }
  }

  const statusFloor = isObject(config.mappings.vcdStatusAxisFloor[vcdStatus])
    ? config.mappings.vcdStatusAxisFloor[vcdStatus]
    : null;
  if (statusFloor) {
    for (const [axis, floorScore] of Object.entries(statusFloor)) {
      if (!AXES.includes(axis)) {
        continue;
      }
      axisScores[axis] = Math.max(axisScores[axis], Number(floorScore) || 0);
      axisScores[axis] = Math.min(4, axisScores[axis]);
    }
  }

  for (const axis of AXES) {
    if ((escalatedByAxis[axis] ?? 0) > 0 && axisScores[axis] > 0) {
      axisScores[axis] = Math.min(4, axisScores[axis] + 1);
    }
  }

  return {
    axisScores,
    axisCounts
  };
}

function deriveEvidence(unifiedEvents) {
  return unifiedEvents
    .slice()
    .sort((a, b) => {
      const aRank = SEVERITY_ORDER[a.severity] ?? 0;
      const bRank = SEVERITY_ORDER[b.severity] ?? 0;
      if (aRank !== bRank) {
        return bRank - aRank;
      }
      if (a.turnIndex !== b.turnIndex) {
        return a.turnIndex - b.turnIndex;
      }
      return String(a.eventId).localeCompare(String(b.eventId));
    })
    .map((event) => ({
      axis: event.axis,
      turnId: event.turnId,
      summary: String(event.summary ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200)
    }))
    .filter((item) => item.summary.length > 0);
}

function toSchemaEventLog(unifiedEvents) {
  return unifiedEvents
    .slice()
    .sort((a, b) => {
      if (a.turnIndex !== b.turnIndex) {
        return a.turnIndex - b.turnIndex;
      }
      return String(a.eventId).localeCompare(String(b.eventId));
    })
    .map((event) => ({
      eventId: event.eventId,
      axis: event.axis,
      severity: event.severity,
      turn_index: event.turnIndex
    }));
}

function computeStabilityIndex(ledgerSummary, tagSummary) {
  const totalEvents = Number(ledgerSummary?.totalEvents) || 0;
  const resolvedRows = Number(ledgerSummary?.resolvedRows) || 0;
  const escalatedRows = Number(ledgerSummary?.escalatedRows) || 0;
  const nextStableRounds = Number(tagSummary?.nextStableRounds) || 0;

  if (totalEvents === 0) {
    return 1.0;
  }

  const resolvedRatio = resolvedRows / totalEvents;
  const escalatedRatio = escalatedRows / totalEvents;
  const stableBonus = Math.min(nextStableRounds / 3, 1) * 0.2;

  const raw = resolvedRatio * 0.4 + (1 - escalatedRatio) * 0.4 + stableBonus;
  return Math.round(Math.min(1, Math.max(0, raw)) * 1000) / 1000;
}

function computeConfidenceInterval(vcdSummary, unifiedEventCount, schemaSummary) {
  const riskScore = Number(vcdSummary?.riskScore) || 0;
  const triggerCount = Number(vcdSummary?.triggerCount) || 0;
  const schemaDecision = schemaSummary?.decision;

  const riskPenalty = Math.min(riskScore / 10, 1) * 0.5;
  const coverageFactor = triggerCount > 0 || unifiedEventCount > 0 ? 0.3 : 0;
  const schemaBonus = schemaDecision === "PASS" ? 0.2 : 0;

  const raw = 1 - riskPenalty + coverageFactor + schemaBonus;
  return Math.round(Math.min(1, Math.max(0, raw)) * 1000) / 1000;
}

function computeRiskStatus(psState, vcdStatus, tagLevel) {
  const riskSignals = [];

  if (psState === "ST_ALM") {
    riskSignals.push(4);
  } else if (psState === "ST_DEV") {
    riskSignals.push(2);
  } else {
    riskSignals.push(0);
  }

  const vcdMap = { LOCKDOWN: 4, TRIGGERED: 3, GUARDED: 1, CLEAR: 0 };
  riskSignals.push(vcdMap[vcdStatus] ?? 0);

  const tagMap = { HIGH: 4, DEVIATE: 3, MEDIUM: 2, LOW: 0 };
  riskSignals.push(tagMap[tagLevel] ?? 0);

  const maxSignal = Math.max(...riskSignals);

  if (maxSignal >= 4) {
    return "CRITICAL";
  }
  if (maxSignal >= 3) {
    return "HIGH";
  }
  if (maxSignal >= 2) {
    return "MEDIUM";
  }
  if (maxSignal >= 1) {
    return "LOW";
  }
  return "CLEAR";
}

function mergeReleaseGateInput(defaultInput, overrideInput) {
  if (!isObject(overrideInput)) {
    return defaultInput;
  }

  return {
    ...defaultInput,
    ...overrideInput,
    checks: {
      ...defaultInput.checks,
      ...(isObject(overrideInput.checks) ? overrideInput.checks : {})
    },
    metrics: {
      ...defaultInput.metrics,
      ...(isObject(overrideInput.metrics) ? overrideInput.metrics : {})
    },
    approvals: {
      ...defaultInput.approvals,
      ...(isObject(overrideInput.approvals) ? overrideInput.approvals : {})
    },
    freeze: {
      ...defaultInput.freeze,
      ...(isObject(overrideInput.freeze) ? overrideInput.freeze : {})
    },
    artifacts: {
      ...defaultInput.artifacts,
      ...(isObject(overrideInput.artifacts) ? overrideInput.artifacts : {})
    },
    meta: {
      ...defaultInput.meta,
      ...(isObject(overrideInput.meta) ? overrideInput.meta : {})
    }
  };
}

function countBlockingFromSummary(result) {
  const count = Number(result?.summary?.blockingFindings);
  if (Number.isInteger(count) && count >= 0) {
    return count;
  }
  return 0;
}

const RISK_RANK = { CLEAR: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

function validateReportConsistency(report) {
  const violations = [];

  const s = report.summary;
  const steps = report.steps;

  if (s.blockingFindings > 0 && report.decision !== "NO_GO") {
    violations.push({
      rule: "blocking-implies-no-go",
      message: "blockingFindings > 0 but decision is not NO_GO.",
      severity: "error"
    });
  }

  if (s.releaseGateDecision === "NO_GO" && report.decision !== "NO_GO") {
    violations.push({
      rule: "gate-no-go-implies-decision-no-go",
      message: "releaseGateDecision is NO_GO but decision is not NO_GO.",
      severity: "error"
    });
  }

  if (s.riskStatus === "CRITICAL" && report.decision !== "NO_GO") {
    violations.push({
      rule: "critical-risk-implies-no-go",
      message: "riskStatus is CRITICAL but decision is not NO_GO.",
      severity: "warning"
    });
  }

  if (steps?.ps?.ps === "ST_ALM" && steps?.ps?.f?.triggered !== true && report.derived?.schemaInput?.f !== true) {
    violations.push({
      rule: "alarm-requires-flag",
      message: "PS is ST_ALM but flag (f) is not triggered.",
      severity: "error"
    });
  }

  if (s.vcdStatus === "LOCKDOWN" && (RISK_RANK[s.riskStatus] ?? 0) < RISK_RANK.HIGH) {
    violations.push({
      rule: "lockdown-implies-high-risk",
      message: "VCD status is LOCKDOWN but riskStatus is below HIGH.",
      severity: "error"
    });
  }

  if (s.vcdStatus === "TRIGGERED" && (RISK_RANK[s.riskStatus] ?? 0) < RISK_RANK.HIGH) {
    violations.push({
      rule: "triggered-implies-high-risk",
      message: "VCD status is TRIGGERED but riskStatus is below HIGH.",
      severity: "error"
    });
  }

  if (s.tagDecisionLevel === "HIGH" && (RISK_RANK[s.riskStatus] ?? 0) < RISK_RANK.HIGH) {
    violations.push({
      rule: "tag-high-implies-high-risk",
      message: "TAG level is HIGH but riskStatus is below HIGH.",
      severity: "error"
    });
  }

  if (typeof s.stabilityIndex !== "number" || s.stabilityIndex < 0 || s.stabilityIndex > 1) {
    violations.push({
      rule: "stability-index-range",
      message: "stabilityIndex must be a number between 0 and 1.",
      severity: "error"
    });
  }

  if (typeof s.confidenceInterval !== "number" || s.confidenceInterval < 0 || s.confidenceInterval > 1) {
    violations.push({
      rule: "confidence-interval-range",
      message: "confidenceInterval must be a number between 0 and 1.",
      severity: "error"
    });
  }

  if (!["CRITICAL", "HIGH", "MEDIUM", "LOW", "CLEAR"].includes(s.riskStatus)) {
    violations.push({
      rule: "risk-status-enum",
      message: "riskStatus must be one of CRITICAL, HIGH, MEDIUM, LOW, CLEAR.",
      severity: "error"
    });
  }

  if (s.schemaDecision === "FAIL" && s.stageBlockingBeforeGate === 0) {
    violations.push({
      rule: "schema-fail-implies-stage-blocking",
      message: "Schema decision is FAIL but stageBlockingBeforeGate is 0.",
      severity: "warning"
    });
  }

  if (report.decision === "GO" && s.stageBlockingBeforeGate > 0) {
    violations.push({
      rule: "stage-blocking-implies-no-go",
      message: "stageBlockingBeforeGate > 0 but decision is GO.",
      severity: "error"
    });
  }

  const errorViolations = violations.filter((v) => v.severity === "error");
  return {
    consistent: errorViolations.length === 0,
    violationCount: violations.length,
    violations
  };
}

export { computeStabilityIndex, computeConfidenceInterval, computeRiskStatus, validateReportConsistency };

export function runAcsmOrchestrator(rawInput = {}, rawConfig = {}) {
  const findings = [];
  const trace = [];

  const config = normalizeConfig(rawConfig, findings);
  const turns = normalizeTurns(rawInput, findings);

  addTrace(trace, "input", "Normalized orchestrator input and config.", {
    turnCount: turns.length,
    blockingFindings: findings.filter((item) => item.blocking).length
  });

  const deidResult = runDeidPipeline(
    {
      turns: turns.map((turn) => ({
        id: turn.id,
        role: turn.role,
        text: turn.text
      }))
    },
    config.deidPolicy
  );

  const redactedTurnsById = new Map(
    (deidResult.redactedTurns ?? []).map((turn) => [
      turn.id,
      {
        text: turn.text,
        role: turn.role
      }
    ])
  );

  const sanitizedTurns = turns.map((turn, index) => {
    const redacted = redactedTurnsById.get(turn.id);
    const fallback = deidResult.redactedTurns?.[index];
    return {
      id: turn.id,
      role: redacted?.role ?? fallback?.role ?? turn.role,
      text: redacted?.text ?? fallback?.text ?? turn.text,
      sourceTrust: turn.sourceTrust,
      boundaryBypass: turn.boundaryBypass
    };
  });

  addTrace(trace, "deid", "Completed de-identification stage.", {
    replacements: deidResult.summary.totalReplacements,
    blockingFindings: countBlockingFromSummary(deidResult)
  });

  const eventResult = runEventEngine(
    {
      turns: sanitizedTurns.map((turn) => ({
        id: turn.id,
        role: turn.role,
        text: turn.text
      }))
    },
    config.eventEngine
  );

  const vcdResult = evaluateVcdInference(
    {
      turns: sanitizedTurns.map((turn) => ({
        id: turn.id,
        role: turn.role,
        text: turn.text,
        sourceTrust: turn.sourceTrust,
        boundaryBypass: turn.boundaryBypass
      }))
    },
    config.vcd
  );

  const turnIndexById = new Map(sanitizedTurns.map((turn, index) => [turn.id, index]));

  const unifiedEvents = [
    ...mapEventEngineEventsToUnified(eventResult.events, turnIndexById),
    ...mapVcdEventsToUnified(vcdResult.events, config, findings, turnIndexById)
  ];

  const eventAxisById = new Map(unifiedEvents.map((event) => [event.eventId, event.axis]));

  addTrace(trace, "risk-events", "Merged Event Engine and VCD events.", {
    eventEngineEvents: eventResult.events.length,
    vcdEvents: vcdResult.events.length,
    unifiedEvents: unifiedEvents.length
  });

  const ledgerInput = {
    events: buildLedgerEvents(unifiedEvents, config.mappings.axisToLedger)
  };
  const ledgerResult = evaluateLedgerRepeat(ledgerInput, config.ledger);

  const tagInput = buildTagInput(unifiedEvents, config.mappings.axisToTag, rawInput.previousTagState);
  const tagResult = evaluateTagEscalation(tagInput, config.tag);

  const escalatedByAxis = collectEscalatedByAxis(ledgerResult.ledger, eventAxisById);
  const { axisScores, axisCounts } = deriveAxisScores(
    unifiedEvents,
    vcdResult.summary.status,
    escalatedByAxis,
    config
  );

  const evidence = deriveEvidence(unifiedEvents);
  const psResult = evaluatePsSubFe(
    {
      axisScores,
      evidence
    },
    config.ps
  );

  const schemaInput = {
    schemaVersion: config.schemaVersion,
    ps: psResult.ps,
    sub: psResult.sub,
    f: Boolean(psResult.f?.triggered),
    e: psResult.e,
    vcd: {
      level: vcdResult.summary.level,
      status: vcdResult.summary.status,
      trace: Array.isArray(vcdResult.trace) ? vcdResult.trace : []
    },
    event_log: toSchemaEventLog(unifiedEvents)
  };

  const schemaResult = validateUsciOutput(schemaInput, config.schema);

  const severityCounts = {
    critical: unifiedEvents.filter((item) => item.severity === "critical").length,
    high: unifiedEvents.filter((item) => item.severity === "high").length
  };

  const stageBlockingBeforeGate =
    countBlockingFromSummary(deidResult) +
    countBlockingFromSummary(eventResult) +
    countBlockingFromSummary(vcdResult) +
    countBlockingFromSummary(ledgerResult) +
    countBlockingFromSummary(tagResult) +
    countBlockingFromSummary(psResult) +
    Number(schemaResult.summary?.blockingFindings ?? 0);

  const requiredChecks = Array.isArray(config.releaseGate?.requiredChecks)
    ? config.releaseGate.requiredChecks
    : ["tests", "lint", "build"];

  const defaultChecks = Object.fromEntries(requiredChecks.map((name) => [name, "pass"]));
  if (Object.prototype.hasOwnProperty.call(defaultChecks, "tests")) {
    defaultChecks.tests = stageBlockingBeforeGate > 0 ? "fail" : "pass";
  }

  const defaultReleaseGateInput = {
    checks: defaultChecks,
    metrics: {
      criticalOpen: severityCounts.critical,
      highOpen: severityCounts.high,
      regressionFailures: schemaResult.summary?.decision === "PASS" ? 0 : 1,
      openIncidents:
        (vcdResult.summary.status === "TRIGGERED" || vcdResult.summary.status === "LOCKDOWN" ? 1 : 0) +
        (ledgerResult.summary.escalatedRows ?? 0)
    },
    approvals: {
      totalApprovals: 0
    },
    freeze: {
      active: false,
      exceptionApproved: false,
      rollbackPlanLinked: false
    },
    artifacts: {
      present: Array.isArray(config.releaseGate?.requiredArtifacts)
        ? config.releaseGate.requiredArtifacts
        : []
    },
    meta: {}
  };

  const releaseGateInput = mergeReleaseGateInput(defaultReleaseGateInput, rawInput.releaseGate);
  const releaseGateResult = evaluateGate(releaseGateInput, config.releaseGate);

  addTrace(trace, "decision", "Computed release decision from staged signals.", {
    stageBlockingBeforeGate,
    releaseGateDecision: releaseGateResult.decision,
    releaseGateBlockingFindings: releaseGateResult.summary.blockingFindings
  });

  const blockingFindings =
    stageBlockingBeforeGate +
    Number(releaseGateResult.summary?.blockingFindings ?? 0) +
    findings.filter((item) => item.blocking).length;

  const decision = releaseGateResult.decision === "GO" && blockingFindings === 0 ? "GO" : "NO_GO";

  const stabilityIndex = computeStabilityIndex(ledgerResult.summary, tagResult.summary);
  const confidenceInterval = computeConfidenceInterval(vcdResult.summary, unifiedEvents.length, schemaResult.summary);
  const riskStatus = computeRiskStatus(psResult.ps, vcdResult.summary.status, tagResult.decisionLevel);

  return {
    generatedAt: new Date().toISOString(),
    decision,
    summary: {
      turnCount: sanitizedTurns.length,
      unifiedEventCount: unifiedEvents.length,
      stageBlockingBeforeGate,
      releaseGateDecision: releaseGateResult.decision,
      schemaDecision: schemaResult.summary?.decision,
      tagDecisionLevel: tagResult.decisionLevel,
      vcdStatus: vcdResult.summary.status,
      blockingFindings,
      stabilityIndex,
      confidenceInterval,
      riskStatus
    },
    findings,
    trace,
    derived: {
      sanitizedTurns,
      unifiedEvents,
      axisScores,
      axisCounts,
      escalatedByAxis,
      evidence,
      schemaInput,
      releaseGateInput
    },
    steps: {
      deid: deidResult,
      eventEngine: eventResult,
      vcd: vcdResult,
      ledger: ledgerResult,
      tag: tagResult,
      ps: psResult,
      schema: schemaResult,
      releaseGate: releaseGateResult
    },
    config
  };
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# A-CSM Orchestrator Result");
  lines.push("");
  lines.push(`- Decision: **${result.decision}**`);
  lines.push(`- Generated at: ${result.generatedAt}`);
  lines.push(`- Turns: ${result.summary.turnCount}`);
  lines.push(`- Unified events: ${result.summary.unifiedEventCount}`);
  lines.push(`- VCD status: ${result.summary.vcdStatus}`);
  lines.push(`- TAG level: ${result.summary.tagDecisionLevel}`);
  lines.push(`- PS/SUB: ${result.steps.ps.ps} / ${result.steps.ps.sub}`);
  lines.push(`- Schema decision: ${result.summary.schemaDecision}`);
  lines.push(`- Release gate: ${result.summary.releaseGateDecision}`);
  lines.push(`- Blocking findings: ${result.summary.blockingFindings}`);
  lines.push("");
  lines.push("## Axis Scores");
  lines.push("");
  for (const axis of AXES) {
    lines.push(`- ${axis}: ${result.derived.axisScores[axis]}`);
  }
  lines.push("");
  lines.push("## Stage Blocking Findings");
  lines.push("");
  lines.push(`- deid: ${result.steps.deid.summary.blockingFindings}`);
  lines.push(`- eventEngine: ${result.steps.eventEngine.summary.blockingFindings}`);
  lines.push(`- vcd: ${result.steps.vcd.summary.blockingFindings}`);
  lines.push(`- ledger: ${result.steps.ledger.summary.blockingFindings}`);
  lines.push(`- tag: ${result.steps.tag.summary.blockingFindings}`);
  lines.push(`- ps: ${result.steps.ps.summary.blockingFindings}`);
  lines.push(`- schema: ${result.steps.schema.summary.blockingFindings}`);
  lines.push(`- releaseGate: ${result.steps.releaseGate.summary.blockingFindings}`);
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (result.findings.length === 0) {
    lines.push("- None");
  } else {
    for (const finding of result.findings) {
      lines.push(`- [${finding.blocking ? "BLOCK" : "WARN"}] ${finding.id}: ${finding.message}`);
    }
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = {
    input: null,
    config: null,
    output: null,
    format: "json"
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key === "--input") {
      args.input = value;
      index += 1;
      continue;
    }
    if (key === "--config") {
      args.config = value;
      index += 1;
      continue;
    }
    if (key === "--output") {
      args.output = value;
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

function writeOutput(outputPath, content) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
}

function runCli() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error("Missing required --input <path> argument.");
    process.exit(2);
  }

  const input = readJsonFile(args.input);
  const config = args.config ? readJsonFile(args.config) : {};
  const result = runAcsmOrchestrator(input, config);

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
  runCli();
}

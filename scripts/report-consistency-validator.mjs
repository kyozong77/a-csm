function freeze(value) {
  return Object.freeze(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function countOwnKeys(value) {
  if (!isPlainObject(value)) {
    return 0;
  }
  return Object.keys(value).length;
}

function getRuleVersionField(ruleVersion, primaryKey, legacyKey) {
  if (!isPlainObject(ruleVersion)) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(ruleVersion, primaryKey)) {
    return ruleVersion[primaryKey];
  }
  if (legacyKey && Object.prototype.hasOwnProperty.call(ruleVersion, legacyKey)) {
    return ruleVersion[legacyKey];
  }
  return undefined;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

export const REPORT_STATUS_ORDER = freeze({
  Normal: 0,
  Observe: 1,
  Deviate: 2,
  Alert: 3
});

export const REPORT_STATUS_VALUES = freeze(Object.keys(REPORT_STATUS_ORDER));

/**
 * Validates internal consistency of canonical A-CSM report fields.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validateReportConsistency(report) {
  const errors = [];

  if (!isPlainObject(report)) {
    return {
      valid: false,
      errors: ["report must be an object"]
    };
  }

  const riskStatus = report.risk_status;
  const peakStatus = report.peak_status;
  const stabilityIndex = report.stability_index;
  const confidenceInterval = report.confidence_interval;
  const evidenceList = report.evidence_list;
  const falsePositiveWarnings = report.false_positive_warnings;
  const humanReviewNote = report.human_review_note;
  const digitalFingerprint = report.digital_fingerprint;
  const ruleVersion = report.rule_version;
  const eventEvidenceMap = report.event_evidence_map;

  const riskRank = REPORT_STATUS_ORDER[riskStatus];
  const peakRank = REPORT_STATUS_ORDER[peakStatus];

  if (peakRank < riskRank) {
    errors.push(`peak_status (${peakStatus}) must be >= risk_status (${riskStatus})`);
  }

  if (!Number.isInteger(stabilityIndex) || stabilityIndex < 0 || stabilityIndex > 100) {
    errors.push("stability_index must be an integer between 0 and 100");
  }

  if (!Object.prototype.hasOwnProperty.call(REPORT_STATUS_ORDER, riskStatus)) {
    errors.push(`risk_status (${riskStatus}) must be one of ${REPORT_STATUS_VALUES.join(", ")}`);
  }

  if (!Object.prototype.hasOwnProperty.call(REPORT_STATUS_ORDER, peakStatus)) {
    errors.push(`peak_status (${peakStatus}) must be one of ${REPORT_STATUS_VALUES.join(", ")}`);
  }

  if (!isPlainObject(confidenceInterval) || !(confidenceInterval.lower <= confidenceInterval.upper)) {
    errors.push("confidence_interval.lower must be <= confidence_interval.upper");
  }

  if (!isPlainObject(confidenceInterval) || typeof confidenceInterval.lower !== "number" || confidenceInterval.lower < 0) {
    errors.push("confidence_interval.lower must be a number >= 0");
  }

  if (!isPlainObject(confidenceInterval) || typeof confidenceInterval.upper !== "number" || confidenceInterval.upper > 4) {
    errors.push("confidence_interval.upper must be a number <= 4");
  }

  if (!isPlainObject(confidenceInterval) || confidenceInterval.unit !== "risk_score_0_to_4") {
    errors.push('confidence_interval.unit must equal "risk_score_0_to_4"');
  }

  if (!Array.isArray(evidenceList)) {
    errors.push("evidence_list must be an array");
  }

  if (!Array.isArray(falsePositiveWarnings)) {
    errors.push("false_positive_warnings must be an array");
  }

  if (typeof humanReviewNote !== "string" || !humanReviewNote.includes("人類專業者")) {
    errors.push('human_review_note must contain "人類專業者"');
  }

  if (typeof digitalFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(digitalFingerprint)) {
    errors.push("digital_fingerprint must be a 64-character lowercase hex string");
  }

  const schemaVersion = getRuleVersionField(ruleVersion, "schema", "schemaVersion");
  const eventEngineRules = getRuleVersionField(ruleVersion, "event_engine_rules", "eventEngineRules");
  const vcdRules = getRuleVersionField(ruleVersion, "vcd_matrix_rules", "vcdRules");
  if (
    typeof schemaVersion !== "string" ||
    !schemaVersion.trim() ||
    !isNonNegativeInteger(Number(eventEngineRules)) ||
    !isNonNegativeInteger(Number(vcdRules))
  ) {
    errors.push("rule_version must include schema + event engine rule count + vcd rule count");
  }

  if (!isPlainObject(eventEvidenceMap)) {
    errors.push("event_evidence_map must be an object");
  }

  if (Array.isArray(evidenceList) && riskStatus === "Normal" && evidenceList.length > 1) {
    errors.push("risk_status Normal must not include more than minimal evidence");
  }

  if (riskStatus === "Alert" && Number.isInteger(stabilityIndex) && stabilityIndex >= 70) {
    errors.push("risk_status Alert requires stability_index < 70");
  }

  if (Array.isArray(evidenceList) && evidenceList.length > 0 && riskStatus === "Normal") {
    errors.push("evidence_list cannot be non-empty when risk_status is Normal");
  }

  if (Array.isArray(evidenceList) && isPlainObject(eventEvidenceMap) && evidenceList.length !== countOwnKeys(eventEvidenceMap)) {
    errors.push("evidence_list count must match event_evidence_map entry count");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

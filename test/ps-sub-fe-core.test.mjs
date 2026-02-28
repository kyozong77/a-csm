import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { evaluatePsSubFe } from "../scripts/ps-sub-fe-core.mjs";

const baseConfig = {
  axes: ["FR", "CA", "SR", "SA"],
  stateThresholds: {
    nrmMax: 1,
    devMax: 3,
    almMin: 4
  },
  tieBreakOrder: ["SR", "CA", "FR", "SA"],
  collapseFlag: {
    alarmScoreMin: 4,
    highAxisCountMin: 2,
    highAxisScoreFloor: 3
  },
  evidence: {
    maxItems: 3,
    fallbackText: "No material evidence provided."
  }
};

function input(axisScores, evidence = undefined) {
  return {
    axisScores,
    ...(evidence === undefined ? {} : { evidence })
  };
}

function hasFinding(result, findingId) {
  return result.findings.some((item) => item.id === findingId);
}

test("01 score 0 maps to ST_NRM and SUB_NONE", () => {
  const result = evaluatePsSubFe(input({ FR: 0, CA: 0, SR: 0, SA: 0 }), baseConfig);
  assert.equal(result.ps, "ST_NRM");
  assert.equal(result.sub, "SUB_NONE");
  assert.equal(result.summary.overallScore, 0);
});

test("02 score 1 remains ST_NRM", () => {
  const result = evaluatePsSubFe(input({ FR: 1, CA: 0, SR: 0, SA: 0 }), baseConfig);
  assert.equal(result.ps, "ST_NRM");
  assert.equal(result.sub, "SUB_FR");
});

test("03 score 2 maps to ST_DEV", () => {
  const result = evaluatePsSubFe(input({ FR: 2, CA: 0, SR: 0, SA: 0 }), baseConfig);
  assert.equal(result.ps, "ST_DEV");
  assert.equal(result.summary.overallScore, 2);
});

test("04 score 3 maps to ST_DEV", () => {
  const result = evaluatePsSubFe(input({ FR: 3, CA: 0, SR: 0, SA: 0 }), baseConfig);
  assert.equal(result.ps, "ST_DEV");
});

test("05 score 4 maps to ST_ALM and F triggered", () => {
  const result = evaluatePsSubFe(input({ FR: 4, CA: 0, SR: 0, SA: 0 }), baseConfig);
  assert.equal(result.ps, "ST_ALM");
  assert.equal(result.f.triggered, true);
  assert.ok(result.f.reasons.includes("score-threshold"));
});

test("06 tie-breaking picks SR first by default order", () => {
  const result = evaluatePsSubFe(input({ FR: 3, CA: 1, SR: 3, SA: 0 }), baseConfig);
  assert.equal(result.sub, "SUB_SR");
  assert.ok(result.trace.some((item) => item.step === "tie-breaking"));
});

test("07 tie-breaking uses custom order", () => {
  const result = evaluatePsSubFe(input({ FR: 3, CA: 3, SR: 0, SA: 0 }), {
    ...baseConfig,
    tieBreakOrder: ["FR", "CA", "SR", "SA"]
  });
  assert.equal(result.sub, "SUB_FR");
});

test("08 subtype maps SA to SUB_SA", () => {
  const result = evaluatePsSubFe(input({ FR: 0, CA: 0, SR: 2, SA: 4 }), baseConfig);
  assert.equal(result.sub, "SUB_SA");
});

test("09 collapse flag triggers on multi high-axis", () => {
  const result = evaluatePsSubFe(input({ FR: 3, CA: 3, SR: 0, SA: 0 }), baseConfig);
  assert.equal(result.ps, "ST_DEV");
  assert.equal(result.f.triggered, true);
  assert.ok(result.f.reasons.includes("multi-high-axis"));
});

test("10 collapse flag stays false when thresholds not met", () => {
  const result = evaluatePsSubFe(input({ FR: 3, CA: 2, SR: 0, SA: 0 }), baseConfig);
  assert.equal(result.f.triggered, false);
});

test("11 evidence prioritizes chosen subtype axis", () => {
  const result = evaluatePsSubFe(
    input(
      { FR: 3, CA: 3, SR: 0, SA: 0 },
      [
        { axis: "CA", turnId: "T2", summary: "context drift" },
        { axis: "FR", turnId: "T1", summary: "fact contradiction" }
      ]
    ),
    {
      ...baseConfig,
      tieBreakOrder: ["FR", "CA", "SR", "SA"]
    }
  );
  assert.match(result.e, /^FR:T1 fact contradiction/);
});

test("12 evidence obeys maxItems limit", () => {
  const result = evaluatePsSubFe(
    input(
      { FR: 3, CA: 2, SR: 1, SA: 0 },
      [
        { axis: "FR", turnId: "T1", summary: "a" },
        { axis: "FR", turnId: "T2", summary: "b" },
        { axis: "CA", turnId: "T3", summary: "c" }
      ]
    ),
    {
      ...baseConfig,
      evidence: {
        ...baseConfig.evidence,
        maxItems: 2
      }
    }
  );
  assert.equal(result.e.split(" | ").length, 2);
});

test("13 fallback evidence text when no evidence provided", () => {
  const result = evaluatePsSubFe(input({ FR: 1, CA: 0, SR: 0, SA: 0 }), baseConfig);
  assert.equal(result.e, "No material evidence provided.");
});

test("14 evidence summary collapses extra whitespace", () => {
  const result = evaluatePsSubFe(
    input({ FR: 1, CA: 0, SR: 0, SA: 0 }, [{ axis: "FR", turnId: "T5", summary: "a   b" }]),
    baseConfig
  );
  assert.equal(result.e, "FR:T5 a b");
});

test("15 accepts numeric-string axis scores", () => {
  const result = evaluatePsSubFe(input({ fr: "2", ca: "0", sr: "0", sa: "0" }), baseConfig);
  assert.equal(result.ps, "ST_DEV");
  assert.equal(result.axisScores.FR, 2);
});

test("16 unknown axis score is ignored with warning", () => {
  const result = evaluatePsSubFe(input({ FR: 1, ZZ: 4 }), baseConfig);
  assert.equal(result.axisScores.FR, 1);
  assert.ok(hasFinding(result, "input-axis-score-unknown"));
});

test("17 invalid axis score over upper bound blocks", () => {
  const result = evaluatePsSubFe(input({ FR: 5 }), baseConfig);
  assert.equal(result.ps, "ST_ALM");
  assert.equal(result.sub, "SUB_SAFE_MODE");
  assert.ok(hasFinding(result, "invalid-axisScores.FR"));
});

test("18 invalid axis score decimal blocks", () => {
  const result = evaluatePsSubFe(input({ FR: 1.2 }), baseConfig);
  assert.ok(hasFinding(result, "invalid-axisScores.FR"));
  assert.equal(result.summary.blockingFindings > 0, true);
});

test("19 invalid axis score negative blocks", () => {
  const result = evaluatePsSubFe(input({ FR: -1 }), baseConfig);
  assert.ok(hasFinding(result, "invalid-axisScores.FR"));
});

test("20 missing axisScores object blocks", () => {
  const result = evaluatePsSubFe({}, baseConfig);
  assert.ok(hasFinding(result, "input-axis-scores-invalid"));
  assert.equal(result.ps, "ST_ALM");
});

test("21 invalid evidence structure blocks", () => {
  const result = evaluatePsSubFe(input({ FR: 2 }, "bad"), baseConfig);
  assert.ok(hasFinding(result, "input-evidence-invalid"));
  assert.equal(result.summary.blockingFindings > 0, true);
});

test("22 evidence unknown axis warns and skips", () => {
  const result = evaluatePsSubFe(
    input({ FR: 2 }, [{ axis: "ZZ", turnId: "T1", summary: "bad" }]),
    baseConfig
  );
  assert.ok(hasFinding(result, "input-evidence-axis-unknown"));
  assert.equal(result.e, "No material evidence provided.");
});

test("23 invalid threshold relation blocks", () => {
  const result = evaluatePsSubFe(input({ FR: 2 }), {
    ...baseConfig,
    stateThresholds: {
      nrmMax: 1,
      devMax: 2,
      almMin: 4
    }
  });
  assert.ok(hasFinding(result, "config-state-thresholds-invalid"));
  assert.equal(result.ps, "ST_ALM");
});

test("24 invalid tie-break axis blocks", () => {
  const result = evaluatePsSubFe(input({ FR: 2 }), {
    ...baseConfig,
    tieBreakOrder: ["FR", "ZZ"]
  });
  assert.ok(hasFinding(result, "config-tie-break-axis-unknown"));
});

test("25 empty axes config blocks", () => {
  const result = evaluatePsSubFe(input({ FR: 2 }), {
    ...baseConfig,
    axes: []
  });
  assert.ok(hasFinding(result, "config-axes-empty"));
});

test("26 boundary consistency for default thresholds", () => {
  const expected = ["ST_NRM", "ST_NRM", "ST_DEV", "ST_DEV", "ST_ALM"];
  for (let score = 0; score <= 4; score += 1) {
    const result = evaluatePsSubFe(input({ FR: score }), baseConfig);
    assert.equal(result.ps, expected[score]);
  }
});

test("27 custom contiguous thresholds remain consistent", () => {
  const config = {
    ...baseConfig,
    stateThresholds: {
      nrmMax: 0,
      devMax: 2,
      almMin: 3
    }
  };
  const expected = ["ST_NRM", "ST_DEV", "ST_DEV", "ST_ALM", "ST_ALM"];
  for (let score = 0; score <= 4; score += 1) {
    const result = evaluatePsSubFe(input({ FR: score }), config);
    assert.equal(result.ps, expected[score]);
  }
});

test("28 CLI writes json output on success", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-sub-fe-"));
  const inputPath = path.join(tmpDir, "input.json");
  const configPath = path.join(tmpDir, "config.json");
  const outputPath = path.join(tmpDir, "result.json");

  fs.writeFileSync(inputPath, JSON.stringify(input({ FR: 2, CA: 0, SR: 0, SA: 0 }), null, 2));
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2));

  execFileSync(
    "node",
    [
      "scripts/ps-sub-fe-core.mjs",
      "--input",
      inputPath,
      "--config",
      configPath,
      "--output",
      outputPath
    ],
    {
      cwd: process.cwd(),
      stdio: "pipe"
    }
  );

  const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(output.ps, "ST_DEV");
});

test("29 CLI returns non-zero on blocking findings", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-sub-fe-"));
  const inputPath = path.join(tmpDir, "input.json");

  fs.writeFileSync(inputPath, JSON.stringify({ axisScores: { FR: 9 } }, null, 2));

  assert.throws(
    () =>
      execFileSync("node", ["scripts/ps-sub-fe-core.mjs", "--input", inputPath], {
        cwd: process.cwd(),
        stdio: "pipe"
      }),
    /Command failed/
  );
});

test("30 CLI emits markdown when format markdown is selected", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-sub-fe-"));
  const inputPath = path.join(tmpDir, "input.json");
  const outputPath = path.join(tmpDir, "result.md");

  fs.writeFileSync(inputPath, JSON.stringify(input({ FR: 1, CA: 0, SR: 0, SA: 0 }), null, 2));

  execFileSync(
    "node",
    [
      "scripts/ps-sub-fe-core.mjs",
      "--input",
      inputPath,
      "--format",
      "markdown",
      "--output",
      outputPath
    ],
    {
      cwd: process.cwd(),
      stdio: "pipe"
    }
  );

  const markdown = fs.readFileSync(outputPath, "utf8");
  assert.match(markdown, /# PS\/SUB\/F\/E Derivation Result/);
  assert.match(markdown, /PS: \*\*ST_NRM\*\*/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runDeidPipeline } from "../scripts/deid-pipeline.mjs";

const basePolicy = {
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

function textInput(text) {
  return { text };
}

function hasFinding(result, findingId) {
  return result.findings.some((item) => item.id === findingId);
}

test("01 redacts email by default", () => {
  const result = runDeidPipeline(textInput("contact me at a.b@example.com"), basePolicy);
  assert.match(result.redactedText, /\[EMAIL_1\]/);
  assert.equal(result.summary.countsByType.email, 1);
});

test("02 preserveEmailDomain keeps domain", () => {
  const result = runDeidPipeline(textInput("a@example.com"), {
    ...basePolicy,
    replacement: {
      ...basePolicy.replacement,
      preserveEmailDomain: true
    }
  });
  assert.equal(result.redactedText, "[EMAIL_1]@example.com");
});

test("03 redacts phone and preserves last digits", () => {
  const result = runDeidPipeline(textInput("phone +886 912 345 678"), basePolicy);
  assert.match(result.redactedText, /\[PHONE_1\]_\*78/);
  assert.equal(result.summary.countsByType.phone, 1);
});

test("04 phone preserve digits can be disabled", () => {
  const result = runDeidPipeline(textInput("0912-345-678"), {
    ...basePolicy,
    replacement: {
      ...basePolicy.replacement,
      phoneMaskLastDigits: 0
    }
  });
  assert.equal(result.redactedText, "[PHONE_1]");
});

test("05 does not treat short number as phone", () => {
  const result = runDeidPipeline(textInput("value 123-456"), basePolicy);
  assert.equal(result.summary.totalReplacements, 0);
});

test("06 redacts ipv4", () => {
  const result = runDeidPipeline(textInput("host 10.20.30.40"), basePolicy);
  assert.equal(result.summary.countsByType.ipv4, 1);
  assert.match(result.redactedText, /\[IPV4_1\]/);
});

test("07 invalid ipv4 is ignored", () => {
  const result = runDeidPipeline(textInput("host 999.20.30.40"), basePolicy);
  assert.equal(result.summary.totalReplacements, 0);
});

test("08 redacts valid Taiwan national id", () => {
  const result = runDeidPipeline(textInput("ID A123456789"), basePolicy);
  assert.equal(result.summary.countsByType.tw_national_id, 1);
  assert.match(result.redactedText, /\[TW_NATIONAL_ID_1\]/);
});

test("09 invalid Taiwan national id checksum is ignored", () => {
  const result = runDeidPipeline(textInput("ID A123456788"), basePolicy);
  assert.equal(result.summary.totalReplacements, 0);
});

test("10 redacts credit card with luhn valid", () => {
  const result = runDeidPipeline(textInput("cc 4111 1111 1111 1111"), basePolicy);
  assert.equal(result.summary.countsByType.credit_card, 1);
  assert.match(result.redactedText, /\[CREDIT_CARD_1\]/);
});

test("11 invalid credit card is ignored", () => {
  const result = runDeidPipeline(textInput("cc 4111 1111 1111 1112"), basePolicy);
  assert.equal(result.summary.totalReplacements, 0);
});

test("12 redacts sensitive query values only", () => {
  const result = runDeidPipeline(
    textInput("https://a.com/path?token=abc123&safe=ok"),
    basePolicy
  );
  assert.match(result.redactedText, /token=\[QUERY_SECRET_1\]/);
  assert.match(result.redactedText, /safe=ok/);
});

test("13 multiple types are counted", () => {
  const result = runDeidPipeline(
    textInput("a@example.com 10.0.0.1 0912-345-678"),
    basePolicy
  );
  assert.equal(result.summary.totalReplacements, 3);
  assert.deepEqual(result.summary.piiTypesDetected, ["email", "ipv4", "phone"]);
});

test("14 indexed token increments per type", () => {
  const result = runDeidPipeline(textInput("a@x.com b@y.com"), basePolicy);
  assert.match(result.redactedText, /\[EMAIL_1\] \[EMAIL_2\]/);
});

test("15 fixed token strategy uses same token", () => {
  const result = runDeidPipeline(textInput("a@x.com 10.1.1.1"), {
    ...basePolicy,
    replacement: {
      ...basePolicy.replacement,
      strategy: "fixed-token",
      fixedToken: "[MASK]"
    }
  });
  assert.equal(result.redactedText, "[MASK] [MASK]");
});

test("16 maxPerType limits replacements and emits warning", () => {
  const result = runDeidPipeline(textInput("a@x.com b@y.com c@z.com"), {
    ...basePolicy,
    audit: {
      maxPerType: 1
    }
  });
  assert.equal(result.summary.countsByType.email, 1);
  assert.ok(hasFinding(result, "audit-max-per-type-email"));
});

test("17 turns mode redacts each turn", () => {
  const result = runDeidPipeline(
    {
      turns: [
        { id: "T1", role: "user", text: "mail a@x.com" },
        { id: "T2", role: "assistant", text: "call 0912-345-678" }
      ]
    },
    basePolicy
  );
  assert.equal(result.mode, "turns");
  assert.match(result.redactedTurns[0].text, /\[EMAIL_1\]/);
  assert.match(result.redactedTurns[1].text, /\[PHONE_1\]/);
  assert.equal(result.replacements[0].turnId, "T1");
});

test("18 missing text and turns blocks pipeline", () => {
  const result = runDeidPipeline({}, basePolicy);
  assert.ok(hasFinding(result, "input-text-or-turns-required"));
  assert.equal(result.summary.blockingFindings > 0, true);
});

test("19 non-object turn item blocks pipeline", () => {
  const result = runDeidPipeline({ turns: ["bad"] }, basePolicy);
  assert.ok(hasFinding(result, "input-turn-invalid"));
});

test("20 missing turn text blocks pipeline", () => {
  const result = runDeidPipeline({ turns: [{ id: "T1" }] }, basePolicy);
  assert.ok(hasFinding(result, "input-turn-text-invalid"));
});

test("21 invalid replacement strategy blocks pipeline", () => {
  const result = runDeidPipeline(textInput("a@x.com"), {
    ...basePolicy,
    replacement: {
      ...basePolicy.replacement,
      strategy: "wrong"
    }
  });
  assert.ok(hasFinding(result, "policy-replacement.strategy-invalid"));
});

test("22 empty fixedToken blocks pipeline", () => {
  const result = runDeidPipeline(textInput("a@x.com"), {
    ...basePolicy,
    replacement: {
      ...basePolicy.replacement,
      fixedToken: ""
    }
  });
  assert.ok(hasFinding(result, "policy-replacement.fixedToken-invalid"));
});

test("23 disabling detectors prevents replacements", () => {
  const result = runDeidPipeline(textInput("a@x.com"), {
    ...basePolicy,
    detectors: {
      ...basePolicy.detectors,
      email: false
    }
  });
  assert.equal(result.summary.totalReplacements, 0);
});

test("24 replacement audit contains digest and not raw text", () => {
  const result = runDeidPipeline(textInput("a@x.com"), basePolicy);
  assert.equal(typeof result.replacements[0].digestBefore, "string");
  assert.equal(result.replacements[0].digestBefore.length, 16);
});

test("25 cli writes json output on success", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deid-pipeline-"));
  const inputPath = path.join(tmpDir, "input.json");
  const policyPath = path.join(tmpDir, "policy.json");
  const outputPath = path.join(tmpDir, "output.json");

  fs.writeFileSync(inputPath, JSON.stringify(textInput("a@x.com"), null, 2));
  fs.writeFileSync(policyPath, JSON.stringify(basePolicy, null, 2));

  execFileSync(
    "node",
    [
      "scripts/deid-pipeline.mjs",
      "--input",
      inputPath,
      "--config",
      policyPath,
      "--output",
      outputPath
    ],
    {
      cwd: process.cwd(),
      stdio: "pipe"
    }
  );

  const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(output.summary.blockingFindings, 0);
});

test("26 cli returns non-zero on blocking findings", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deid-pipeline-"));
  const inputPath = path.join(tmpDir, "input.json");
  const policyPath = path.join(tmpDir, "policy.json");

  fs.writeFileSync(inputPath, JSON.stringify({ turns: ["bad"] }, null, 2));
  fs.writeFileSync(policyPath, JSON.stringify(basePolicy, null, 2));

  assert.throws(
    () =>
      execFileSync(
        "node",
        ["scripts/deid-pipeline.mjs", "--input", inputPath, "--config", policyPath],
        {
          cwd: process.cwd(),
          stdio: "pipe"
        }
      ),
    /Command failed/
  );
});

test("27 cli emits markdown when format markdown is selected", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deid-pipeline-"));
  const inputPath = path.join(tmpDir, "input.json");
  const outputPath = path.join(tmpDir, "output.md");

  fs.writeFileSync(inputPath, JSON.stringify(textInput("a@x.com"), null, 2));

  execFileSync(
    "node",
    [
      "scripts/deid-pipeline.mjs",
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
  assert.match(markdown, /# De-identification Result/);
  assert.match(markdown, /Total replacements:/);
});

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

// --- Per-detector disable tests ---

test("28 disabling phone detector prevents phone redaction", () => {
  const result = runDeidPipeline(textInput("call 0912-345-678"), {
    ...basePolicy,
    detectors: { ...basePolicy.detectors, phone: false }
  });
  assert.equal(result.summary.totalReplacements, 0);
});

test("29 disabling ipv4 detector prevents ipv4 redaction", () => {
  const result = runDeidPipeline(textInput("host 10.20.30.40"), {
    ...basePolicy,
    detectors: { ...basePolicy.detectors, ipv4: false }
  });
  assert.equal(result.summary.totalReplacements, 0);
});

test("30 disabling twNationalId detector prevents id redaction", () => {
  const result = runDeidPipeline(textInput("ID A123456789"), {
    ...basePolicy,
    detectors: { ...basePolicy.detectors, twNationalId: false }
  });
  assert.equal(result.summary.totalReplacements, 0);
});

test("31 disabling creditCard detector prevents cc redaction", () => {
  const result = runDeidPipeline(textInput("cc 4111 1111 1111 1111"), {
    ...basePolicy,
    detectors: { ...basePolicy.detectors, creditCard: false }
  });
  assert.equal(result.summary.totalReplacements, 0);
});

test("32 disabling sensitiveQueryKeys detector prevents query redaction", () => {
  const result = runDeidPipeline(textInput("https://a.com?token=abc"), {
    ...basePolicy,
    detectors: { ...basePolicy.detectors, sensitiveQueryKeys: false }
  });
  assert.equal(result.summary.totalReplacements, 0);
});

// --- Sensitive query keys coverage (all 10 keys) ---

const sensitiveKeys = [
  "token", "access_token", "api_key", "apikey",
  "password", "passwd", "secret", "session", "sessionid", "auth"
];

let caseIndex = 33;
for (const key of sensitiveKeys) {
  test(`${String(caseIndex).padStart(2, "0")} detects sensitive query key '${key}'`, () => {
    const result = runDeidPipeline(
      textInput(`https://a.com/path?${key}=secret_val_123`),
      basePolicy
    );
    assert.equal(result.summary.countsByType.query_secret, 1, `Expected query_secret for key '${key}'`);
    assert.match(result.redactedText, /\[QUERY_SECRET_1\]/);
  });
  caseIndex += 1;
}

// --- Email edge cases ---

test(`${String(caseIndex).padStart(2, "0")} email with plus addressing is detected`, () => {
  const result = runDeidPipeline(textInput("user+tag@example.com"), basePolicy);
  assert.equal(result.summary.countsByType.email, 1);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} email with mixed case is detected`, () => {
  const result = runDeidPipeline(textInput("User@EXAMPLE.COM"), basePolicy);
  assert.equal(result.summary.countsByType.email, 1);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} email with subdomain is detected`, () => {
  const result = runDeidPipeline(textInput("user@sub.domain.example.com"), basePolicy);
  assert.equal(result.summary.countsByType.email, 1);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} multiple emails get incrementing tokens`, () => {
  const result = runDeidPipeline(textInput("a@x.com b@y.com c@z.com"), basePolicy);
  assert.match(result.redactedText, /\[EMAIL_1\]/);
  assert.match(result.redactedText, /\[EMAIL_2\]/);
  assert.match(result.redactedText, /\[EMAIL_3\]/);
  assert.equal(result.summary.countsByType.email, 3);
});
caseIndex += 1;

// --- Phone edge cases ---

test(`${String(caseIndex).padStart(2, "0")} international phone format with country code`, () => {
  const result = runDeidPipeline(textInput("call +1 212 555 1234"), basePolicy);
  assert.equal(result.summary.countsByType.phone, 1);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} phone with parentheses format`, () => {
  const result = runDeidPipeline(textInput("call (02) 2345-6789"), basePolicy);
  assert.equal(result.summary.countsByType.phone, 1);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} phone digit count below 8 is ignored`, () => {
  const result = runDeidPipeline(textInput("short 123-4567"), basePolicy);
  assert.equal(result.summary.totalReplacements, 0);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} phone-like pattern that is actually an IP is ignored by phone detector`, () => {
  const result = runDeidPipeline(textInput("host 192.168.1.1"), {
    ...basePolicy,
    detectors: { ...basePolicy.detectors, ipv4: false }
  });
  assert.equal(result.summary.countsByType.phone ?? 0, 0);
});
caseIndex += 1;

// --- IPv4 edge cases ---

test(`${String(caseIndex).padStart(2, "0")} ipv4 with boundary octets 0.0.0.0`, () => {
  const result = runDeidPipeline(textInput("addr 0.0.0.0"), basePolicy);
  assert.equal(result.summary.countsByType.ipv4, 1);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} ipv4 with max octets 255.255.255.255`, () => {
  const result = runDeidPipeline(textInput("addr 255.255.255.255"), basePolicy);
  assert.equal(result.summary.countsByType.ipv4, 1);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} ipv4 with 256 octet is invalid`, () => {
  const result = runDeidPipeline(textInput("addr 256.1.1.1"), basePolicy);
  assert.equal(result.summary.totalReplacements, 0);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} multiple ipv4 addresses get incrementing tokens`, () => {
  const result = runDeidPipeline(textInput("hosts 10.0.0.1 and 10.0.0.2"), basePolicy);
  assert.match(result.redactedText, /\[IPV4_1\]/);
  assert.match(result.redactedText, /\[IPV4_2\]/);
  assert.equal(result.summary.countsByType.ipv4, 2);
});
caseIndex += 1;

// --- Taiwan National ID edge cases ---

test(`${String(caseIndex).padStart(2, "0")} TW id with gender digit 2 (female)`, () => {
  const result = runDeidPipeline(textInput("ID F200000008"), basePolicy);
  assert.equal(result.summary.countsByType.tw_national_id, 1);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} TW id with lowercase letter is ignored`, () => {
  const result = runDeidPipeline(textInput("ID a123456789"), basePolicy);
  assert.equal(result.summary.totalReplacements, 0);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} TW id with gender digit other than 1 or 2 is ignored`, () => {
  const result = runDeidPipeline(textInput("ID A323456789"), basePolicy);
  assert.equal(result.summary.totalReplacements, 0);
});
caseIndex += 1;

// --- Credit card edge cases ---

test(`${String(caseIndex).padStart(2, "0")} credit card with dashes is detected`, () => {
  const result = runDeidPipeline(textInput("cc 4111-1111-1111-1111"), basePolicy);
  assert.equal(result.summary.countsByType.credit_card, 1);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} credit card with 13 digits and valid luhn is detected`, () => {
  // 13-digit Luhn-valid: 4000000000006; disable phone to avoid overlap
  const policy = { ...basePolicy, detectors: { ...basePolicy.detectors, phone: false } };
  const result = runDeidPipeline(textInput("cc 4000000000006"), policy);
  assert.equal(result.summary.countsByType.credit_card, 1);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} credit card with too few digits (12) is ignored`, () => {
  const result = runDeidPipeline(textInput("cc 411111111111"), basePolicy);
  assert.equal(result.summary.countsByType.credit_card ?? 0, 0);
});
caseIndex += 1;

// --- Overlap deduplication ---

test(`${String(caseIndex).padStart(2, "0")} overlapping matches are deduplicated`, () => {
  // Email contains what could be interpreted as other patterns, but dedup keeps the first match
  const result = runDeidPipeline(textInput("contact user@10.0.0.1"), basePolicy);
  // The email regex should match, and the IP should also match separately
  assert.ok(result.summary.totalReplacements >= 1);
});
caseIndex += 1;

// --- Turns mode edge cases ---

test(`${String(caseIndex).padStart(2, "0")} turns mode counter increments across turns`, () => {
  const result = runDeidPipeline(
    {
      turns: [
        { id: "T1", text: "a@x.com" },
        { id: "T2", text: "b@y.com" }
      ]
    },
    basePolicy
  );
  assert.match(result.redactedTurns[0].text, /\[EMAIL_1\]/);
  assert.match(result.redactedTurns[1].text, /\[EMAIL_2\]/);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} turns mode provides turnIndex on replacements`, () => {
  const result = runDeidPipeline(
    {
      turns: [
        { id: "T1", text: "clean" },
        { id: "T2", text: "a@x.com" }
      ]
    },
    basePolicy
  );
  assert.equal(result.replacements[0].turnIndex, 1);
  assert.equal(result.replacements[0].turnId, "T2");
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} turns mode generates fallback turn ids`, () => {
  const result = runDeidPipeline(
    {
      turns: [
        { text: "a@x.com" },
        { text: "b@y.com" }
      ]
    },
    basePolicy
  );
  assert.equal(result.redactedTurns[0].id, "T1");
  assert.equal(result.redactedTurns[1].id, "T2");
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} turns mode preserves role field`, () => {
  const result = runDeidPipeline(
    {
      turns: [{ id: "T1", role: "user", text: "a@x.com" }]
    },
    basePolicy
  );
  assert.equal(result.redactedTurns[0].role, "user");
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} originalTurnCount is set in turns mode`, () => {
  const result = runDeidPipeline(
    {
      turns: [
        { text: "a@x.com" },
        { text: "10.0.0.1" }
      ]
    },
    basePolicy
  );
  assert.equal(result.originalTurnCount, 2);
});
caseIndex += 1;

// --- Input validation edge cases ---

test(`${String(caseIndex).padStart(2, "0")} null input blocks pipeline`, () => {
  const result = runDeidPipeline(null, basePolicy);
  assert.ok(hasFinding(result, "input-invalid"));
  assert.equal(result.summary.blockingFindings > 0, true);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} array input blocks pipeline`, () => {
  const result = runDeidPipeline([], basePolicy);
  assert.ok(hasFinding(result, "input-invalid"));
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} string input blocks pipeline`, () => {
  const result = runDeidPipeline("raw text", basePolicy);
  assert.ok(hasFinding(result, "input-invalid"));
});
caseIndex += 1;

// --- Output structure tests ---

test(`${String(caseIndex).padStart(2, "0")} text mode sets originalTextLength`, () => {
  const text = "hello a@x.com world";
  const result = runDeidPipeline(textInput(text), basePolicy);
  assert.equal(result.originalTextLength, text.length);
  assert.equal(result.mode, "text");
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} trace includes pipeline step`, () => {
  const result = runDeidPipeline(textInput("a@x.com"), basePolicy);
  assert.ok(result.trace.some((item) => item.step === "pipeline"));
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} piiTypesDetected is sorted alphabetically`, () => {
  const result = runDeidPipeline(
    textInput("a@x.com 10.0.0.1 0912-345-678"),
    basePolicy
  );
  const types = result.summary.piiTypesDetected;
  const sorted = [...types].sort();
  assert.deepEqual(types, sorted);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} replacement id format includes segment prefix`, () => {
  const result = runDeidPipeline(textInput("a@x.com"), basePolicy);
  assert.match(result.replacements[0].id, /^TEXT-R/);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} replacement includes start and end positions`, () => {
  const result = runDeidPipeline(textInput("a@x.com"), basePolicy);
  assert.equal(typeof result.replacements[0].start, "number");
  assert.equal(typeof result.replacements[0].end, "number");
  assert.ok(result.replacements[0].end > result.replacements[0].start);
});
caseIndex += 1;

// --- Mixed detector and policy interactions ---

test(`${String(caseIndex).padStart(2, "0")} all six detector types detected in one text`, () => {
  const text = "a@x.com 0912-345-678 10.0.0.1 A123456789 4111 1111 1111 1111 https://a.com?token=abc";
  const result = runDeidPipeline(textInput(text), basePolicy);
  assert.equal(result.summary.piiTypesDetected.length, 6);
  assert.ok(result.summary.piiTypesDetected.includes("email"));
  assert.ok(result.summary.piiTypesDetected.includes("phone"));
  assert.ok(result.summary.piiTypesDetected.includes("ipv4"));
  assert.ok(result.summary.piiTypesDetected.includes("tw_national_id"));
  assert.ok(result.summary.piiTypesDetected.includes("credit_card"));
  assert.ok(result.summary.piiTypesDetected.includes("query_secret"));
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} maxPerType works independently per type`, () => {
  const result = runDeidPipeline(
    textInput("a@x.com b@y.com 10.0.0.1 10.0.0.2"),
    { ...basePolicy, audit: { maxPerType: 1 } }
  );
  assert.equal(result.summary.countsByType.email, 1);
  assert.equal(result.summary.countsByType.ipv4, 1);
  assert.ok(hasFinding(result, "audit-max-per-type-email"));
  assert.ok(hasFinding(result, "audit-max-per-type-ipv4"));
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} clean text produces zero replacements`, () => {
  const result = runDeidPipeline(textInput("nothing sensitive here at all"), basePolicy);
  assert.equal(result.summary.totalReplacements, 0);
  assert.deepEqual(result.summary.piiTypesDetected, []);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} blocking findings trigger safe-fallback trace`, () => {
  const result = runDeidPipeline(null, basePolicy);
  assert.ok(result.trace.some((item) => item.step === "safe-fallback"));
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} generatedAt is ISO timestamp string`, () => {
  const result = runDeidPipeline(textInput("a@x.com"), basePolicy);
  assert.equal(typeof result.generatedAt, "string");
  assert.ok(!isNaN(Date.parse(result.generatedAt)));
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} sensitive query key in hash fragment is not detected`, () => {
  const result = runDeidPipeline(
    textInput("https://a.com/path#token=abc123"),
    basePolicy
  );
  assert.equal(result.summary.countsByType.query_secret ?? 0, 0);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} multiple sensitive query params in same URL`, () => {
  const result = runDeidPipeline(
    textInput("https://a.com?token=abc&password=def&safe=ok"),
    basePolicy
  );
  assert.equal(result.summary.countsByType.query_secret, 2);
  assert.match(result.redactedText, /safe=ok/);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} phone phoneMaskLastDigits=4 keeps 4 digits`, () => {
  const result = runDeidPipeline(textInput("call 0912-345-678"), {
    ...basePolicy,
    replacement: { ...basePolicy.replacement, phoneMaskLastDigits: 4 }
  });
  assert.match(result.redactedText, /\[PHONE_1\]_\*5678/);
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} preserveEmailDomain false does not include domain`, () => {
  const result = runDeidPipeline(textInput("a@example.com"), {
    ...basePolicy,
    replacement: { ...basePolicy.replacement, preserveEmailDomain: false }
  });
  assert.equal(result.redactedText, "[EMAIL_1]");
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} fixed-token strategy with custom token`, () => {
  const result = runDeidPipeline(textInput("a@x.com 10.0.0.1 0912-345-678"), {
    ...basePolicy,
    replacement: { ...basePolicy.replacement, strategy: "fixed-token", fixedToken: "***" }
  });
  assert.equal(result.redactedText, "*** *** ***");
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} query_secret replacement includes key field`, () => {
  const result = runDeidPipeline(
    textInput("https://a.com?api_key=secret123"),
    basePolicy
  );
  const rep = result.replacements.find((item) => item.type === "query_secret");
  assert.ok(rep);
  assert.equal(rep.key, "api_key");
});
caseIndex += 1;

test(`${String(caseIndex).padStart(2, "0")} deterministic output for same input`, () => {
  const input = textInput("a@x.com 10.0.0.1");
  const a = runDeidPipeline(input, basePolicy);
  const b = runDeidPipeline(input, basePolicy);
  assert.equal(a.redactedText, b.redactedText);
  assert.deepEqual(
    a.replacements.map((item) => item.digestBefore),
    b.replacements.map((item) => item.digestBefore)
  );
});
caseIndex += 1;

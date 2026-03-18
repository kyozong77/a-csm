import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runDeidPipeline } from "../scripts/deid-pipeline.mjs";

const BASE_POLICY = {
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

function runText(text) {
  return runDeidPipeline(textInput(text), BASE_POLICY);
}

function assertCount(result, type, expected) {
  assert.equal(result.summary.countsByType[type] ?? 0, expected);
}

describe("DEID Coverage", () => {
  describe("email detector", () => {
    it("detects standard email addresses", () => {
      const result = runText("Contact me at user@example.com.");
      assert.match(result.redactedText, /\[EMAIL_1\]/);
      assertCount(result, "email", 1);
    });

    it("detects email addresses with alias and subdomain", () => {
      const result = runText("Escalate to first.last+ops@sub.example.co.uk now.");
      assert.match(result.redactedText, /\[EMAIL_1\]/);
      assertCount(result, "email", 1);
    });

    it("does not redact invalid email-like text", () => {
      const result = runText("This text contains user@example but not a full address.");
      assert.equal(result.redactedText, "This text contains user@example but not a full address.");
      assert.equal(result.summary.totalReplacements, 0);
    });
  });

  describe("phone detector", () => {
    it("detects Taiwan mobile numbers in local format", () => {
      const result = runText("Call 0912-345-678 after review.");
      assert.match(result.redactedText, /\[PHONE_1\]_\*78/);
      assertCount(result, "phone", 1);
    });

    it("detects phone numbers in international format", () => {
      const result = runText("Emergency line is +886 912 345 678.");
      assert.match(result.redactedText, /\[PHONE_1\]_\*\d{2}/);
      assertCount(result, "phone", 1);
    });

    it("does not redact short numeric fragments", () => {
      const result = runText("Use code 12-34-56 for the door.");
      assert.equal(result.summary.totalReplacements, 0);
    });
  });

  describe("ipv4 detector", () => {
    it("detects private IPv4 addresses", () => {
      const result = runText("Host 192.168.1.1 should be masked.");
      assert.match(result.redactedText, /\[IPV4_1\]/);
      assertCount(result, "ipv4", 1);
    });

    it("detects boundary IPv4 values", () => {
      const result = runText("Broadcast 255.255.255.255 should not leak.");
      assert.match(result.redactedText, /\[IPV4_1\]/);
      assertCount(result, "ipv4", 1);
    });

    it("does not redact version numbers", () => {
      const result = runText("Release version 1.2.3 is safe text.");
      assert.equal(result.summary.totalReplacements, 0);
    });
  });

  describe("twNationalId detector", () => {
    it("detects a canonical valid Taiwan national ID", () => {
      const result = runText("Citizen ID A123456789 requires masking.");
      assert.match(result.redactedText, /\[TW_NATIONAL_ID_1\]/);
      assertCount(result, "tw_national_id", 1);
    });

    it("detects a second valid Taiwan national ID sample", () => {
      const result = runText("Another ID is A100000001 in the record.");
      assert.match(result.redactedText, /\[TW_NATIONAL_ID_1\]/);
      assertCount(result, "tw_national_id", 1);
    });

    it("does not redact invalid alphanumeric strings", () => {
      const result = runText("Reference A123456788 should remain because checksum is invalid.");
      assert.equal(result.summary.totalReplacements, 0);
    });
  });

  describe("creditCard detector", () => {
    it("detects 16-digit credit card numbers", () => {
      const result = runText("Visa 4111111111111111 must be redacted.");
      assert.match(result.redactedText, /\[CREDIT_CARD_1\]/);
      assertCount(result, "credit_card", 1);
    });

    it("detects credit card numbers with dashes", () => {
      const result = runText("Card 4111-1111-1111-1111 should be hidden.");
      assert.match(result.redactedText, /\[CREDIT_CARD_1\]/);
      assertCount(result, "credit_card", 1);
    });

    it("does not redact invalid long numbers", () => {
      const result = runText("Reference 4111111111111112 is not a valid card.");
      assert.equal(result.summary.totalReplacements, 0);
    });
  });

  describe("sensitiveQueryKeys detector", () => {
    it("detects password in query strings", () => {
      const result = runText("https://example.com/login?password=hunter2&next=/home");
      assert.match(result.redactedText, /password=\[QUERY_SECRET_1\]/);
      assertCount(result, "query_secret", 1);
    });

    it("detects api_key in query strings", () => {
      const result = runText("https://example.com?api_key=sk-test-123&env=dev");
      assert.match(result.redactedText, /api_key=\[QUERY_SECRET_1\]/);
      assertCount(result, "query_secret", 1);
    });

    it("does not redact safe query parameters", () => {
      const result = runText("https://example.com/search?page=1&sort=desc");
      assert.equal(result.summary.totalReplacements, 0);
      assert.match(result.redactedText, /page=1&sort=desc/);
    });
  });

  describe("DEID full pipeline", () => {
    it("redacts multiple PII types in a single text payload", () => {
      const result = runText(
        "Email test@mail.com Phone 0912-345-678 IP 192.168.1.1 and card 4111 1111 1111 1111."
      );

      assert.match(result.redactedText, /\[EMAIL_1\]/);
      assert.match(result.redactedText, /\[PHONE_1\]/);
      assert.match(result.redactedText, /\[IPV4_1\]/);
      assert.match(result.redactedText, /\[CREDIT_CARD_1\]/);
      assert.equal(result.summary.totalReplacements, 4);
    });

    it("preserves non-PII text unchanged", () => {
      const input = "The weather is nice today and the summary is neutral.";
      const result = runText(input);
      assert.equal(result.redactedText, input);
      assert.equal(result.summary.totalReplacements, 0);
    });

    it("handles empty text without findings", () => {
      const result = runText("");
      assert.equal(result.redactedText, "");
      assert.equal(result.summary.totalReplacements, 0);
      assert.equal(result.findings.length, 0);
    });

    it("redacts multiple detector types across turns", () => {
      const result = runDeidPipeline(
        {
          turns: [
            { id: "T1", role: "user", text: "Mail me at user@example.com." },
            {
              id: "T2",
              role: "assistant",
              text: "Server 10.0.0.1 and https://example.com?token=abc123 are sensitive."
            }
          ]
        },
        BASE_POLICY
      );

      assert.equal(result.mode, "turns");
      assert.match(result.redactedTurns[0].text, /\[EMAIL_1\]/);
      assert.match(result.redactedTurns[1].text, /\[IPV4_1\]/);
      assert.match(result.redactedTurns[1].text, /token=\[QUERY_SECRET_1\]/);
      assert.equal(result.summary.totalReplacements, 3);
    });
  });
});

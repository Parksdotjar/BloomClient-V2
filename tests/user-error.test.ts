import test from "node:test";
import assert from "node:assert/strict";
import { userError, RATE_LIMIT_MESSAGE } from "../src/services/user-error.ts";

test("rate limits hide backend URLs and technical payloads", () => {
  for (const error of ["HTTP status client error (429 Too Many Requests) for url (https://example.test/moderation)", "friend_request_rate_limited", new Error("Whoa, slow down: https://example.test/internal"), "too_many_attempts"]) {
    assert.equal(userError(error), RATE_LIMIT_MESSAGE);
  }
});
test("unrelated errors and URL IDs are not mistaken for throttling", () => {
  for (const error of ["No compatible version exists.", "404 for https://example.test/429/pack", "Permission denied."]) assert.equal(userError(error), error);
});

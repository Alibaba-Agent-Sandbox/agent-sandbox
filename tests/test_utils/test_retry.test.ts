/** Tests for async retry decorator. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { _setSleep, retry } from "../../src/utils/retry.js";

afterEach(() => {
  _setSleep(null);
});

describe("TestRetry", () => {
  it("test_success_no_retry", async () => {
    // Successful call should not retry.
    let call_count = 0;

    const succeed = retry({ max_retries: 3, retry_on: [Error] })(async function succeed() {
      call_count += 1;
      return "ok";
    });

    const result = await succeed();
    expect(result).toBe("ok");
    expect(call_count).toBe(1);
  });

  it("test_retry_then_succeed", async () => {
    // Should retry and eventually succeed.
    let call_count = 0;

    const flaky = retry({ max_retries: 3, base_delay: 0.01, jitter: 0.0, retry_on: [ValueError] })(
      async function flaky() {
        call_count += 1;
        if (call_count < 3) throw new ValueError("fail");
        return "ok";
      },
    );

    const result = await flaky();
    expect(result).toBe("ok");
    expect(call_count).toBe(3);
  });

  it("test_max_retries_exhausted", async () => {
    // Should raise last exception after exhausting retries.
    const always_fail = retry({ max_retries: 2, base_delay: 0.01, jitter: 0.0, retry_on: [ValueError] })(
      async function always_fail(): Promise<never> {
        throw new ValueError("always");
      },
    );

    await expect(always_fail()).rejects.toThrow(ValueError);
    await expect(always_fail()).rejects.toThrow(/always/);
  });

  it("test_exponential_backoff", async () => {
    // Should use exponential backoff between retries.
    const always_fail = retry({ max_retries: 3, base_delay: 1.0, jitter: 0.0, retry_on: [ValueError] })(
      async function always_fail(): Promise<never> {
        throw new ValueError("fail");
      },
    );

    const mock_sleep = vi.fn(async (_s: number) => {});
    _setSleep(mock_sleep);
    await expect(always_fail()).rejects.toThrow(ValueError);

    // Delays: 1.0 * 2^0 = 1.0, 1.0 * 2^1 = 2.0, 1.0 * 2^2 = 4.0
    expect(mock_sleep.mock.calls.length).toBe(3);
    const calls = mock_sleep.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBeCloseTo(1.0, 6);
    expect(calls[1]).toBeCloseTo(2.0, 6);
    expect(calls[2]).toBeCloseTo(4.0, 6);
  });

  it("test_only_retries_specified_exceptions", async () => {
    // Should not retry on exceptions not in retry_on.
    class PyTypeError extends Error {}
    let calls = 0;
    const raise_type_error = retry({ max_retries: 3, base_delay: 0.01, jitter: 0.0, retry_on: [ValueError] })(
      async function raise_type_error(): Promise<never> {
        calls += 1;
        throw new PyTypeError("wrong type");
      },
    );

    await expect(raise_type_error()).rejects.toThrow(PyTypeError);
    await expect(raise_type_error()).rejects.toThrow(/wrong type/);
    expect(calls).toBe(2); // one attempt per invocation; never retried
  });

  it("test_retry_after_attribute", async () => {
    // Should respect retry_after attribute on exception.
    class RetryableError extends Error {
      retry_after: number | null;
      constructor(msg: string, retry_after: number | null = null) {
        super(msg);
        this.retry_after = retry_after;
      }
    }

    let call_count = 0;

    const flaky = retry({ max_retries: 2, base_delay: 1.0, jitter: 0.0, retry_on: [RetryableError] })(
      async function flaky() {
        call_count += 1;
        if (call_count < 2) throw new RetryableError("retry me", 5.0);
        return "ok";
      },
    );

    const mock_sleep = vi.fn(async (_s: number) => {});
    _setSleep(mock_sleep);
    const result = await flaky();
    expect(result).toBe("ok");
    // Should have used the retry_after value (5.0) instead of exponential
    expect(mock_sleep.mock.calls.length).toBe(1);
    expect(mock_sleep.mock.calls[0]![0]).toBeCloseTo(5.0, 6);
  });
});

class ValueError extends Error {}

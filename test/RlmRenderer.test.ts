import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import { formatEvent, renderEvent, type RenderOptions } from "../src/RlmRenderer"
import { BudgetState, CallId, RlmEvent } from "../src/RlmTypes"
import {
  BudgetExhaustedError,
  CallStateMissingError,
  NoFinalAnswerError,
  OutputValidationError,
  SandboxError,
  UnknownRlmError
} from "../src/RlmError"

const capture = (event: RlmEvent, options?: RenderOptions) =>
  formatEvent(event, options)

const completionId = "test-completion"
const callId = CallId("test-call")

describe("RlmRenderer", () => {
  test("IterationStarted renders budget info", () => {
    const out = capture(
      RlmEvent.IterationStarted({
        completionId,
        callId,
        depth: 0,
        iteration: 2,
        budget: new BudgetState({
          iterationsRemaining: 8,
          llmCallsRemaining: 18,
          tokenBudgetRemaining: Option.none()
        })
      }),
      { noColor: true }
    )
    expect(out).toContain("[2] ─── Iteration ───")
    expect(out).toContain("8i")
    expect(out).toContain("18c")
  })

  test("ModelResponse truncates long text", () => {
    const longText = "x".repeat(300)
    const out = capture(
      RlmEvent.ModelResponse({ completionId, callId, depth: 0, text: longText }),
      { noColor: true }
    )
    expect(out).toContain("...")
    expect(out.length).toBeLessThan(300)
  })

  test("CodeExecutionStarted renders marker", () => {
    const out = capture(
      RlmEvent.CodeExecutionStarted({ completionId, callId, depth: 0, code: "print(1)" }),
      { noColor: true }
    )
    expect(out).toContain("▶ Executing...")
  })

  test("CodeExecutionCompleted renders output", () => {
    const out = capture(
      RlmEvent.CodeExecutionCompleted({ completionId, callId, depth: 0, output: "42" }),
      { noColor: true }
    )
    expect(out).toContain("◀ Output: 42")
  })

  test("BridgeCallReceived renders method", () => {
    const out = capture(
      RlmEvent.BridgeCallReceived({ completionId, callId, depth: 0, method: "llm_query" }),
      { noColor: true }
    )
    expect(out).toContain("↗ Bridge: llm_query")
  })

  test("CallFinalized renders answer", () => {
    const out = capture(
      RlmEvent.CallFinalized({ completionId, callId, depth: 0, answer: "The answer is 42" }),
      { noColor: true }
    )
    expect(out).toContain("✓ FINAL: The answer is 42")
  })

  test("CallFailed renders error", () => {
    const out = capture(
      RlmEvent.CallFailed({
        completionId,
        callId,
        depth: 0,
        error: new SandboxError({ message: "boom" })
      }),
      { noColor: true }
    )
    expect(out).toContain("✗ FAILED: SandboxError")
    expect(out).toContain("boom")
  })

  test("SchedulerWarning renders message with code", () => {
    const out = capture(
      RlmEvent.SchedulerWarning({
        completionId,
        code: "QUEUE_CLOSED",
        message: "Queue was closed"
      }),
      { noColor: true }
    )
    expect(out).toContain("⚠ QUEUE_CLOSED: Queue was closed")
  })

  test("quiet mode suppresses non-final events", () => {
    const iterOut = capture(
      RlmEvent.IterationStarted({
        completionId,
        callId,
        depth: 0,
        iteration: 1,
        budget: new BudgetState({
          iterationsRemaining: 9,
          llmCallsRemaining: 19,
          tokenBudgetRemaining: Option.none()
        })
      }),
      { quiet: true, noColor: true }
    )
    expect(iterOut).toBe("")

    const finalOut = capture(
      RlmEvent.CallFinalized({ completionId, callId, depth: 0, answer: "done" }),
      { quiet: true, noColor: true }
    )
    expect(finalOut).toContain("✓ FINAL: done")

    const failOut = capture(
      RlmEvent.CallFailed({
        completionId,
        callId,
        depth: 0,
        error: new SandboxError({ message: "err" })
      }),
      { quiet: true, noColor: true }
    )
    expect(failOut).toContain("✗ FAILED:")
  })

  test("depth indentation", () => {
    const out = capture(
      RlmEvent.CallFinalized({ completionId, callId, depth: 2, answer: "nested" }),
      { noColor: true }
    )
    expect(out).toContain("    ✓ FINAL:")
  })

  test("noColor disables ANSI codes", () => {
    const colored = capture(
      RlmEvent.CallFinalized({ completionId, callId, depth: 0, answer: "test" })
    )
    const plain = capture(
      RlmEvent.CallFinalized({ completionId, callId, depth: 0, answer: "test" }),
      { noColor: true }
    )
    expect(colored).toContain("\x1b[")
    expect(plain).not.toContain("\x1b[")
  })

  // --- Token usage ---

  test("token usage with totalTokens", () => {
    const out = capture(
      RlmEvent.ModelResponse({
        completionId,
        callId,
        depth: 0,
        text: "hello",
        usage: { totalTokens: 42, inputTokens: 20, outputTokens: 22 }
      }),
      { noColor: true }
    )
    expect(out).toContain("(42 tok)")
  })

  test("token usage falls back to sum when totalTokens is 0", () => {
    const out = capture(
      RlmEvent.ModelResponse({
        completionId,
        callId,
        depth: 0,
        text: "hello",
        usage: { totalTokens: 0, inputTokens: 10, outputTokens: 5 }
      }),
      { noColor: true }
    )
    expect(out).toContain("(15 tok)")
  })

  test("token usage omitted when all zero", () => {
    const out = capture(
      RlmEvent.ModelResponse({
        completionId,
        callId,
        depth: 0,
        text: "hello",
        usage: { totalTokens: 0 }
      }),
      { noColor: true }
    )
    expect(out).not.toContain("tok")
  })

  // --- showCode / showOutput toggles ---

  test("showCode false suppresses CodeExecutionStarted", () => {
    const out = capture(
      RlmEvent.CodeExecutionStarted({ completionId, callId, depth: 0, code: "print(1)" }),
      { showCode: false, noColor: true }
    )
    expect(out).toBe("")
  })

  test("showOutput false suppresses CodeExecutionCompleted", () => {
    const out = capture(
      RlmEvent.CodeExecutionCompleted({ completionId, callId, depth: 0, output: "42" }),
      { showOutput: false, noColor: true }
    )
    expect(out).toBe("")
  })

  // --- Suppressed events ---

  test("CallStarted returns empty", () => {
    const out = capture(
      RlmEvent.CallStarted({ completionId, callId, depth: 0 }),
      { noColor: true }
    )
    expect(out).toBe("")
  })

  // --- Configurable truncation ---

  test("modelTruncateLimit truncates model text", () => {
    const longText = "a".repeat(300)
    const out = capture(
      RlmEvent.ModelResponse({ completionId, callId, depth: 0, text: longText }),
      { modelTruncateLimit: 50, noColor: true }
    )
    expect(out).toContain("...")
    // Should be roughly 50 chars of 'a' + "..." + newline
    expect(out.length).toBeLessThan(100)
  })

  test("outputTruncateLimit truncates output text", () => {
    const longOutput = "b".repeat(600)
    const out = capture(
      RlmEvent.CodeExecutionCompleted({ completionId, callId, depth: 0, output: longOutput }),
      { outputTruncateLimit: 100, noColor: true }
    )
    expect(out).toContain("...")
    expect(out.length).toBeLessThan(200)
  })

  // --- Structured errors ---

  test("BudgetExhaustedError renders structured fields", () => {
    const out = capture(
      RlmEvent.CallFailed({
        completionId,
        callId,
        depth: 0,
        error: new BudgetExhaustedError({
          resource: "iterations",
          remaining: 0,
          callId: CallId("x")
        })
      }),
      { noColor: true }
    )
    expect(out).toContain("resource=iterations")
    expect(out).toContain("remaining=0")
  })

  test("NoFinalAnswerError renders maxIterations", () => {
    const out = capture(
      RlmEvent.CallFailed({
        completionId,
        callId,
        depth: 0,
        error: new NoFinalAnswerError({
          maxIterations: 10,
          callId: CallId("x")
        })
      }),
      { noColor: true }
    )
    expect(out).toContain("maxIterations=10")
  })

  test("SandboxError renders message", () => {
    const out = capture(
      RlmEvent.CallFailed({
        completionId,
        callId,
        depth: 0,
        error: new SandboxError({ message: "boom" })
      }),
      { noColor: true }
    )
    expect(out).toContain("boom")
  })

  test("UnknownRlmError renders cause", () => {
    const out = capture(
      RlmEvent.CallFailed({
        completionId,
        callId,
        depth: 0,
        error: new UnknownRlmError({ message: "oops", cause: new Error("root") })
      }),
      { noColor: true }
    )
    expect(out).toContain("oops")
    expect(out).toContain("root")
  })

  test("OutputValidationError renders raw field", () => {
    const out = capture(
      RlmEvent.CallFailed({
        completionId,
        callId,
        depth: 0,
        error: new OutputValidationError({ message: "bad json", raw: "{invalid" })
      }),
      { noColor: true }
    )
    expect(out).toContain("raw=")
    expect(out).toContain("bad json")
  })

  test("CallStateMissingError renders callId", () => {
    const out = capture(
      RlmEvent.CallFailed({
        completionId,
        callId,
        depth: 0,
        error: new CallStateMissingError({ callId: CallId("missing-id") })
      }),
      { noColor: true }
    )
    expect(out).toContain("callId=missing-id")
  })

  // --- Warning metadata ---

  test("SchedulerWarning renders metadata", () => {
    const out = capture(
      RlmEvent.SchedulerWarning({
        completionId,
        code: "STALE_COMMAND_DROPPED",
        message: "Dropped stale command",
        callId: CallId("abc"),
        commandTag: "GenerateStep"
      }),
      { noColor: true }
    )
    expect(out).toContain("STALE_COMMAND_DROPPED")
    expect(out).toContain("call=abc")
    expect(out).toContain("cmd=GenerateStep")
  })

  // --- Backward-compat wrapper ---

  test("renderEvent writes same string as formatEvent", () => {
    const event = RlmEvent.CallFinalized({
      completionId,
      callId,
      depth: 0,
      answer: "test"
    })
    const opts: RenderOptions = { noColor: true }
    let captured = ""
    renderEvent(event, { write: (s) => { captured += s } }, opts)
    expect(captured).toBe(formatEvent(event, opts))
  })
})

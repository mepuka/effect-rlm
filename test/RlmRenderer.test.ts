import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import { renderEvent, type RenderOptions } from "../src/RlmRenderer"
import { BudgetState, CallId, RlmEvent } from "../src/RlmTypes"
import { SandboxError } from "../src/RlmError"

const capture = (event: Parameters<typeof renderEvent>[0], options?: RenderOptions) => {
  let output = ""
  renderEvent(event, { write: (s) => { output += s } }, options)
  return output
}

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
    expect(out).toContain("Iteration 2")
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

  test("CodeExecutionStarted renders yellow marker", () => {
    const out = capture(
      RlmEvent.CodeExecutionStarted({ completionId, callId, depth: 0, code: "print(1)" }),
      { noColor: true }
    )
    expect(out).toContain("> Executing code...")
  })

  test("CodeExecutionCompleted renders output", () => {
    const out = capture(
      RlmEvent.CodeExecutionCompleted({ completionId, callId, depth: 0, output: "42" }),
      { noColor: true }
    )
    expect(out).toContain("< Output: 42")
  })

  test("BridgeCallReceived renders method", () => {
    const out = capture(
      RlmEvent.BridgeCallReceived({ completionId, callId, depth: 0, method: "llm_query" }),
      { noColor: true }
    )
    expect(out).toContain("Bridge: llm_query")
  })

  test("CallFinalized renders answer", () => {
    const out = capture(
      RlmEvent.CallFinalized({ completionId, callId, depth: 0, answer: "The answer is 42" }),
      { noColor: true }
    )
    expect(out).toContain("FINAL: The answer is 42")
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
    expect(out).toContain("FAILED: SandboxError: boom")
  })

  test("SchedulerWarning renders message", () => {
    const out = capture(
      RlmEvent.SchedulerWarning({
        completionId,
        code: "QUEUE_CLOSED",
        message: "Queue was closed"
      }),
      { noColor: true }
    )
    expect(out).toContain("WARN: Queue was closed")
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
    expect(finalOut).toContain("FINAL: done")

    const failOut = capture(
      RlmEvent.CallFailed({
        completionId,
        callId,
        depth: 0,
        error: new SandboxError({ message: "err" })
      }),
      { quiet: true, noColor: true }
    )
    expect(failOut).toContain("FAILED:")
  })

  test("depth indentation", () => {
    const out = capture(
      RlmEvent.CallFinalized({ completionId, callId, depth: 2, answer: "nested" }),
      { noColor: true }
    )
    expect(out).toStartWith("    FINAL:")
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
})

import { describe, expect, test } from "bun:test"
import { buildReplSystemPrompt, buildOneShotSystemPrompt } from "./SystemPrompt"

describe("SystemPrompt", () => {
  const baseOptions = {
    depth: 0,
    iteration: 1,
    maxIterations: 10,
    maxDepth: 1,
    budget: { iterationsRemaining: 9, llmCallsRemaining: 19 }
  }

  test("REPL prompt contains FINAL instruction", () => {
    const prompt = buildReplSystemPrompt(baseOptions)
    expect(prompt).toContain("FINAL")
  })

  test("REPL prompt contains llm_query when depth < maxDepth", () => {
    const prompt = buildReplSystemPrompt({ ...baseOptions, depth: 0, maxDepth: 1 })
    expect(prompt).toContain("llm_query")
  })

  test("REPL prompt omits llm_query when depth >= maxDepth", () => {
    const prompt = buildReplSystemPrompt({ ...baseOptions, depth: 1, maxDepth: 1 })
    expect(prompt).not.toContain("llm_query")
  })

  test("REPL prompt contains budget numbers", () => {
    const prompt = buildReplSystemPrompt(baseOptions)
    expect(prompt).toContain("Iterations remaining: 9")
    expect(prompt).toContain("LLM calls remaining: 19")
  })

  test("REPL prompt instructs to access __vars.context and __vars.query", () => {
    const prompt = buildReplSystemPrompt(baseOptions)
    expect(prompt).toContain("__vars.context")
    expect(prompt).toContain("__vars.query")
  })

  test("REPL prompt does NOT contain actual context content", () => {
    const prompt = buildReplSystemPrompt(baseOptions)
    expect(prompt).not.toContain("some actual user context data")
  })

  test("one-shot prompt does NOT mention FINAL or code blocks", () => {
    const prompt = buildOneShotSystemPrompt()
    expect(prompt).not.toContain("```")
    expect(prompt).toContain("Do not use code blocks, FINAL()")
  })
})

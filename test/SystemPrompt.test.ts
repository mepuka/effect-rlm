import { describe, expect, test } from "bun:test"
import { buildReplSystemPrompt, buildOneShotSystemPrompt } from "../src/SystemPrompt"

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

  test("REPL prompt includes tool documentation when tools provided", () => {
    const prompt = buildReplSystemPrompt({
      ...baseOptions,
      tools: [{
        name: "search",
        description: "Search the web",
        parameterNames: ["query", "maxResults"],
        parametersJsonSchema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number" } } },
        returnsJsonSchema: { type: "array" }
      }]
    })
    expect(prompt).toContain("## Available Tools")
    expect(prompt).toContain("search(query, maxResults)")
    expect(prompt).toContain("Search the web")
  })

  test("REPL prompt omits tool section when no tools", () => {
    const prompt = buildReplSystemPrompt(baseOptions)
    expect(prompt).not.toContain("## Available Tools")
  })

  test("REPL prompt includes output format when outputJsonSchema provided", () => {
    const prompt = buildReplSystemPrompt({
      ...baseOptions,
      outputJsonSchema: { type: "object", properties: { answer: { type: "number" } } }
    })
    expect(prompt).toContain("## Output Format")
    expect(prompt).toContain("valid JSON matching this schema")
    expect(prompt).toContain('"answer"')
  })

  test("REPL prompt omits output format when no outputJsonSchema", () => {
    const prompt = buildReplSystemPrompt(baseOptions)
    expect(prompt).not.toContain("## Output Format")
  })

  test("strict mode suppresses llm_query even when depth < maxDepth", () => {
    const prompt = buildReplSystemPrompt({ ...baseOptions, depth: 0, maxDepth: 1, sandboxMode: "strict" })
    expect(prompt).not.toContain("llm_query")
    expect(prompt).not.toContain("## Recursive Sub-calls")
  })

  test("strict mode suppresses tools section", () => {
    const prompt = buildReplSystemPrompt({
      ...baseOptions,
      sandboxMode: "strict",
      tools: [{
        name: "search",
        description: "Search the web",
        parameterNames: ["query"],
        parametersJsonSchema: { type: "object" },
        returnsJsonSchema: { type: "array" }
      }]
    })
    expect(prompt).not.toContain("## Available Tools")
    expect(prompt).not.toContain("search")
  })
})

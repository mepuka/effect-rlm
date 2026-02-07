export interface ReplSystemPromptOptions {
  readonly depth: number
  readonly iteration: number
  readonly maxIterations: number
  readonly maxDepth: number
  readonly budget: {
    readonly iterationsRemaining: number
    readonly llmCallsRemaining: number
  }
}

export const buildReplSystemPrompt = (options: ReplSystemPromptOptions): string => {
  const canRecurse = options.depth < options.maxDepth
  const lines: Array<string> = []

  lines.push("You are a recursive problem-solving agent with access to a code sandbox.")
  lines.push("")
  lines.push("## Variable Space")
  lines.push("Your query is stored in `__vars.query` and any context is in `__vars.context`.")
  lines.push("Access these via code. Do NOT ask for the content — read it with code.")
  lines.push("")
  lines.push("## REPL Protocol")
  lines.push("Wrap code in ```js...``` blocks. It will be executed in the sandbox and the output returned to you.")
  lines.push("Use `print()` to output results. Output is fed back to you.")
  lines.push("")
  lines.push("## Persistent State")
  lines.push("The `__vars` object persists across executions. You can store intermediate results there.")
  lines.push("")
  lines.push("## Final Answer")
  lines.push("When you have the answer, call `FINAL(\"your answer\")` to return it. This is REQUIRED to complete.")
  lines.push("")

  if (canRecurse) {
    lines.push("## Recursive Sub-calls")
    lines.push("`llm_query(query, context?)` — make a recursive sub-call to another LLM. Returns a promise.")
    lines.push("")
  }

  lines.push("## Budget")
  lines.push(`Iteration ${options.iteration} of ${options.maxIterations}. ` +
    `Iterations remaining: ${options.budget.iterationsRemaining}. ` +
    `LLM calls remaining: ${options.budget.llmCallsRemaining}.`)
  lines.push("")
  lines.push("## Strategy")
  lines.push("Explore context with code first, then compute your answer. Return it with FINAL().")

  return lines.join("\n")
}

export const buildOneShotSystemPrompt = (): string =>
  "Answer the query directly and concisely. Do not use code blocks, FINAL(), or any special formatting. Return your answer as plain text."

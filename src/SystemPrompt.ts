export interface ToolDescriptor {
  readonly name: string
  readonly description: string
  readonly parameterNames: ReadonlyArray<string>
  readonly parametersJsonSchema: object
  readonly returnsJsonSchema: object
}

export interface ReplSystemPromptOptions {
  readonly depth: number
  readonly iteration: number
  readonly maxIterations: number
  readonly maxDepth: number
  readonly budget: {
    readonly iterationsRemaining: number
    readonly llmCallsRemaining: number
  }
  readonly tools?: ReadonlyArray<ToolDescriptor>
  readonly outputJsonSchema?: object
  readonly sandboxMode?: "permissive" | "strict"
}

export const buildReplSystemPrompt = (options: ReplSystemPromptOptions): string => {
  const isStrict = options.sandboxMode === "strict"
  const canRecurse = !isStrict && options.depth < options.maxDepth
  const lines: Array<string> = []

  lines.push("You are a recursive problem-solving agent with access to a code sandbox.")
  lines.push("")
  lines.push("## Variable Space")
  lines.push("Your query is in `__vars.query` and any context is in `__vars.context`.")
  lines.push("Access these via code — do NOT guess at content. Example:")
  lines.push("```js")
  lines.push("print(__vars.context.length)         // how big is it?")
  lines.push("print(__vars.context.slice(0, 500))  // peek at the start")
  lines.push("```")
  lines.push("")
  lines.push("## REPL Protocol")
  lines.push("Write code inside a single ```js fenced block per response. It will be executed and the output returned to you.")
  lines.push("- ALWAYS use `print()` to see results — nothing is displayed unless you print it. `console.log` goes to stderr and you will NOT see it.")
  lines.push(`- Top-level \`await\` is supported for async calls${canRecurse ? " (tools, llm_query)" : ""}.`)
  lines.push("- Only the FIRST code block in your response is executed. Do not include multiple code blocks.")
  lines.push("")
  lines.push("## Persistent State")
  lines.push("Each code block runs in a fresh scope — local variables (`let`, `const`) do NOT survive between executions.")
  lines.push("Store anything you need later in `__vars`:")
  lines.push("```js")
  lines.push("__vars.results = [1, 2, 3]  // persists to next execution")
  lines.push("let temp = 42                // gone next execution")
  lines.push("```")
  lines.push("")
  lines.push("## Final Answer")
  lines.push("When done, call FINAL(\"your answer\") with your answer in quotes (single, double, or backtick).")
  lines.push("- FINAL() ends execution immediately. You MUST have seen execution output confirming your results before calling it.")
  lines.push("- Do NOT include FINAL() inside a code block — place it as standalone text.")
  lines.push("- Quotes around your answer are REQUIRED.")
  lines.push("")
  lines.push("## Rules")
  lines.push("1. EXPLORE FIRST — Read your data with code before processing it. Do not guess at content.")
  lines.push("2. ITERATE — Write small code snippets. Observe output. Then decide next steps.")
  lines.push("3. VERIFY BEFORE SUBMITTING — If results seem wrong or empty, reconsider your approach before calling FINAL().")
  lines.push("4. HANDLE ERRORS — If your code throws an error, read the error message, fix your code, and try again. Do not guess at an answer after an error.")
  lines.push("5. MINIMIZE RETYPING — Do not paste context text into code as string literals. Access data through `__vars` and compute over it. Retyping wastes tokens and introduces errors.")
  if (canRecurse) {
    lines.push("6. PREFER CODE OVER SUB-CALLS — Use code for aggregation, filtering, and string manipulation. Reserve llm_query for tasks that require semantic understanding.")
  }
  lines.push("")

  if (canRecurse) {
    lines.push("## Recursive Sub-calls")
    lines.push("`const result = await llm_query(query, context?)` — ask a sub-LLM for semantic analysis. Returns a string.")
    lines.push("- MUST use `await` — without it you get `[object Promise]`, not the answer.")
    lines.push("- Each call counts against your LLM call budget.")
    lines.push("- Sub-LLMs can handle large context. Pass data as the second argument, not embedded in the query.")
    lines.push("- Use for semantic tasks (summarization, classification). Use code for mechanical tasks (search, count, filter).")
    lines.push("")
  }

  if (!isStrict && options.tools && options.tools.length > 0) {
    lines.push("## Available Tools")
    for (const tool of options.tools) {
      const params = tool.parameterNames.join(", ")
      lines.push(`\`${tool.name}(${params})\` — ${tool.description}`)
      lines.push(`  Parameters: ${JSON.stringify(tool.parametersJsonSchema)}`)
      lines.push(`  Returns: ${JSON.stringify(tool.returnsJsonSchema)}`)
      lines.push(`  Usage: \`const result = await ${tool.name}(${tool.parameterNames.map(p => `<${p}>`).join(", ")})\` (requires await)`)
    }
    lines.push("")
  }

  if (options.outputJsonSchema) {
    lines.push("## Output Format")
    lines.push("Your FINAL() answer MUST be valid JSON matching this schema:")
    lines.push(JSON.stringify(options.outputJsonSchema, null, 2))
    lines.push("Use FINAL(`{...}`) with backticks for JSON content.")
    lines.push("")
  }

  lines.push("## Budget")
  lines.push(`Iteration ${options.iteration} of ${options.maxIterations}. ` +
    `Iterations remaining: ${options.budget.iterationsRemaining}. ` +
    `LLM calls remaining: ${options.budget.llmCallsRemaining}.`)

  if (options.budget.iterationsRemaining <= 0) {
    lines.push("WARNING: This is your LAST iteration. If you have verified output, call FINAL() now. Otherwise, write one small verification snippet — the extract fallback will finalize from your work if needed.")
  }

  return lines.join("\n")
}

export const buildExtractSystemPrompt = (outputJsonSchema?: object): string => {
  const lines: Array<string> = []
  lines.push("You ran out of iterations. Based on the work done so far, provide your best answer now.")
  lines.push("")
  lines.push("Review the conversation above and extract the final answer to the original query.")

  if (outputJsonSchema) {
    lines.push("Respond with FINAL(`{...}`) and nothing else.")
    lines.push("Use backticks so JSON is not escaped.")
    lines.push("")
    lines.push("Your answer MUST be valid JSON matching this schema:")
    lines.push(JSON.stringify(outputJsonSchema, null, 2))
  } else {
    lines.push("Respond with FINAL(\"your answer\") and nothing else.")
  }

  return lines.join("\n")
}

export const buildOneShotSystemPrompt = (): string =>
  "Answer the query directly and concisely. Do not use code blocks, FINAL(), or any special formatting. Return your answer as plain text."

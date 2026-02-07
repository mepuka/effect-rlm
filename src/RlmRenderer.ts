import type { RlmEvent } from "./RlmTypes"

export interface RenderOptions {
  readonly quiet?: boolean
  readonly showCode?: boolean
  readonly showOutput?: boolean
  readonly noColor?: boolean
}

const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const MAGENTA = "\x1b[35m"

const c = (code: string, text: string, noColor?: boolean) =>
  noColor ? text : `${code}${text}${RESET}`

const indent = (depth: number) => "  ".repeat(depth)

export const renderEvent = (
  event: RlmEvent,
  out: { write: (s: string) => void },
  options?: RenderOptions
): void => {
  const nc = options?.noColor
  const quiet = options?.quiet ?? false
  const showCode = options?.showCode ?? true
  const showOutput = options?.showOutput ?? true

  switch (event._tag) {
    case "IterationStarted": {
      if (quiet) return
      const budget = event.budget
      out.write(
        `${indent(event.depth)}${c(DIM, `--- Iteration ${event.iteration} --- (budget: ${budget.iterationsRemaining}i, ${budget.llmCallsRemaining}c)`, nc)}\n`
      )
      return
    }

    case "ModelResponse": {
      if (quiet) return
      const truncated = event.text.length > 200
        ? event.text.slice(0, 200) + "..."
        : event.text
      out.write(`${indent(event.depth)}${c(DIM, truncated, nc)}\n`)
      return
    }

    case "CodeExecutionStarted": {
      if (quiet || !showCode) return
      out.write(`${indent(event.depth)}${c(YELLOW, "> Executing code...", nc)}\n`)
      return
    }

    case "CodeExecutionCompleted": {
      if (quiet || !showOutput) return
      const truncatedOutput = event.output.length > 500
        ? event.output.slice(0, 500) + "..."
        : event.output
      out.write(`${indent(event.depth)}${c(GREEN, `< Output: ${truncatedOutput}`, nc)}\n`)
      return
    }

    case "BridgeCallReceived": {
      if (quiet) return
      out.write(`${indent(event.depth)}${c(MAGENTA, `Bridge: ${event.method}`, nc)}\n`)
      return
    }

    case "CallFinalized": {
      const truncatedAnswer = event.answer.length > 200
        ? event.answer.slice(0, 200) + "..."
        : event.answer
      out.write(`${indent(event.depth)}${c(BOLD + GREEN, `FINAL: ${truncatedAnswer}`, nc)}\n`)
      return
    }

    case "CallFailed": {
      const err = event.error
      out.write(
        `${indent(event.depth)}${c(RED, `FAILED: ${err._tag}: ${"message" in err ? err.message : ""}`, nc)}\n`
      )
      return
    }

    case "SchedulerWarning": {
      if (quiet) return
      out.write(`${c(YELLOW, `WARN: ${event.message}`, nc)}\n`)
      return
    }

    case "CallStarted": {
      if (quiet) return
      return
    }
  }
}

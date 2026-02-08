import * as Doc from "@effect/printer/Doc"
import * as Ansi from "@effect/printer-ansi/Ansi"
import * as AnsiDoc from "@effect/printer-ansi/AnsiDoc"
import { Cause, Match } from "effect"
import type { RlmError } from "./RlmError"
import type { RlmEvent } from "./RlmTypes"

// ---------------------------------------------------------------------------
// Annotation type
// ---------------------------------------------------------------------------

type Annotation =
  | "iteration"
  | "model"
  | "code"
  | "output"
  | "error"
  | "error-detail"
  | "final"
  | "bridge"
  | "warning"
  | "dim"

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const theme = (annotation: Annotation): Ansi.Ansi => {
  switch (annotation) {
    case "iteration": return Ansi.cyan
    case "model": return Ansi.blackBright
    case "code": return Ansi.yellow
    case "output": return Ansi.green
    case "error": return Ansi.red
    case "error-detail": return Ansi.blackBright
    case "final": return Ansi.combine(Ansi.bold, Ansi.green)
    case "bridge": return Ansi.magenta
    case "warning": return Ansi.yellow
    case "dim": return Ansi.blackBright
  }
}

// ---------------------------------------------------------------------------
// RenderOptions
// ---------------------------------------------------------------------------

export interface RenderOptions {
  readonly quiet?: boolean
  readonly showCode?: boolean
  readonly showOutput?: boolean
  readonly noColor?: boolean
  readonly lineWidth?: number
  readonly modelTruncateLimit?: number
  readonly outputTruncateLimit?: number
  readonly finalTruncateLimit?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_TRUNCATE = 200
const DEFAULT_OUTPUT_TRUNCATE = 500
const DEFAULT_FINAL_TRUNCATE = 200

const truncate = (s: string, limit: number): string =>
  s.length > limit ? s.slice(0, limit) + "..." : s

const styled = (ann: Annotation, content: string): Doc.Doc<Annotation> =>
  Doc.annotate(Doc.text(content), ann)

const withDepth = (depth: number, doc: Doc.Doc<Annotation>): Doc.Doc<Annotation> =>
  depth > 0 ? Doc.indent(doc, depth * 2) : doc

// ---------------------------------------------------------------------------
// Token usage
// ---------------------------------------------------------------------------

const usageDoc = (usage?: {
  readonly totalTokens?: number | undefined
  readonly inputTokens?: number | undefined
  readonly outputTokens?: number | undefined
}): Doc.Doc<Annotation> => {
  if (!usage) return Doc.empty
  const fromTotal = usage.totalTokens !== undefined && usage.totalTokens > 0
    ? usage.totalTokens
    : undefined
  const fromParts = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
  const total = fromTotal ?? (fromParts > 0 ? fromParts : undefined)
  if (total === undefined) return Doc.empty
  return styled("dim", ` (${total} tok)`)
}

// ---------------------------------------------------------------------------
// Structured error rendering
// ---------------------------------------------------------------------------

const formatError = (err: RlmError): Doc.Doc<Annotation> => {
  const header = styled("error", `✗ FAILED: ${err._tag}`)

  const details: Array<string> = []
  switch (err._tag) {
    case "BudgetExhaustedError":
      details.push(`resource=${err.resource}, remaining=${err.remaining}`)
      break
    case "NoFinalAnswerError":
      details.push(`maxIterations=${err.maxIterations}`)
      break
    case "SandboxError":
      if (err.message) details.push(err.message)
      break
    case "UnknownRlmError":
      if (err.message) details.push(err.message)
      break
    case "OutputValidationError":
      if (err.message) details.push(err.message)
      details.push(`raw=${truncate(err.raw, 100)}`)
      break
    case "CallStateMissingError":
      details.push(`callId=${err.callId}`)
      break
  }

  const detailDoc = details.length > 0
    ? Doc.cat(styled("error", ": "), styled("error", details.join(", ")))
    : Doc.empty

  let causeDoc: Doc.Doc<Annotation> = Doc.empty
  if ("cause" in err && err.cause != null) {
    const causeText = Cause.isCause(err.cause)
      ? Cause.pretty(err.cause)
      : String(err.cause)
    const causeLines = causeText.split("\n")
    const truncatedLines = causeLines.length > 10
      ? [...causeLines.slice(0, 10), `... (${causeLines.length - 10} more lines)`]
      : causeLines
    causeDoc = Doc.cats(
      truncatedLines.map((line) => Doc.cat(Doc.hardLine, styled("error-detail", `  ${line}`)))
    )
  }

  return Doc.cats([header, detailDoc, causeDoc])
}

// ---------------------------------------------------------------------------
// Scheduler warning
// ---------------------------------------------------------------------------

const schedulerWarningDoc = (
  e: Extract<RlmEvent, { _tag: "SchedulerWarning" }>,
  opts: RenderOptions
): Doc.Doc<Annotation> => {
  if (opts.quiet) return Doc.empty
  const meta: Array<string> = []
  if (e.callId !== undefined) meta.push(`call=${e.callId}`)
  if (e.commandTag !== undefined) meta.push(`cmd=${e.commandTag}`)
  const suffix = meta.length > 0 ? ` [${meta.join(", ")}]` : ""
  return styled("warning", `⚠ ${e.code}: ${e.message}${suffix}`)
}

// ---------------------------------------------------------------------------
// Per-event document builder
// ---------------------------------------------------------------------------

export const buildEventDoc = (event: RlmEvent, options?: RenderOptions): Doc.Doc<Annotation> => {
  const opts: RenderOptions = {
    quiet: false,
    showCode: true,
    showOutput: true,
    noColor: false,
    ...options
  }
  const modelLimit = opts.modelTruncateLimit ?? DEFAULT_MODEL_TRUNCATE
  const outputLimit = opts.outputTruncateLimit ?? DEFAULT_OUTPUT_TRUNCATE
  const finalLimit = opts.finalTruncateLimit ?? DEFAULT_FINAL_TRUNCATE

  return Match.value(event).pipe(
    Match.tagsExhaustive({
      CallStarted: () => Doc.empty as Doc.Doc<Annotation>,

      IterationStarted: (e) => {
        if (opts.quiet) return Doc.empty as Doc.Doc<Annotation>
        const counter = styled("iteration", `[${e.iteration}] ─── Iteration ───`)
        const budget = styled("dim", ` (${e.budget.iterationsRemaining}i ${e.budget.llmCallsRemaining}c)`)
        return withDepth(e.depth, Doc.cat(counter, budget))
      },

      ModelResponse: (e) => {
        if (opts.quiet) return Doc.empty as Doc.Doc<Annotation>
        const text = styled("model", truncate(e.text, modelLimit))
        const usage = usageDoc(e.usage)
        return withDepth(e.depth, Doc.cat(text, usage))
      },

      CodeExecutionStarted: (e) => {
        if (opts.quiet || !opts.showCode) return Doc.empty as Doc.Doc<Annotation>
        return withDepth(e.depth, styled("code", "▶ Executing..."))
      },

      CodeExecutionCompleted: (e) => {
        if (opts.quiet || !opts.showOutput) return Doc.empty as Doc.Doc<Annotation>
        return withDepth(
          e.depth,
          styled("output", `◀ Output: ${truncate(e.output, outputLimit)}`)
        )
      },

      BridgeCallReceived: (e) => {
        if (opts.quiet) return Doc.empty as Doc.Doc<Annotation>
        return withDepth(e.depth, styled("bridge", `↗ Bridge: ${e.method}`))
      },

      CallFinalized: (e) =>
        withDepth(
          e.depth,
          styled("final", `✓ FINAL: ${truncate(e.answer, finalLimit)}`)
        ),

      CallFailed: (e) => withDepth(e.depth, formatError(e.error)),

      SchedulerWarning: (e) => schedulerWarningDoc(e, opts)
    })
  )
}

// ---------------------------------------------------------------------------
// Rendering pipeline
// ---------------------------------------------------------------------------

export const formatEvent = (event: RlmEvent, options?: RenderOptions): string => {
  const doc = buildEventDoc(event, options)
  if (Doc.isEmpty(doc)) return ""
  const lineWidth = options?.lineWidth ?? 120
  if (options?.noColor) {
    return Doc.render(Doc.unAnnotate(doc), { style: "pretty", options: { lineWidth } }) + "\n"
  }
  return AnsiDoc.render(Doc.reAnnotate(doc, theme), { style: "pretty", options: { lineWidth } }) + "\n"
}

// ---------------------------------------------------------------------------
// Backward-compatible wrapper
// ---------------------------------------------------------------------------

export const renderEvent = (
  event: RlmEvent,
  out: { write: (s: string) => void },
  options?: RenderOptions
): void => {
  const formatted = formatEvent(event, options)
  if (formatted) out.write(formatted)
}

import type * as LanguageModel from "@effect/ai/LanguageModel"
import * as Tool from "@effect/ai/Tool"
import * as Toolkit from "@effect/ai/Toolkit"
import { Effect, JSONSchema, Schema } from "effect"

export const SUBMIT_TOOL_NAME = "SUBMIT" as const
export const SUBMIT_TOOL_DESCRIPTION = "Finalize the run with your verified answer."

const SubmitToolParameters = {
  answer: Schema.optional(
    Schema.String.annotations({
      description: "Plain-text final answer. Use when no structured output schema is requested.",
      examples: ["42", "Paris"]
    })
  ),
  value: Schema.optional(
    Schema.Unknown.annotations({
      description:
        "Structured final value. Use when a structured output schema is requested. Must be JSON-serializable and schema-compliant.",
      examples: [{ result: 42 }, ["item-1", "item-2"]]
    })
  )
}

const SubmitToolDefinition = Tool.make(SUBMIT_TOOL_NAME, {
  description: SUBMIT_TOOL_DESCRIPTION,
  parameters: {
    ...SubmitToolParameters
  },
  success: Schema.Void
})

const SubmitToolParametersSchema = Schema.Struct(SubmitToolParameters).annotations({
  description: "Submit exactly one final payload: `answer` (plain text) or `value` (structured JSON)."
})

export const submitToolDescriptor = {
  name: SUBMIT_TOOL_NAME,
  description: SUBMIT_TOOL_DESCRIPTION,
  parameterNames: ["answer", "value"] as const,
  parametersJsonSchema: JSONSchema.make(SubmitToolParametersSchema),
  returnsJsonSchema: JSONSchema.make(Schema.Void)
} as const

const SubmitToolkit = Toolkit.make(SubmitToolDefinition)

const SubmitHandlers = SubmitToolkit.of({
  SUBMIT: () => Effect.void
})

export const submitToolkit: Effect.Effect<
  Toolkit.WithHandler<{
    readonly SUBMIT: typeof SubmitToolDefinition
  }>
> = SubmitToolkit.pipe(
  Effect.provide(SubmitToolkit.toLayer(SubmitHandlers))
)

export interface SubmitAnswer {
  readonly answer: string
  readonly source: "answer" | "value"
}

const readSubmitAnswerFromParams = (params: unknown): SubmitAnswer | undefined => {
  if (typeof params !== "object" || params === null) return undefined

  const record = params as {
    readonly answer?: unknown
    readonly value?: unknown
  }

  if (typeof record.answer === "string") {
    return {
      answer: record.answer,
      source: "answer"
    }
  }

  if ("value" in record) {
    try {
      const encoded = JSON.stringify(record.value)
      if (typeof encoded === "string") {
        return {
          answer: encoded,
          source: "value"
        }
      }
      return {
        answer: String(record.value),
        source: "value"
      }
    } catch {
      return {
        answer: String(record.value),
        source: "value"
      }
    }
  }

  return undefined
}

export const extractSubmitAnswer = (
  response: LanguageModel.GenerateTextResponse<any>
): SubmitAnswer | undefined => {
  for (const toolCall of response.toolCalls) {
    if (toolCall.name !== SUBMIT_TOOL_NAME) continue
    const parsed = readSubmitAnswerFromParams(toolCall.params)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

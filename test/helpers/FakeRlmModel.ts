import * as LanguageModel from "@effect/ai/LanguageModel"
import * as Response from "@effect/ai/Response"
import type * as Prompt from "@effect/ai/Prompt"
import { Effect, Layer } from "effect"
import { RlmModel } from "../../src/RlmModel"
import { UnknownRlmError } from "../../src/RlmError"

export interface FakeModelMetrics {
  calls: number
  readonly prompts: Array<Prompt.Prompt>
  readonly depths: Array<number>
}

export interface FakeModelResponse {
  readonly text: string
  readonly totalTokens?: number
}

const makeMinimalResponse = (text: string, totalTokens?: number) =>
  new LanguageModel.GenerateTextResponse<{}>([
    Response.makePart("text", { text }),
    Response.makePart("finish", {
      reason: "stop" as const,
      usage: new Response.Usage({
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens
      })
    })
  ])

export const makeFakeRlmModelLayer = (
  responses: ReadonlyArray<FakeModelResponse>,
  metrics?: FakeModelMetrics
): Layer.Layer<RlmModel> => {
  let index = 0

  return Layer.succeed(
    RlmModel,
    RlmModel.of({
      generateText: Effect.fn("FakeRlmModel.generateText")(function*({ prompt, depth }) {
        metrics?.prompts.push(prompt)
        metrics?.depths.push(depth)
        if (metrics) metrics.calls += 1

        const scripted = responses[index]
        index += 1

        if (scripted === undefined) {
          return yield* new UnknownRlmError({ message: "Fake model script exhausted" })
        }

        return makeMinimalResponse(scripted.text, scripted.totalTokens)
      })
    })
  )
}

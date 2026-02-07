import * as LanguageModel from "@effect/ai/LanguageModel"
import type * as Prompt from "@effect/ai/Prompt"
import { Context, Effect, Layer } from "effect"
import type { RlmError } from "./RlmError"
import { UnknownRlmError } from "./RlmError"

// --- Service interface ---

export interface RlmModelService {
  readonly generateText: (options: {
    readonly prompt: Prompt.Prompt
    readonly depth: number
  }) => Effect.Effect<LanguageModel.GenerateTextResponse<{}>, RlmError>
}

export class RlmModel extends Context.Tag("@recursive-llm/RlmModel")<
  RlmModel,
  RlmModelService
>() {}

// --- Layer constructor ---

export const makeRlmModelLayer = <R>(options: {
  readonly primary: Effect.Effect<LanguageModel.Service, never, R>
  readonly sub?: Effect.Effect<LanguageModel.Service, never, R>
  readonly depthThreshold?: number
}): Layer.Layer<RlmModel, never, R> =>
  Layer.effect(RlmModel, Effect.gen(function*() {
    const primaryLm = yield* options.primary
    const subLm = options.sub ? yield* options.sub : primaryLm
    const threshold = options.depthThreshold ?? 1

    return RlmModel.of({
      generateText: ({ prompt, depth }) => {
        const lm = depth >= threshold ? subLm : primaryLm
        return lm.generateText({ prompt }).pipe(
          Effect.mapError((err) =>
            new UnknownRlmError({ message: `Model error: ${err}`, cause: err })
          )
        )
      }
    })
  }))

// --- Provider convenience constructors ---

import * as AnthropicLanguageModel from "@effect/ai-anthropic/AnthropicLanguageModel"
import type { AnthropicClient } from "@effect/ai-anthropic/AnthropicClient"
import * as GoogleLanguageModel from "@effect/ai-google/GoogleLanguageModel"
import type { GoogleClient } from "@effect/ai-google/GoogleClient"

export const makeAnthropicRlmModel = (options: {
  readonly primaryModel: string
  readonly primaryConfig?: Omit<AnthropicLanguageModel.Config.Service, "model">
  readonly subModel?: string
  readonly subConfig?: Omit<AnthropicLanguageModel.Config.Service, "model">
  readonly depthThreshold?: number
}): Layer.Layer<RlmModel, never, AnthropicClient> =>
  makeRlmModelLayer({
    primary: AnthropicLanguageModel.make({
      model: options.primaryModel,
      ...(options.primaryConfig !== undefined
        ? { config: options.primaryConfig }
        : {})
    }),
    ...(options.subModel !== undefined
      ? {
          sub: AnthropicLanguageModel.make({
            model: options.subModel,
            ...((options.subConfig ?? options.primaryConfig) !== undefined
              ? { config: (options.subConfig ?? options.primaryConfig)! }
              : {})
          })
        }
      : {}),
    ...(options.depthThreshold !== undefined
      ? { depthThreshold: options.depthThreshold }
      : {})
  })

export const makeGoogleRlmModel = (options: {
  readonly primaryModel: string
  readonly primaryConfig?: Omit<GoogleLanguageModel.Config.Service, "model">
  readonly subModel?: string
  readonly subConfig?: Omit<GoogleLanguageModel.Config.Service, "model">
  readonly depthThreshold?: number
}): Layer.Layer<RlmModel, never, GoogleClient> =>
  makeRlmModelLayer({
    primary: GoogleLanguageModel.make({
      model: options.primaryModel,
      ...(options.primaryConfig !== undefined
        ? { config: options.primaryConfig }
        : {})
    }),
    ...(options.subModel !== undefined
      ? {
          sub: GoogleLanguageModel.make({
            model: options.subModel,
            ...((options.subConfig ?? options.primaryConfig) !== undefined
              ? { config: (options.subConfig ?? options.primaryConfig)! }
              : {})
          })
        }
      : {}),
    ...(options.depthThreshold !== undefined
      ? { depthThreshold: options.depthThreshold }
      : {})
  })

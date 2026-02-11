import * as LanguageModel from "@effect/ai/LanguageModel"
import type * as Prompt from "@effect/ai/Prompt"
import * as AnthropicLanguageModel from "@effect/ai-anthropic/AnthropicLanguageModel"
import type { AnthropicClient } from "@effect/ai-anthropic/AnthropicClient"
import * as GoogleLanguageModel from "@effect/ai-google/GoogleLanguageModel"
import type { GoogleClient } from "@effect/ai-google/GoogleClient"
import * as OpenAiLanguageModel from "@effect/ai-openai/OpenAiLanguageModel"
import type { OpenAiClient } from "@effect/ai-openai/OpenAiClient"
import { Context, Effect, Layer } from "effect"
import type { RlmModelTarget } from "./RlmConfig"
import type { RlmError } from "./RlmError"
import { UnknownRlmError } from "./RlmError"

// --- Service interface ---

export interface RlmModelService {
  readonly generateText: (options: {
    readonly prompt: Prompt.Prompt
    readonly depth: number
    readonly isSubCall?: boolean
    readonly namedModel?: string
    readonly routeSource?: "named" | "sub" | "primary"
    readonly toolkit?: LanguageModel.GenerateTextOptions<any>["toolkit"]
    readonly toolChoice?: LanguageModel.GenerateTextOptions<any>["toolChoice"]
    readonly disableToolCallResolution?: boolean
    readonly concurrency?: LanguageModel.GenerateTextOptions<any>["concurrency"]
  }) => Effect.Effect<LanguageModel.GenerateTextResponse<any>, RlmError>
}

export class RlmModel extends Context.Tag("@recursive-llm/RlmModel")<
  RlmModel,
  RlmModelService
>() {}

export interface SubLlmDelegationOptions {
  readonly enabled: boolean
  readonly depthThreshold: number
}

// --- Layer constructor ---

export const makeRlmModelLayer = <RPrimary, RSub = never, RNamed = never>(options: {
  readonly primary: Effect.Effect<LanguageModel.Service, never, RPrimary>
  readonly sub?: Effect.Effect<LanguageModel.Service, never, RSub>
  readonly named?: Record<string, Effect.Effect<LanguageModel.Service, never, RNamed>>
  readonly subLlmDelegation?: SubLlmDelegationOptions
}): Layer.Layer<RlmModel, never, RPrimary | RSub | RNamed> =>
  Layer.effect(RlmModel, Effect.gen(function*() {
    const primaryLm = yield* options.primary
    const hasSubModel = options.sub !== undefined
    const subLm = hasSubModel ? yield* options.sub! : primaryLm
    const namedEntries = options.named !== undefined
      ? Object.entries(options.named)
      : []
    const namedModels = new Map<string, LanguageModel.Service>()

    for (const [name, modelEffect] of namedEntries) {
      namedModels.set(name, yield* modelEffect)
    }

    const subLlmDelegation: SubLlmDelegationOptions = options.subLlmDelegation ?? {
      enabled: hasSubModel,
      depthThreshold: 1
    }

    return RlmModel.of({
      generateText: ({ prompt, depth, isSubCall, namedModel, toolkit, toolChoice, disableToolCallResolution, concurrency }) => {
        let lm: LanguageModel.Service
        if (namedModel !== undefined) {
          const named = namedModels.get(namedModel)
          if (named === undefined) {
            return new UnknownRlmError({
              message: `Unknown named model "${namedModel}". Available: ${[...namedModels.keys()].join(", ") || "(none)"}`
            })
          }
          lm = named
        } else {
          const useSubModel =
            hasSubModel &&
            subLlmDelegation.enabled &&
            isSubCall === true &&
            depth >= subLlmDelegation.depthThreshold

          lm = useSubModel ? subLm : primaryLm
        }

        return lm.generateText({
          prompt,
          ...(toolkit !== undefined ? { toolkit } : {}),
          ...(toolChoice !== undefined ? { toolChoice } : {}),
          ...(disableToolCallResolution !== undefined
            ? { disableToolCallResolution }
            : {}),
          ...(concurrency !== undefined ? { concurrency } : {})
        }).pipe(
          Effect.mapError((err) =>
            new UnknownRlmError({ message: `Model error: ${err}`, cause: err })
          )
        )
      }
    })
  }))

// --- Provider convenience constructors ---

export const makeAnthropicRlmModel = (options: {
  readonly primaryModel: string
  readonly primaryConfig?: Omit<AnthropicLanguageModel.Config.Service, "model">
  readonly subModel?: string
  readonly subConfig?: Omit<AnthropicLanguageModel.Config.Service, "model">
  readonly namedModels?: Record<string, RlmModelTarget>
  readonly subLlmDelegation?: SubLlmDelegationOptions
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
    ...(options.namedModels !== undefined
      ? {
          named: Object.fromEntries(
            Object.entries(options.namedModels)
              .filter(([, target]) => target.provider === "anthropic")
              .map(([name, target]) => [
                name,
                AnthropicLanguageModel.make({
                  model: target.model
                })
              ])
          )
        }
      : {}),
    ...(options.subLlmDelegation !== undefined
      ? { subLlmDelegation: options.subLlmDelegation }
      : {})
  })

export const makeGoogleRlmModel = (options: {
  readonly primaryModel: string
  readonly primaryConfig?: Omit<GoogleLanguageModel.Config.Service, "model">
  readonly subModel?: string
  readonly subConfig?: Omit<GoogleLanguageModel.Config.Service, "model">
  readonly namedModels?: Record<string, RlmModelTarget>
  readonly subLlmDelegation?: SubLlmDelegationOptions
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
    ...(options.namedModels !== undefined
      ? {
          named: Object.fromEntries(
            Object.entries(options.namedModels)
              .filter(([, target]) => target.provider === "google")
              .map(([name, target]) => [
                name,
                GoogleLanguageModel.make({
                  model: target.model
                })
              ])
          )
        }
      : {}),
    ...(options.subLlmDelegation !== undefined
      ? { subLlmDelegation: options.subLlmDelegation }
      : {})
  })

export const makeOpenAiRlmModel = (options: {
  readonly primaryModel: string
  readonly primaryConfig?: Omit<OpenAiLanguageModel.Config.Service, "model">
  readonly subModel?: string
  readonly subConfig?: Omit<OpenAiLanguageModel.Config.Service, "model">
  readonly namedModels?: Record<string, RlmModelTarget>
  readonly subLlmDelegation?: SubLlmDelegationOptions
}): Layer.Layer<RlmModel, never, OpenAiClient> =>
  makeRlmModelLayer({
    primary: OpenAiLanguageModel.make({
      model: options.primaryModel,
      ...(options.primaryConfig !== undefined
        ? { config: options.primaryConfig }
        : {})
    }),
    ...(options.subModel !== undefined
      ? {
          sub: OpenAiLanguageModel.make({
            model: options.subModel,
            ...((options.subConfig ?? options.primaryConfig) !== undefined
              ? { config: (options.subConfig ?? options.primaryConfig)! }
              : {})
          })
        }
      : {}),
    ...(options.namedModels !== undefined
      ? {
          named: Object.fromEntries(
            Object.entries(options.namedModels)
              .filter(([, target]) => target.provider === "openai")
              .map(([name, target]) => [
                name,
                OpenAiLanguageModel.make({
                  model: target.model
                })
              ])
          )
        }
      : {}),
    ...(options.subLlmDelegation !== undefined
      ? { subLlmDelegation: options.subLlmDelegation }
      : {})
  })

import { Effect, Layer } from "effect"
import { SandboxError } from "../../src/RlmError"
import { SandboxFactory } from "../../src/Sandbox"

export interface CustomSandboxMetrics {
  createCalls: number
  executeCalls: number
  readonly snippets: Array<string>
}

export interface CustomSandboxFactoryOptions {
  readonly execute: (code: string, callNumber: number) => Effect.Effect<string, unknown>
  readonly metrics?: CustomSandboxMetrics
}

export const makeCustomSandboxFactoryLayer = (
  options: CustomSandboxFactoryOptions
): Layer.Layer<SandboxFactory> =>
  Layer.succeed(
    SandboxFactory,
    SandboxFactory.of({
      create: () => {
        options.metrics && (options.metrics.createCalls += 1)
        let executeCalls = 0
        const vars = new Map<string, unknown>()

        return Effect.succeed({
          execute: (code: string) => {
            executeCalls += 1
            if (options.metrics) {
              options.metrics.executeCalls += 1
              options.metrics.snippets.push(code)
            }
            return options.execute(code, executeCalls) as Effect.Effect<string, SandboxError>
          },
          setVariable: (name: string, value: unknown) =>
            Effect.sync(() => {
              vars.set(name, value)
            }),
          getVariable: (name: string) => Effect.succeed(vars.get(name))
        })
      }
    })
  )

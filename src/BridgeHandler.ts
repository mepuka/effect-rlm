import { Clock, Context, Deferred, Duration, Effect, Exit, Layer, Option, Queue, Ref } from "effect"
import { SandboxError } from "./RlmError"
import { RlmConfig } from "./RlmConfig"
import { RlmRuntime } from "./Runtime"
import { BridgeRequestId, RlmCommand, type CallId } from "./RlmTypes"
import { BridgeStore } from "./scheduler/BridgeStore"

export class BridgeHandler extends Context.Tag("@recursive-llm/BridgeHandler")<
  BridgeHandler,
  {
    readonly handle: (options: {
      readonly method: string
      readonly args: ReadonlyArray<unknown>
      readonly callerCallId: CallId
    }) => Effect.Effect<unknown, SandboxError>
  }
>() {}

export const BridgeHandlerLive: Layer.Layer<BridgeHandler, never, RlmRuntime | BridgeStore | RlmConfig> = Layer.effect(
  BridgeHandler,
  Effect.gen(function*() {
    const runtime = yield* RlmRuntime
    const bridgeStore = yield* BridgeStore
    const config = yield* RlmConfig

    return BridgeHandler.of({
      handle: ({ method, args, callerCallId }) => {
        if (method === "budget") {
          return Effect.gen(function*() {
            const budget = yield* Ref.get(runtime.budgetRef)
            const now = yield* Clock.currentTimeMillis
            return {
              iterationsRemaining: budget.iterationsRemaining,
              llmCallsRemaining: budget.llmCallsRemaining,
              tokenBudgetRemaining: Option.isSome(budget.tokenBudgetRemaining)
                ? budget.tokenBudgetRemaining.value
                : null,
              totalTokensUsed: budget.totalTokensUsed,
              elapsedMs: now - runtime.completionStartedAtMs,
              maxTimeMs: config.maxTimeMs ?? null
            }
          })
        }

        const bridgeRequestId = BridgeRequestId(crypto.randomUUID())

        return Effect.gen(function*() {
          const deferred = yield* Deferred.make<unknown, SandboxError>()
          yield* bridgeStore.register(bridgeRequestId, deferred)

          // Route through scheduler for budget enforcement.
          // Queue.offer may fail (shutdown/interruption) or return false (dropping queue full),
          // so capture both outcomes explicitly.
          const offerExit = yield* Effect.exit(
            Queue.offer(runtime.commands, RlmCommand.HandleBridgeCall({
              callId: callerCallId,
              bridgeRequestId,
              method,
              args
            }))
          )
          if (Exit.isFailure(offerExit)) {
            yield* bridgeStore.fail(bridgeRequestId, new SandboxError({ message: "Scheduler queue closed" }))
            return yield* new SandboxError({ message: "Scheduler queue closed" })
          }
          if (!offerExit.value) {
            yield* bridgeStore.fail(bridgeRequestId, new SandboxError({ message: "Scheduler queue overloaded" }))
            return yield* new SandboxError({ message: "Scheduler queue overloaded" })
          }

          return yield* Deferred.await(deferred).pipe(
            Effect.timeoutFail({
              duration: Duration.millis(config.bridgeTimeoutMs ?? 300_000),
              onTimeout: () => new SandboxError({
                message: `Bridge call ${method}(${bridgeRequestId}) timed out after ${config.bridgeTimeoutMs ?? 300_000}ms`
              })
            })
          )
        }).pipe(
          Effect.ensuring(bridgeStore.remove(bridgeRequestId).pipe(Effect.ignore))
        )
      }
    })
  })
)

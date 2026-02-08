import { describe, expect, test } from "bun:test"
import { Chunk, Deferred, Effect, Exit, Layer, Option, PubSub, Queue, Ref, Schema, Stream } from "effect"
import { complete, stream } from "../src/Rlm"
import { RlmConfig, type RlmConfigService } from "../src/RlmConfig"
import { SandboxError } from "../src/RlmError"
import { SandboxFactory } from "../src/Sandbox"
import { SandboxBunLive } from "../src/SandboxBun"
import { BridgeHandlerLive } from "../src/BridgeHandler"
import { RlmRuntime, RlmRuntimeLive } from "../src/Runtime"
import { BridgeRequestId, CallId, RlmCommand } from "../src/RlmTypes"
import { runScheduler } from "../src/Scheduler"
import * as RlmTool from "../src/RlmTool"
import { makeFakeRlmModelLayer, type FakeModelMetrics } from "./helpers/FakeRlmModel"
import { makeFakeSandboxFactoryLayer, type FakeSandboxMetrics } from "./helpers/FakeSandboxFactory"
import { makeCustomSandboxFactoryLayer } from "./helpers/CustomSandboxFactory"

const defaultConfig: RlmConfigService = {
  maxIterations: 10,
  maxDepth: 1,
  maxLlmCalls: 20,
  maxTotalTokens: null,
  concurrency: 4,
  eventBufferCapacity: 4096
}

const makeLayers = (options: {
  readonly responses: ReadonlyArray<{ readonly text: string; readonly totalTokens?: number }>
  readonly modelMetrics?: FakeModelMetrics
  readonly sandboxMetrics?: FakeSandboxMetrics
  readonly config?: Partial<RlmConfigService>
}) => {
  const model = makeFakeRlmModelLayer(options.responses, options.modelMetrics)
  const sandbox = makeFakeSandboxFactoryLayer(options.sandboxMetrics)
  const runtimeLayer = Layer.fresh(RlmRuntimeLive)
  const base = Layer.mergeAll(model, sandbox, runtimeLayer)
  return options.config
    ? Layer.provide(base, Layer.succeed(RlmConfig, { ...defaultConfig, ...options.config }))
    : base
}

describe("Scheduler integration", () => {
  test("generate-execute loop: code block → sandbox execution → output in transcript → next iteration", async () => {
    const sandboxMetrics: FakeSandboxMetrics = {
      createCalls: 0,
      executeCalls: 0,
      snippets: []
    }
    const modelMetrics: FakeModelMetrics = { calls: 0, prompts: [], depths: [] }

    const answer = await Effect.runPromise(
      complete({
        query: "compute something",
        context: "ctx"
      }).pipe(
        Effect.either,
        Effect.provide(
          makeLayers({
            responses: [
              // First response: code block
              { text: "Let me compute:\n```python\nresult = 2 + 2\n```" },
              // Second response after execution: final answer
              { text: "FINAL(\"4\")" }
            ],
            sandboxMetrics,
            modelMetrics
          })
        )
      )
    )

    expect(answer._tag).toBe("Right")
    if (answer._tag === "Right") {
      expect(answer.right).toBe("4")
    }

    // Sandbox should have been called to execute the code block
    expect(sandboxMetrics.executeCalls).toBe(1)
    expect(sandboxMetrics.snippets[0]).toBe("result = 2 + 2")

    // Model called twice: once for code gen, once for final
    expect(modelMetrics.calls).toBe(2)

    // Second model call should include execution output in prompt messages
    const secondPrompt = modelMetrics.prompts[1]!
    const userMessages = secondPrompt.content.filter((m) => m.role === "user")
    // Last user message should contain execution output
    const lastUserMsg = userMessages[userMessages.length - 1]!
    const lastUserText = lastUserMsg.role === "user"
      ? (lastUserMsg.content as ReadonlyArray<{ readonly text: string }>)[0]!.text
      : ""
    expect(lastUserText).toContain("[Execution Output]")
    expect(lastUserText).toContain("executed:14") // FakeSandbox returns executed:{length}
  })

  test("FINAL extraction: model returns FINAL → immediate finalization (no sandbox execution)", async () => {
    const sandboxMetrics: FakeSandboxMetrics = {
      createCalls: 0,
      executeCalls: 0,
      snippets: []
    }

    const answer = await Effect.runPromise(
      complete({
        query: "quick answer",
        context: "ctx"
      }).pipe(
        Effect.either,
        Effect.provide(
          makeLayers({
            responses: [{ text: "FINAL(\"42\")" }],
            sandboxMetrics
          })
        )
      )
    )

    expect(answer._tag).toBe("Right")
    if (answer._tag === "Right") {
      expect(answer.right).toBe("42")
    }

    // No sandbox execution for FINAL-only response
    expect(sandboxMetrics.executeCalls).toBe(0)
  })

  test("no code block and no FINAL → loops to next GenerateStep", async () => {
    const modelMetrics: FakeModelMetrics = { calls: 0, prompts: [], depths: [] }
    const sandboxMetrics: FakeSandboxMetrics = {
      createCalls: 0,
      executeCalls: 0,
      snippets: []
    }

    const answer = await Effect.runPromise(
      complete({
        query: "think about it",
        context: "ctx"
      }).pipe(
        Effect.either,
        Effect.provide(
          makeLayers({
            responses: [
              { text: "Let me think about this..." },
              { text: "Still thinking..." },
              { text: "FINAL(\"thought complete\")" }
            ],
            modelMetrics,
            sandboxMetrics
          })
        )
      )
    )

    expect(answer._tag).toBe("Right")
    if (answer._tag === "Right") {
      expect(answer.right).toBe("thought complete")
    }

    // 3 model calls, 0 sandbox executions (no code blocks)
    expect(modelMetrics.calls).toBe(3)
    expect(sandboxMetrics.executeCalls).toBe(0)
  })

  test("deterministic event sequence for generate-execute loop", async () => {
    const events = await Effect.runPromise(
      stream({
        query: "compute",
        context: "ctx"
      }).pipe(
        Stream.runCollect,
        Effect.provide(
          makeLayers({
            responses: [
              { text: "```js\nprint(42)\n```" },
              { text: "FINAL(\"42\")" }
            ]
          })
        )
      )
    )

    const eventTags = Chunk.toReadonlyArray(events).map((e) => e._tag)

    expect(eventTags).toEqual([
      "CallStarted",
      "IterationStarted",
      "ModelResponse",
      "CodeExecutionStarted",
      "CodeExecutionCompleted",
      "IterationStarted",
      "ModelResponse",
      "CallFinalized"
    ])
  })

  test("multiple code blocks across iterations", async () => {
    const sandboxMetrics: FakeSandboxMetrics = {
      createCalls: 0,
      executeCalls: 0,
      snippets: []
    }

    const answer = await Effect.runPromise(
      complete({
        query: "multi-step",
        context: "ctx"
      }).pipe(
        Effect.either,
        Effect.provide(
          makeLayers({
            responses: [
              { text: "```js\nstep1()\n```" },
              { text: "```js\nstep2()\n```" },
              { text: "FINAL(\"done\")" }
            ],
            sandboxMetrics
          })
        )
      )
    )

    expect(answer._tag).toBe("Right")
    if (answer._tag === "Right") {
      expect(answer.right).toBe("done")
    }
    expect(sandboxMetrics.executeCalls).toBe(2)
    expect(sandboxMetrics.snippets).toEqual(["step1()", "step2()"])
  })

  test("existing tests still pass: returns final answer from scripted model", async () => {
    const modelMetrics: FakeModelMetrics = { calls: 0, prompts: [], depths: [] }
    const sandboxMetrics: FakeSandboxMetrics = {
      createCalls: 0,
      executeCalls: 0,
      snippets: []
    }

    const answer = await Effect.runPromise(
      complete({
        query: "What is 2+2?",
        context: "2+2=4"
      }).pipe(
        Effect.either,
        Effect.provide(
          makeLayers({
            responses: [{ text: "FINAL(\"4\")", totalTokens: 12 }],
            modelMetrics,
            sandboxMetrics
          })
        )
      )
    )

    expect(answer._tag).toBe("Right")
    if (answer._tag === "Right") {
      expect(answer.right).toBe("4")
    }
    expect(modelMetrics.calls).toBe(1)
    expect(sandboxMetrics.createCalls).toBe(1)
  })

  test("extract fallback when max iterations exhausted", async () => {
    const result = await Effect.runPromise(
      complete({
        query: "compute",
        context: "ctx"
      }).pipe(
        Effect.either,
        Effect.provide(
          makeLayers({
            responses: [
              { text: "```js\nstep1()\n```" },
              { text: "```js\nstep2()\n```" },
              { text: 'FINAL("extracted")' }  // extract fallback response
            ],
            config: { maxIterations: 2 }
          })
        )
      )
    )

    expect(result._tag).toBe("Right")
    if (result._tag === "Right") {
      expect(result.right).toBe("extracted")
    }
  })

  test("extract fallback uses raw text when no FINAL in response", async () => {
    const result = await Effect.runPromise(
      complete({
        query: "compute",
        context: "ctx"
      }).pipe(
        Effect.either,
        Effect.provide(
          makeLayers({
            responses: [
              { text: "```js\nstep1()\n```" },
              { text: "```js\nstep2()\n```" },
              { text: "The answer is 42" }  // extract response without FINAL
            ],
            config: { maxIterations: 2 }
          })
        )
      )
    )

    expect(result._tag).toBe("Right")
    if (result._tag === "Right") {
      expect(result.right).toBe("The answer is 42")
    }
  })

  test("extract fallback fails when LLM call budget also exhausted", async () => {
    const result = await Effect.runPromise(
      complete({
        query: "compute",
        context: "ctx"
      }).pipe(
        Effect.either,
        Effect.provide(
          makeLayers({
            responses: [
              { text: "```js\nstep1()\n```" },
              { text: 'FINAL("unreachable")' }
            ],
            config: { maxIterations: 1, maxLlmCalls: 1 }
          })
        )
      )
    )

    expect(result._tag).toBe("Left")
  })

  test("drops stale commands and emits SchedulerWarning without failing root run", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const runtime = yield* RlmRuntime
          const subscription = yield* PubSub.subscribe(runtime.events)

          // Inject stale work before scheduler starts processing queue.
          yield* Queue.offer(runtime.commands, RlmCommand.GenerateStep({
            callId: CallId("stale-call")
          }))

          const answer = yield* runScheduler({
            query: "warn on stale",
            context: "ctx"
          })

          const events = yield* subscription.takeAll
          return { answer, events: Chunk.toReadonlyArray(events) }
        }).pipe(
          Effect.provide(
            makeLayers({
              responses: [{ text: "FINAL(\"ok\")" }]
            })
          )
        )
      )
    )

    expect(result.answer).toBe("ok")
    const staleWarning = result.events.find((event) =>
      event._tag === "SchedulerWarning" &&
      event.code === "STALE_COMMAND_DROPPED" &&
      event.commandTag === "GenerateStep"
    )
    expect(staleWarning).toBeDefined()
  })

  test("scheduler interruption closes call scopes, bridge pending state, and command queue", async () => {
    const hangingSandboxLayer = Layer.succeed(
      SandboxFactory,
      SandboxFactory.of({
        create: () =>
          Effect.succeed({
            execute: () => Effect.never,
            setVariable: () => Effect.void,
            getVariable: () => Effect.void
          })
      })
    )

    const layers = Layer.mergeAll(
      makeFakeRlmModelLayer([{ text: "```js\nprint('hanging')\n```" }]),
      hangingSandboxLayer,
      Layer.fresh(RlmRuntimeLive)
    )

    const result = await Effect.runPromise(
      Effect.gen(function*() {
        const runtime = yield* RlmRuntime
        const leakedBridge = yield* Deferred.make<unknown, SandboxError>()
        const leakedBridgeRequestId = BridgeRequestId("leaked-bridge")
        yield* Ref.update(runtime.bridgePending, (current) => {
          const next = new Map(current)
          next.set(leakedBridgeRequestId, leakedBridge)
          return next
        })

        const timeout = yield* runScheduler({
          query: "hang forever",
          context: "ctx"
        }).pipe(Effect.timeoutOption("200 millis"))

        const statesAfter = yield* Ref.get(runtime.callStates)
        const bridgePendingAfter = yield* Ref.get(runtime.bridgePending)
        const leakedBridgeResult = yield* Deferred.await(leakedBridge).pipe(Effect.either)
        const offerAfterShutdown = yield* Effect.exit(
          Queue.offer(runtime.commands, RlmCommand.GenerateStep({ callId: CallId("after-timeout") }))
        )

        return {
          timeout,
          remainingStates: statesAfter.size,
          remainingBridgePending: bridgePendingAfter.size,
          leakedBridgeResult,
          offerAfterShutdown
        }
      }).pipe(Effect.provide(layers))
    )

    expect(Option.isNone(result.timeout)).toBe(true)
    expect(result.remainingStates).toBe(0)
    expect(result.remainingBridgePending).toBe(0)
    expect(result.leakedBridgeResult._tag).toBe("Left")
    if (result.leakedBridgeResult._tag === "Left") {
      expect(result.leakedBridgeResult.left).toBeInstanceOf(SandboxError)
      expect(result.leakedBridgeResult.left.message).toContain("Scheduler stopped")
    }
    expect(Exit.isFailure(result.offerAfterShutdown)).toBe(true)
  })

  test("execution error surfaces as output and model can recover", async () => {
    const metrics = { createCalls: 0, executeCalls: 0, snippets: [] as Array<string> }
    const failOnceSandboxLayer = makeCustomSandboxFactoryLayer({
      metrics,
      execute: (code, callNumber) =>
        callNumber === 1
          ? Effect.fail(new SandboxError({ message: "ReferenceError: x is not defined" }))
          : Effect.succeed(`executed:${code.length}`)
    })

    const modelMetrics: FakeModelMetrics = { calls: 0, prompts: [], depths: [] }
    const model = makeFakeRlmModelLayer([
      { text: "```js\nlet y = x + 1\n```" },
      { text: "```js\nlet y = 1 + 1\n```" },
      { text: 'FINAL("recovered")' }
    ], modelMetrics)

    const layers = Layer.mergeAll(model, failOnceSandboxLayer, Layer.fresh(RlmRuntimeLive))

    const result = await Effect.runPromise(
      complete({ query: "compute", context: "ctx" }).pipe(
        Effect.either,
        Effect.provide(layers)
      )
    )

    expect(result._tag).toBe("Right")
    if (result._tag === "Right") {
      expect(result.right).toBe("recovered")
    }
    expect(metrics.executeCalls).toBe(2)
  })

  test("repeated execution errors consume iterations until extract fallback", async () => {
    const alwaysFailSandboxLayer = makeCustomSandboxFactoryLayer({
      execute: () => Effect.fail(new SandboxError({ message: "always fails" }))
    })

    const model = makeFakeRlmModelLayer([
      { text: "```js\nfail()\n```" },
      { text: "```js\nfail()\n```" },
      { text: 'FINAL("extracted")' }
    ])

    const layers = Layer.provide(
      Layer.mergeAll(model, alwaysFailSandboxLayer, Layer.fresh(RlmRuntimeLive)),
      Layer.succeed(RlmConfig, { ...defaultConfig, maxIterations: 2 })
    )

    const result = await Effect.runPromise(
      complete({ query: "compute", context: "ctx" }).pipe(
        Effect.either,
        Effect.provide(layers)
      )
    )

    expect(result._tag).toBe("Right")
    if (result._tag === "Right") {
      expect(result.right).toBe("extracted")
    }
  })

  test("error message appears in subsequent model prompt", async () => {
    const metrics = { createCalls: 0, executeCalls: 0, snippets: [] as Array<string> }
    const failOnceSandboxLayer = makeCustomSandboxFactoryLayer({
      metrics,
      execute: (code, callNumber) =>
        callNumber === 1
          ? Effect.fail(new SandboxError({ message: "ReferenceError: x is not defined" }))
          : Effect.succeed(`executed:${code.length}`)
    })

    const modelMetrics: FakeModelMetrics = { calls: 0, prompts: [], depths: [] }
    const model = makeFakeRlmModelLayer([
      { text: "```js\nlet y = x + 1\n```" },
      { text: "```js\nlet y = 1 + 1\n```" },
      { text: 'FINAL("ok")' }
    ], modelMetrics)

    const layers = Layer.mergeAll(model, failOnceSandboxLayer, Layer.fresh(RlmRuntimeLive))

    await Effect.runPromise(
      complete({ query: "compute", context: "ctx" }).pipe(
        Effect.either,
        Effect.provide(layers)
      )
    )

    // Second model call should see the error in its prompt
    const secondPrompt = modelMetrics.prompts[1]!
    const userMessages = secondPrompt.content.filter((m) => m.role === "user")
    const lastUserMsg = userMessages[userMessages.length - 1]!
    const lastUserText = lastUserMsg.role === "user"
      ? (lastUserMsg.content as ReadonlyArray<{ readonly text: string }>)[0]!.text
      : ""
    expect(lastUserText).toContain("Error: ReferenceError: x is not defined")
  })

  test("error-path emits CodeExecutionStarted + CodeExecutionCompleted", async () => {
    const failOnceSandboxLayer = makeCustomSandboxFactoryLayer({
      execute: (code, callNumber) =>
        callNumber === 1
          ? Effect.fail(new SandboxError({ message: "boom" }))
          : Effect.succeed(`executed:${code.length}`)
    })

    const model = makeFakeRlmModelLayer([
      { text: "```js\nbad()\n```" },
      { text: "```js\ngood()\n```" },
      { text: 'FINAL("ok")' }
    ])

    const layers = Layer.mergeAll(model, failOnceSandboxLayer, Layer.fresh(RlmRuntimeLive))

    const events = await Effect.runPromise(
      stream({ query: "compute", context: "ctx" }).pipe(
        Stream.runCollect,
        Effect.provide(layers)
      )
    )

    const eventTags = Chunk.toReadonlyArray(events).map((e) => e._tag)

    // First iteration: code → error surfaced as CodeExecuted
    // Second iteration: code → success
    // Third iteration: FINAL
    expect(eventTags).toEqual([
      "CallStarted",
      "IterationStarted",
      "ModelResponse",
      "CodeExecutionStarted",
      "CodeExecutionCompleted",  // error output
      "IterationStarted",
      "ModelResponse",
      "CodeExecutionStarted",
      "CodeExecutionCompleted",  // success output
      "IterationStarted",
      "ModelResponse",
      "CallFinalized"
    ])

    // Verify the first CodeExecutionCompleted contains the error
    const execCompletedEvents = Chunk.toReadonlyArray(events).filter(
      (e): e is Extract<typeof e, { _tag: "CodeExecutionCompleted" }> =>
        e._tag === "CodeExecutionCompleted"
    )
    expect(execCompletedEvents[0]!.output).toContain("Error: boom")
  })

  test("primitive execution errors do not stall and surface as deterministic output", async () => {
    const modelMetrics: FakeModelMetrics = { calls: 0, prompts: [], depths: [] }
    const primitiveFailOnceSandboxLayer = makeCustomSandboxFactoryLayer({
      execute: (code, callNumber) =>
        callNumber === 1
          ? Effect.fail("boom")
          : Effect.succeed(`executed:${code.length}`)
    })

    const model = makeFakeRlmModelLayer([
      { text: "```js\nlet y = x + 1\n```" },
      { text: "```js\nlet y = 1 + 1\n```" },
      { text: 'FINAL("ok")' }
    ], modelMetrics)

    const layers = Layer.mergeAll(model, primitiveFailOnceSandboxLayer, Layer.fresh(RlmRuntimeLive))

    const result = await Effect.runPromise(
      complete({ query: "compute", context: "ctx" }).pipe(
        Effect.either,
        Effect.provide(layers),
        Effect.timeoutOption("5 seconds")
      )
    )

    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value._tag).toBe("Right")
      if (result.value._tag === "Right") {
        expect(result.value.right).toBe("ok")
      }
    }

    // Second model call should see primitive failure text as execution output.
    const secondPrompt = modelMetrics.prompts[1]!
    const userMessages = secondPrompt.content.filter((m) => m.role === "user")
    const lastUserMsg = userMessages[userMessages.length - 1]!
    const lastUserText = lastUserMsg.role === "user"
      ? (lastUserMsg.content as ReadonlyArray<{ readonly text: string }>)[0]!.text
      : ""
    expect(lastUserText).toContain("Error: boom")
  })

  test("StartCall failure with failing sandbox factory does not hang", async () => {
    const failingSandboxLayer = Layer.succeed(
      SandboxFactory,
      SandboxFactory.of({
        create: () => Effect.fail(new SandboxError({ message: "Factory create failed" }))
      })
    )

    const model = makeFakeRlmModelLayer(
      [{ text: "FINAL(\"unreachable\")" }]
    )

    const runtimeLayer = Layer.fresh(RlmRuntimeLive)
    const layers = Layer.mergeAll(model, failingSandboxLayer, runtimeLayer)

    const result = await Effect.runPromise(
      complete({
        query: "should fail",
        context: "ctx"
      }).pipe(
        Effect.either,
        Effect.provide(layers),
        Effect.timeout("5 seconds")
      )
    )

    expect(result).not.toBeUndefined()
    if (result && "_tag" in result) {
      expect(result._tag).toBe("Left")
    }
  }, 10_000)
})

describe("Scheduler tool dispatch (e2e with real sandbox)", () => {
  const makeRealSandboxLayers = (options: {
    readonly responses: ReadonlyArray<{ readonly text: string; readonly totalTokens?: number }>
    readonly config?: Partial<RlmConfigService>
  }) => {
    const model = makeFakeRlmModelLayer(options.responses)
    // Mirror rlmBunLayer composition: RlmRuntimeLive → BridgeHandlerLive → SandboxBunLive
    const perCallLayer = Layer.fresh(
      Layer.provideMerge(
        SandboxBunLive,
        Layer.provideMerge(BridgeHandlerLive, RlmRuntimeLive)
      )
    )
    const base = Layer.mergeAll(model, perCallLayer)
    return options.config
      ? Layer.provide(base, Layer.succeed(RlmConfig, { ...defaultConfig, ...options.config }))
      : base
  }

  test("tool bridge call flows through scheduler dispatch", async () => {
    let toolCalled = false

    const addTool = RlmTool.make("add", {
      description: "Add two numbers",
      parameters: { a: Schema.Number, b: Schema.Number },
      returns: Schema.Number,
      handler: ({ a, b }) => {
        toolCalled = true
        return Effect.succeed(a + b)
      }
    })

    const answer = await Effect.runPromise(
      complete({
        query: "compute 2+3",
        context: "math",
        tools: [addTool]
      }).pipe(
        Effect.provide(makeRealSandboxLayers({
          responses: [
            { text: "```js\nconst result = await add(2, 3)\nprint(result)\n```" },
            { text: 'FINAL("5")' }
          ]
        })),
        Effect.timeout("10 seconds")
      )
    )

    expect(toolCalled).toBe(true)
    expect(answer).toBe("5")
  }, 15_000)

  test("unknown tool method fails bridge deferred", async () => {
    const answer = await Effect.runPromise(
      complete({
        query: "test unknown tool",
        context: "ctx"
      }).pipe(
        Effect.provide(makeRealSandboxLayers({
          responses: [
            { text: "```js\ntry {\n  await nonexistent('arg')\n} catch (e) {\n  print('caught: ' + e.message)\n}\n```" },
            { text: 'FINAL("handled")' }
          ]
        })),
        Effect.timeout("10 seconds")
      )
    )

    // The sandbox should catch the error since nonexistent is not a defined function
    expect(answer).toBe("handled")
  }, 15_000)

  test("context and query are injected into __vars before code execution", async () => {
    const events = await Effect.runPromise(
      stream({
        query: "what is the answer",
        context: "the answer is 42"
      }).pipe(
        Stream.runCollect,
        Effect.provide(makeRealSandboxLayers({
          responses: [
            { text: "```js\nprint(__vars.query + '|' + __vars.context)\n```" },
            { text: 'FINAL("done")' }
          ]
        })),
        Effect.timeout("10 seconds")
      )
    )

    const eventList = Chunk.toReadonlyArray(events)
    const execCompleted = eventList.find(
      (e): e is Extract<typeof e, { _tag: "CodeExecutionCompleted" }> =>
        e._tag === "CodeExecutionCompleted"
    )
    expect(execCompleted).toBeDefined()
    expect(execCompleted!.output).toBe("what is the answer|the answer is 42")
  }, 15_000)
})

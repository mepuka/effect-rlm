/**
 * NLP tool adapter — bridges effect-nlp's ExportedTool to RlmToolAny.
 */

import { Effect } from "effect"
import { Tools } from "effect-nlp"
import type { RlmToolAny } from "./RlmTool"
import { RlmToolError } from "./RlmTool"

export const nlpTools: Effect.Effect<ReadonlyArray<RlmToolAny>, RlmToolError, never> =
  Tools.exportTools.pipe(
    Effect.mapError(
      (e) => new RlmToolError({ message: e.message, toolName: e.toolName })
    ),
    Effect.map((tools) =>
      tools.map((tool): RlmToolAny => ({
        ...tool,
        handle: (args) =>
          tool.handle(args).pipe(
            Effect.mapError(
              (e) => new RlmToolError({ message: e.message, toolName: e.toolName })
            )
          )
      }))
    )
  )

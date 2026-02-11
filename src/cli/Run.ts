import { Effect, Match, Stream } from "effect"
import { type CliArgs, buildCliLayer } from "../CliLayer"
import { nlpTools } from "../NlpTools"
import { Rlm } from "../Rlm"
import { formatEvent, type RenderOptions } from "../RlmRenderer"
import type { RlmToolAny } from "../RlmTool"
import { analyzeContext } from "../ContextMetadata"
import type { MediaAttachment } from "../RlmTypes"
import * as path from "node:path"

const detectMediaType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase()
  switch (extension) {
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    case ".gif":
      return "image/gif"
    case ".pdf":
      return "application/pdf"
    case ".mp3":
      return "audio/mpeg"
    case ".wav":
      return "audio/wav"
    default:
      return "application/octet-stream"
  }
}

export const runCliProgram = (cliArgs: CliArgs) =>
  Effect.gen(function*() {
    const contextFile = cliArgs.contextFile
    const context = contextFile
      ? yield* Effect.promise(() => Bun.file(contextFile).text())
      : cliArgs.context
    const contextMetadata = context.length > 0
      ? analyzeContext(context, contextFile !== undefined ? path.basename(contextFile) : undefined)
      : undefined

    const tools: ReadonlyArray<RlmToolAny> = cliArgs.nlpTools
      ? yield* nlpTools.pipe(Effect.orDie)
      : []
    const attachmentMap = new Map<string, MediaAttachment>()

    if (cliArgs.media !== undefined) {
      for (const entry of cliArgs.media) {
        const file = Bun.file(entry.path)
        const data = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()))
        attachmentMap.set(entry.name, {
          name: entry.name,
          mediaType: file.type || detectMediaType(entry.path),
          data
        })
      }
    }
    if (cliArgs.mediaUrls !== undefined) {
      for (const entry of cliArgs.mediaUrls) {
        attachmentMap.set(entry.name, {
          name: entry.name,
          mediaType: detectMediaType(entry.url),
          data: new URL(entry.url)
        })
      }
    }
    const mediaAttachments = [...attachmentMap.values()]

    const rlm = yield* Rlm

    const renderOpts: RenderOptions = {
      quiet: cliArgs.quiet,
      noColor: cliArgs.noColor
    }

    const result = yield* rlm.stream({
      query: cliArgs.query,
      context,
      ...(contextMetadata !== undefined ? { contextMetadata } : {}),
      ...(mediaAttachments.length > 0 ? { mediaAttachments } : {}),
      tools
    }).pipe(
      Stream.runFoldEffect(
        { answer: "", failed: false },
        (state, event) =>
          Effect.sync(() => {
            const formatted = formatEvent(event, renderOpts)
            if (formatted) process.stderr.write(formatted)
            return Match.value(event).pipe(
              Match.tag("CallFinalized", (e) =>
                e.depth === 0 ? { ...state, answer: e.answer } : state),
              Match.tag("CallFailed", (e) =>
                e.depth === 0 ? { ...state, failed: true } : state),
              Match.orElse(() => state)
            )
          })
      )
    )

    if (result.failed || !result.answer) {
      process.exitCode = 1
    }

    process.stdout.write(result.answer + "\n")
  })

export const runCliWithLayer = (cliArgs: CliArgs) =>
  runCliProgram(cliArgs).pipe(Effect.provide(buildCliLayer(cliArgs)))

import * as Prompt from "@effect/ai/Prompt"
import type { TranscriptEntry } from "./RlmTypes"

export const MAX_OUTPUT_CHARS = 4_000
export const CONTEXT_PREVIEW_CHARS = 200
export const MAX_ONESHOT_CONTEXT_CHARS = 8_000
export const ANTHROPIC_EPHEMERAL_CACHE_CONTROL = { type: "ephemeral" } as const

const promptCacheOptions: Prompt.ProviderOptions = {
  anthropic: {
    cacheControl: ANTHROPIC_EPHEMERAL_CACHE_CONTROL
  }
}

const withPromptCacheOptions = <T extends Prompt.MessageEncoded>(
  message: T,
  enabled: boolean
): T =>
  enabled
    ? {
        ...message,
        options: promptCacheOptions
      }
    : message

export const truncateOutput = (output: string, maxChars = MAX_OUTPUT_CHARS): string => {
  if (output.length <= maxChars) return output
  return output.slice(0, maxChars) + `\n[truncated at ${output.length} chars]`
}

export const truncateExecutionOutput = (output: string, maxChars = MAX_OUTPUT_CHARS): string => {
  if (output.length <= maxChars) return output
  return output.slice(0, maxChars) +
    `\n[Output truncated at ${output.length} chars. Full data remains in __vars state; analyze in chunks with llm_query() instead of printing everything.]`
}

export interface BuildReplPromptOptions {
  readonly systemPrompt: string
  readonly query: string
  readonly contextLength: number
  readonly contextPreview: string
  readonly transcript: ReadonlyArray<TranscriptEntry>
  readonly enablePromptCaching?: boolean
}

export const buildReplPrompt = (options: BuildReplPromptOptions): Prompt.Prompt => {
  const enablePromptCaching = options.enablePromptCaching ?? true
  const messages: Array<Prompt.MessageEncoded> = []

  messages.push(withPromptCacheOptions({
    role: "system",
    content: options.systemPrompt
  }, enablePromptCaching))

  const isFirstIteration = options.transcript.length === 0
  const safeguard = isFirstIteration && options.contextLength > 0
    ? "You have not seen the context yet. Explore it with code first — do not call SUBMIT() immediately.\n\n"
    : ""

  const userContent = options.contextLength > 0
    ? `${safeguard}${options.query}\n\n[Context available in __vars.context (${options.contextLength} chars). Preview: ${options.contextPreview}...]`
    : options.query
  messages.push(withPromptCacheOptions({
    role: "user",
    content: userContent
  }, enablePromptCaching))

  let lastCacheableTranscriptMessageIndex: number | undefined

  for (const entry of options.transcript) {
    messages.push({ role: "assistant", content: entry.assistantResponse })
    if (entry.executionOutput !== undefined) {
      const outputText = entry.executionOutput === ""
        ? "(no output — did you forget to print?)"
        : entry.executionOutput
      messages.push({
        role: "user",
        content: `[Execution Output]\n${outputText}`
      })
      // Assistant text blocks are not cacheable in the Anthropic adapter.
      lastCacheableTranscriptMessageIndex = messages.length - 1
    }
  }

  if (
    enablePromptCaching &&
    lastCacheableTranscriptMessageIndex !== undefined
  ) {
    const lastCacheableTranscriptMessage = messages[lastCacheableTranscriptMessageIndex]!
    messages[lastCacheableTranscriptMessageIndex] = withPromptCacheOptions(lastCacheableTranscriptMessage, true)
  }

  return Prompt.make(messages)
}

export interface BuildOneShotPromptOptions {
  readonly systemPrompt: string
  readonly query: string
  readonly context: string
  readonly enablePromptCaching?: boolean
}

export const buildOneShotPrompt = (options: BuildOneShotPromptOptions): Prompt.Prompt => {
  const enablePromptCaching = options.enablePromptCaching ?? true
  const messages: Array<Prompt.MessageEncoded> = []
  messages.push(withPromptCacheOptions({
    role: "system",
    content: options.systemPrompt
  }, enablePromptCaching))
  const boundedContext = truncateOutput(options.context, MAX_ONESHOT_CONTEXT_CHARS)
  const userContent = boundedContext
    ? `${options.query}\n\nContext: ${boundedContext}`
    : options.query
  messages.push({ role: "user", content: userContent })
  return Prompt.make(messages)
}

export interface BuildExtractPromptOptions {
  readonly systemPrompt: string
  readonly query: string
  readonly contextLength: number
  readonly contextPreview: string
  readonly transcript: ReadonlyArray<TranscriptEntry>
  readonly enablePromptCaching?: boolean
}

export const buildExtractPrompt = (options: BuildExtractPromptOptions): Prompt.Prompt => {
  const enablePromptCaching = options.enablePromptCaching ?? true
  const messages: Array<Prompt.MessageEncoded> = []

  messages.push(withPromptCacheOptions({
    role: "system",
    content: options.systemPrompt
  }, enablePromptCaching))

  const userContent = options.contextLength > 0
    ? `${options.query}\n\n[Context was available in __vars.context (${options.contextLength} chars). Preview: ${options.contextPreview}...]`
    : options.query
  messages.push({ role: "user", content: userContent })

  let lastCacheableTranscriptMessageIndex: number | undefined

  for (const entry of options.transcript) {
    messages.push({ role: "assistant", content: entry.assistantResponse })
    if (entry.executionOutput !== undefined) {
      const outputText = entry.executionOutput === ""
        ? "(no output)"
        : entry.executionOutput
      messages.push({
        role: "user",
        content: `[Execution Output]\n${outputText}`
      })
      // Assistant text blocks are not cacheable in the Anthropic adapter.
      lastCacheableTranscriptMessageIndex = messages.length - 1
    }
  }

  if (
    enablePromptCaching &&
    lastCacheableTranscriptMessageIndex !== undefined
  ) {
    const lastCacheableTranscriptMessage = messages[lastCacheableTranscriptMessageIndex]!
    messages[lastCacheableTranscriptMessageIndex] = withPromptCacheOptions(lastCacheableTranscriptMessage, true)
  }

  return Prompt.make(messages)
}

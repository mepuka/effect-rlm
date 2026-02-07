import { Schema } from "effect"

export class BudgetExhaustedError extends Schema.TaggedError<BudgetExhaustedError>()(
  "BudgetExhaustedError",
  {
    resource: Schema.Literal("iterations", "llmCalls", "tokens"),
    callId: Schema.String,
    remaining: Schema.Number
  }
) {}

export class NoFinalAnswerError extends Schema.TaggedError<NoFinalAnswerError>()(
  "NoFinalAnswerError",
  {
    callId: Schema.String,
    maxIterations: Schema.Number
  }
) {}

export class CallStateMissingError extends Schema.TaggedError<CallStateMissingError>()(
  "CallStateMissingError",
  {
    callId: Schema.String
  }
) {}

export class SandboxError extends Schema.TaggedError<SandboxError>()(
  "SandboxError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect)
  }
) {}

export class UnknownRlmError extends Schema.TaggedError<UnknownRlmError>()(
  "UnknownRlmError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect)
  }
) {}

export class OutputValidationError extends Schema.TaggedError<OutputValidationError>()(
  "OutputValidationError",
  {
    message: Schema.String,
    raw: Schema.String
  }
) {}

export type RlmError =
  | BudgetExhaustedError
  | NoFinalAnswerError
  | CallStateMissingError
  | SandboxError
  | UnknownRlmError
  | OutputValidationError


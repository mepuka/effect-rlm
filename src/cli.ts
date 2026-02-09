import * as ValidationError from "@effect/cli/ValidationError"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Effect } from "effect"
import { runCliCommand } from "./cli/Command"
import { CliInputError } from "./cli/Normalize"

const handleValidationError = (error: ValidationError.ValidationError) =>
  Effect.sync(() => {
    if (error._tag !== "HelpRequested") {
      process.exitCode = 1
    }
  })

const handleCliInputError = (error: CliInputError) =>
  Effect.sync(() => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })

Effect.suspend(() => runCliCommand(process.argv)).pipe(
  Effect.provide(BunContext.layer),
  Effect.catchIf(ValidationError.isValidationError, handleValidationError),
  Effect.catchIf((error): error is CliInputError => error instanceof CliInputError, handleCliInputError),
  BunRuntime.runMain
)

import { describe, expect, test } from "bun:test"
import { extractFinal, extractCodeBlock } from "../src/CodeExtractor"

describe("extractFinal", () => {
  test("double quotes", () => {
    expect(extractFinal('FINAL("answer")')).toBe("answer")
  })

  test("single quotes", () => {
    expect(extractFinal("FINAL('answer')")).toBe("answer")
  })

  test("backtick quotes", () => {
    expect(extractFinal("FINAL(`answer`)")).toBe("answer")
  })

  test("multiline in backticks", () => {
    expect(extractFinal("FINAL(`line1\nline2`)")).toBe("line1\nline2")
  })

  test("no quotes returns null", () => {
    expect(extractFinal("FINAL(answer)")).toBeNull()
  })

  test("no FINAL returns null", () => {
    expect(extractFinal("just some text")).toBeNull()
  })

  test("FINAL inside code block still extracts", () => {
    expect(extractFinal('```js\nFINAL("x")\n```')).toBe("x")
  })

  test("nested quotes", () => {
    expect(extractFinal("FINAL(\"it's\")")).toBe("it's")
  })

  test("empty FINAL", () => {
    expect(extractFinal('FINAL("")')).toBe("")
  })

  test("JSON in backticks", () => {
    expect(extractFinal('FINAL(`{"a":1}`)')).toBe('{"a":1}')
  })
})

describe("extractCodeBlock", () => {
  test("js fence", () => {
    expect(extractCodeBlock("```js\ncode\n```")).toBe("code")
  })

  test("python fence", () => {
    expect(extractCodeBlock("```python\ncode\n```")).toBe("code")
  })

  test("no language fence", () => {
    expect(extractCodeBlock("```\ncode\n```")).toBe("code")
  })

  test("no code block returns null", () => {
    expect(extractCodeBlock("just text")).toBeNull()
  })

  test("multiple blocks returns first", () => {
    expect(extractCodeBlock("```js\nfirst\n```\n```js\nsecond\n```")).toBe("first")
  })

  test("empty block", () => {
    expect(extractCodeBlock("```js\n\n```")).toBe("")
  })

  test("trims whitespace", () => {
    expect(extractCodeBlock("```js\n  code  \n```")).toBe("code")
  })
})

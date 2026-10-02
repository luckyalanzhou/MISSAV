import { Script } from "scripting"
import { extractSubtitleSearchCode } from "../subtitle-search-code"

const cases: [string, string][] = [
  ["IPZZ-977-UNCENSORED-LEAK", "IPZZ-977"],
  ["ipzz-977-uncensored-leak", "IPZZ-977"],
  ["  IPZZ_977_UNCENSORED_LEAK  ", "IPZZ-977"],
  ["IPZZ 977 UNCENSORED LEAK", "IPZZ-977"],
  ["IPZZ－977", "IPZZ-977"],
  ["IPZZ–977–UNCENSORED–LEAK", "IPZZ-977"],
  ["IPZZ-977", "IPZZ-977"],
  ["IPZZ-9770-UNCENSORED", "IPZZ-9770"],
  ["SSIS-001-UNCENSORED", "SSIS-001"],
  ["T28-123-LEAK", "T28-123"],
  ["FC2-PPV-4566405-UNCENSORED", "FC2-PPV-4566405"],
  ["FC2-PPV-4566405", "FC2-PPV-4566405"],
  ["FC2-4566405-LEAK", "FC2-4566405"],
  ["1PONDO-012345-001-UNCENSORED", "1PONDO-012345-001"],
  ["012345-001-LEAK", "012345-001"],
  ["HEYZO-1234", "HEYZO-1234"],
  ["ABC-123B", "ABC-123B"],
  ["IPZZ-9770ABC", "IPZZ-9770ABC"],
  ["OTHER-123", "OTHER-123"],
  ["", ""],
]

try {
  for (const [input, expected] of cases) {
    const actual = extractSubtitleSearchCode(input)
    if (actual !== expected) throw new Error(`${input}: expected ${expected}, got ${actual}`)
    if (extractSubtitleSearchCode(actual) !== actual) throw new Error(`Normalization must be idempotent: ${input}`)
  }
  Script.exit({ passed: cases.length, message: "Subtitle search base-code extraction passed" })
} catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }

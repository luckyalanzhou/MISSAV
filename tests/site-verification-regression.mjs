import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const accountPath = fileURLToPath(new URL("../account.ts", import.meta.url))
const accountSource = readFileSync(accountPath, "utf8")
const visibleSuccessBranch = accountSource.match(/if \(visibleListingConfirmed\) \{([\s\S]*?)\n\s{8}\}/)

assert.ok(visibleSuccessBranch, "The visible verification result branch should remain explicit")
assert.match(visibleSuccessBranch[1], /\bcontinue\b/, "A verified visible route must continue checking the remaining access probes")
assert.doesNotMatch(visibleSuccessBranch[1], /return\s+["']accessible["']/, "One verified route must not mark the whole line as accessible")

console.log("MISSAV site verification regression test passed")


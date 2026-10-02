import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const accountPath = fileURLToPath(new URL("../account.ts", import.meta.url))
const accountSource = readFileSync(accountPath, "utf8")
const visibleSuccessBranch = accountSource.match(/if \(visibleListingConfirmed\) \{([\s\S]*?)\n\s{8}\}/)

assert.ok(visibleSuccessBranch, "The visible verification result branch should remain explicit")
assert.match(visibleSuccessBranch[1], /\bcontinue\b/, "A verified visible route must continue checking the remaining access probes")
assert.doesNotMatch(visibleSuccessBranch[1], /return\s+["']accessible["']/, "One verified route must not mark the whole line as accessible")
assert.match(accountSource, /Start the exact route once in a fresh foreground WebView/)
assert.match(accountSource, /controller\.dispose\(\)\s*controller = new WebViewController\(\)\s*await restoreCloudflareSession\(controller, probeURL\)/, "A stalled hidden challenge must never become the interactive window")
assert.match(accountSource, /Never retry in the background after the user closes the challenge/)
assert.match(accountSource, /if \(!presentationClosed\) void controller\.loadURL\(probeURL\)/)
assert.doesNotMatch(accountSource, /const verifiedPage: WebViewPageLoad[\s\S]*?await loadWebViewPage\(controller, probeURL\)/, "Closing the challenge must not trigger a hidden retry that later reports false success")
assert.match(accountSource, /status: "incomplete" \| "unavailable" \| "blocked"; probe: MissAVAccessProbe/)

console.log("MISSAV site verification regression test passed")


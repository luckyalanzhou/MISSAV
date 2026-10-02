import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const verificationPath = fileURLToPath(new URL("../site-verification.ts", import.meta.url))
const verificationSource = readFileSync(verificationPath, "utf8")
const visibleSuccessBranch = verificationSource.match(/if \(visibleListingConfirmed\) \{([\s\S]*?)\n\s{8}\}/)

assert.ok(visibleSuccessBranch, "The visible verification result branch should remain explicit")
assert.match(visibleSuccessBranch[1], /\bcontinue\b/, "A verified visible route must continue checking the remaining access probes")
assert.doesNotMatch(visibleSuccessBranch[1], /return\s+["']accessible["']/, "One verified route must not mark the whole line as accessible")
assert.match(verificationSource, /Start the exact route once in a fresh foreground WebView/)
assert.match(verificationSource, /controller\.dispose\(\)\s*controller = new WebViewController\(\)\s*await restoreCloudflareSession\(controller, probeURL\)/, "A stalled hidden challenge must never become the interactive window")
assert.match(verificationSource, /Never retry in the background after the user closes the challenge/)
assert.match(verificationSource, /if \(!presentationClosed\) void controller\.loadURL\(probeURL\)/)
assert.doesNotMatch(verificationSource, /const verifiedPage: WebViewPageLoad[\s\S]*?await loadWebViewPage\(controller, probeURL\)/, "Closing the challenge must not trigger a hidden retry that later reports false success")
assert.match(verificationSource, /status: "incomplete" \| "unavailable" \| "blocked"; probe: MissAVAccessProbe/)

console.log("MISSAV site verification regression test passed")


import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const verificationPath = fileURLToPath(new URL("../site-verification.ts", import.meta.url))
const verificationSource = readFileSync(verificationPath, "utf8")
assert.match(verificationSource, /const probe = missavClient\.accessProbeRoutes\(\)\[0\]/, "Verification opens the highest-priority exact route")
assert.match(verificationSource, /controller\.present\(\{ fullscreen: true, navigationTitle: "验证访问线路" \}\)/)
assert.match(verificationSource, /if \(!presentationClosed\) void controller\.loadURL\(probeURL\)/, "The first tap navigates in the visible WebView")
assert.match(verificationSource, /listingConfirmed && missavClient\.cacheVerifiedPage\(probe, document\)/)
assert.doesNotMatch(verificationSource, /clearVerificationCollections\(\)/, "One successful page cannot clear unrelated failed routes")
assert.match(verificationSource, /Never retry in the background after the user closes the challenge/)
assert.match(verificationSource, /status: "incomplete" \| "unavailable" \| "blocked"; probe: MissAVAccessProbe/)

console.log("MISSAV visible exact-route verification and scoped challenge cleanup passed")


import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { compileProductionModule as compile } from "./production-module.mjs"

globalThis.Storage = { get: () => undefined }
const { parseMissAVSources } = await import(compile("../html-parser.ts"))
const pack = (payload, radix, words, count = words.length) => `<script>eval(function(p,a,c,k,e,d){globalThis.remoteScriptExecuted=true;}('${payload}',${radix},${count},'${words.join("|")}'.split('|'),0,{}))</script>`
const words = ["source", "https", "cdn", "example", "1080p", "video", "m3u8", "token", "fresh"]
const valid = pack("0=\\'1://2.3/4/5.6?7=8\\';", 16, words)

if (process.argv.includes("--bounded-malformed")) {
  // The former overlapping escape alternatives failed to terminate in this
  // case. Keep the test in a bounded child so a regression cannot hang CI.
  const malformed = `<script>eval(function(p,a,c,k,e,d){x}('${"\\".repeat(52)}' MALFORMED</script>`
  assert.equal(parseMissAVSources(malformed + valid)[0].url, "https://cdn.example/1080p/video.m3u8?token=fresh")
  process.exit(0)
}
const bounded = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--bounded-malformed"], { timeout: 2_000, encoding: "utf8" })
assert.equal(bounded.error, undefined, `Malformed script parsing exceeded deadline: ${bounded.error?.code}`)
assert.equal(bounded.status, 0, "Malformed script must not prevent a later valid source")
assert.equal(parseMissAVSources(valid)[0].url, "https://cdn.example/1080p/video.m3u8?token=fresh")
assert.equal(globalThis.remoteScriptExecuted, undefined, "Remote JavaScript is never executed")
const base62 = Array(62).fill("")
base62[0] = "https"; base62[36] = "cdn"; base62[61] = "example"
const uppercase = pack("source=\\'0://A.Z/720p/video.m3u8\\'", 62, base62)
assert.equal(parseMissAVSources(uppercase)[0].url, "https://cdn.example/720p/video.m3u8")
assert.equal(parseMissAVSources(valid + uppercase).length, 2, "Distinct packed scripts keep distinct qualities")
assert.equal(parseMissAVSources(pack("0", 63, words)).length, 0)
assert.equal(parseMissAVSources(pack("0", 16, words, 999_999)).length, 0)
assert.equal(parseMissAVSources(pack("0", 16, words).replace("{globalThis", `{${" ".repeat(512_001)}globalThis`) + valid).length, 1, "Oversized script is skipped without losing the next valid block")
assert.equal(parseMissAVSources(pack("0 0 0 0 0 0", 2, ["x".repeat(400_000), ""]) + valid).length, 1, "Dictionary expansion is bounded without losing the next valid block")
console.log("PASS: bounded malformed packer parsing; no remote eval; signed URL preservation; radix 16/62; multiple scripts and input limits")

// Execute production download + parser modules; only the host/network is mocked.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const compiled = new Map()
const cue = text => `1\n00:00:30,240 --> 00:00:31,246\n${text}`
const file = { source: "SubtitleCat", id: "fns-258-zh-cn", language: "简体中文", details: "", isFree: true, isDemo: false, downloadURL: "https://www.subtitlecat.com/subs/1/FNS-258.zh-CN.srt" }
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
function harness() {
  const requests = [], modules = new Map()
  let clock = 1_000_000, parses = 0
  const load = path => {
    if (modules.has(path)) return modules.get(path).exports
    if (!compiled.has(path)) compiled.set(path, babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code)
    const module = { exports: {} }; modules.set(path, module)
    new Function("require", "module", "exports", "Thread", "Date", compiled.get(path))(specifier => {
      if (specifier === "scripting") return { Script: {}, fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options,
        finish(content, { status = 200, size } = {}) { resolve({ ok: status >= 200 && status < 300, status, headers: { get: () => size || null }, text: async () => content }) },
        fail: reject,
      })) }
      return load(resolve(dirname(path), `${specifier}.ts`))
    }, module, module.exports, { runInBackground: async compute => { parses++; return compute() } }, { now: () => clock })
    return module.exports
  }
  return { api: load(fileURLToPath(new URL("../subtitlecat.ts", import.meta.url))), requests,
    advance(ms) { clock += ms }, get parses() { return parses } }
}

const shared = harness()
const preview = shared.api.downloadSubtitleCatFile(file)
const importFile = shared.api.downloadSubtitleCatFile(file)
assert.equal(shared.requests.length, 1, "Concurrent consumers share exactly one HTTP request")
shared.requests[0].finish(cue("有效对白"))
assert.deepEqual(await Promise.all([preview, importFile]), [cue("有效对白"), cue("有效对白")])
assert.equal(shared.parses, 1)
assert.equal(await shared.api.downloadSubtitleCatFile(file), cue("有效对白"))
assert.equal(shared.requests.length, 1, "Preview then download reuses the validated content")
shared.advance(5 * 60 * 1000 + 1)
const refreshed = shared.api.downloadSubtitleCatFile(file)
shared.requests[1].finish(cue("服务器更新的字幕"))
assert.equal(await refreshed, cue("服务器更新的字幕"))
assert.equal(shared.parses, 2)

const redirects = shared.requests[0].options.handleRedirect
assert.equal(await redirects({ url: "https://www.subtitlecat.com/login" }), null)
assert.equal(await redirects({ url: "https://example.com/file.srt" }), null)
assert.ok(await redirects({ url: file.downloadURL }))
for (const unsafe of [{ ...file, isDemo: true }, { ...file, isFree: false }, { ...file, downloadURL: "https://example.com/subs/1/a.srt" }, { ...file, downloadURL: "https://www.subtitlecat.com/index.php" }]) {
  await assert.rejects(shared.api.downloadSubtitleCatFile(unsafe), /免费|不安全/)
}
await assert.rejects(shared.api.downloadSubtitleCatFile({ ...file, language: "英语", downloadURL: "https://www.subtitlecat.com/subs/1/FNS-258-en.srt" }), /仅支持下载简体中文或繁体中文/)

for (const [content, options, expected] of [
  ["<html><body>error</body></html>", {}, /没有返回字幕/],
  [cue("字幕由 Transub Pro 生成 [ www.transub.cc ]"), {}, /有效对白/],
  ["not subtitles", {}, /有效对白/],
  [cue("正常对白"), { status: 403 }, /HTTP 403/],
  [cue("正常对白"), { size: "24000001" }, /过大/],
  ["1\n00:00:99,000 --> 00:01:01,000\n错误时间", {}, /有效对白/],
]) {
  const failure = harness()
  const first = failure.api.downloadSubtitleCatFile(file)
  failure.requests[0].finish(content, options)
  await assert.rejects(first, expected)
  const retry = failure.api.downloadSubtitleCatFile(file)
  assert.equal(failure.requests.length, 2, "Failed downloads must not poison future retries")
  failure.requests[1].finish(cue("重试后的有效对白"))
  assert.equal(await retry, cue("重试后的有效对白"))
}
const network = harness()
const networkFailed = network.api.downloadSubtitleCatFile(file)
network.requests[0].fail(new Error("timeout"))
await assert.rejects(networkFailed, /timeout/)
const networkRetry = network.api.downloadSubtitleCatFile(file)
network.requests[1].finish(cue("网络恢复"))
await networkRetry

const memoryOnly = harness()
for (let i = 0; i < 5; i++) {
  const download = memoryOnly.api.downloadSubtitleCatFile({ ...file, downloadURL: `https://www.subtitlecat.com/subs/1/TEST-${i}.srt` })
  memoryOnly.requests.at(-1).finish(cue(`对白 ${i}`)); await download
}
const evicted = memoryOnly.api.downloadSubtitleCatFile({ ...file, downloadURL: "https://www.subtitlecat.com/subs/1/TEST-0.srt" })
assert.equal(memoryOnly.requests.length, 6, "RAM content cache is bounded, without any filesystem eviction")
memoryOnly.requests.at(-1).finish(cue("对白 0")); await evicted
await settle()
console.log("PASS: production download/parser dedup, preview reuse, TTL/memory bounds, redirects, invalid/ad/HTML/oversize rejection and retry")

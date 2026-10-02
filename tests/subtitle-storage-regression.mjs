// Run actual subtitle storage against a mocked native filesystem, not iPhone permissions.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const path = fileURLToPath(new URL("../subtitles.ts", import.meta.url))
const compiled = babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code
const cue = text => `1\n00:00:01,000 --> 00:00:03,000\n${text}`
const scriptDirectory = "/mock/scripts/MISSAV"
const newPath = code => `${scriptDirectory}/subtitles/${code}.srt`
const oldPath = code => `/mock/documents/MISSAV Subtitles/${code}.srt`
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

function harness() {
  const files = new Map()
  const preferences = new Map()
  const directories = []
  const writes = []
  const warnings = []
  const script = { directory: `${scriptDirectory}///` }
  let writeHook = async () => {}
  const module = { exports: {} }
  new Function("require", "module", "exports", "FileManager", "Storage", "console", compiled)(specifier => {
    assert.equal(specifier, "scripting")
    return { Script: script }
  }, module, module.exports, {
    documentsDirectory: "/mock/documents/",
    exists: async path => files.has(path),
    createDirectory: async (path, recursive) => { assert.equal(recursive, true); directories.push(path) },
    readAsString: async path => { assert.ok(files.has(path)); return files.get(path) },
    writeAsString: async (path, content) => { await writeHook(path, content); files.set(path, content); writes.push(path) },
    remove: () => { throw new Error("Downloaded subtitles must never be evicted") },
  }, { get: key => preferences.get(key), set: (key, value) => preferences.set(key, value) }, { warn: (...args) => warnings.push(args) })
  return { api: module.exports, files, preferences, directories, writes, warnings, script,
    setWriteHook(hook) { writeHook = hook },
  }
}

const saved = harness()
assert.equal(await saved.api.saveMissAVSubtitle(" fns-258 ", cue("当前作品字幕")), 1)
assert.ok(saved.files.has(newPath("FNS-258")))
assert.ok(saved.directories.every(path => path === `${scriptDirectory}/subtitles`))
assert.ok(!saved.files.has(oldPath("FNS-258")), "New downloads must not be placed in the old Documents folder")
assert.equal((await saved.api.loadMissAVSubtitle("FNS-258")).cues[0].text, "当前作品字幕")
for (let index = 0; index < 120; index++) await saved.api.saveMissAVSubtitle(`TEST-${index}`, cue(`字幕 ${index}`))
assert.equal(saved.files.size, 121, "Downloaded subtitle counts must not inherit the 50-code search cache limit")
assert.ok(saved.files.has(newPath("TEST-0")) && saved.files.has(newPath("TEST-119")))
assert.equal(await saved.api.hasMissAVSubtitle("MISSING-1"), false)
const beforeInvalid = saved.files.size
await assert.rejects(saved.api.saveMissAVSubtitle("INVALID-1", "Not an SRT"), /没有识别到有效对白/)
assert.equal(saved.files.size, beforeInvalid)

const legacy = harness()
legacy.files.set(oldPath("FNS-258"), cue("旧文件对白"))
legacy.api.setMissAVSubtitleEnabled("FNS-258", false)
const migrated = await legacy.api.loadMissAVSubtitle("FNS-258")
assert.equal(migrated.cues[0].text, "旧文件对白")
assert.equal(legacy.files.get(newPath("FNS-258")), legacy.files.get(oldPath("FNS-258")))
assert.ok(legacy.files.has(oldPath("FNS-258")), "Retain the original as a recoverable copy")
assert.equal(legacy.api.isMissAVSubtitleEnabled("FNS-258"), false, "Migration cannot enable a disabled track")
await legacy.api.saveMissAVSubtitle("FNS-258", cue("新下载字幕"))
assert.equal((await legacy.api.loadMissAVSubtitle("FNS-258")).cues[0].text, "新下载字幕", "Prefer the script's subtitle over its legacy copy")

const readOnly = harness()
readOnly.files.set(oldPath("OLD-1"), cue("旧文件仍可播放"))
readOnly.setWriteHook(async () => { throw new Error("Read-only script directory") })
assert.equal((await readOnly.api.loadMissAVSubtitle("OLD-1")).cues[0].text, "旧文件仍可播放")
assert.equal(readOnly.warnings.length, 1)
await assert.rejects(readOnly.api.saveMissAVSubtitle("NEW-1", cue("保存失败")), /Read-only/)
assert.equal(readOnly.api.isMissAVSubtitleEnabled("NEW-1"), true, "Failed writes must not leave an explicit preference")
assert.equal(readOnly.preferences.size, 0)

const race = harness()
race.files.set(oldPath("RACE-1"), cue("旧字幕"))
let release
let blocked = true
race.setWriteHook(async () => {
  if (blocked) { blocked = false; await new Promise(resolve => { release = resolve }) }
})
const migrating = race.api.loadMissAVSubtitle("RACE-1")
await settle()
assert.ok(release)
const downloading = race.api.saveMissAVSubtitle("RACE-1", cue("新下载不能被旧字幕覆盖"))
release()
await Promise.all([migrating, downloading])
assert.equal((await race.api.loadMissAVSubtitle("RACE-1")).cues[0].text, "新下载不能被旧字幕覆盖")

const duplicateRead = harness()
duplicateRead.files.set(oldPath("OLD-2"), cue("兼容字幕"))
await Promise.all([duplicateRead.api.loadMissAVSubtitle("OLD-2"), duplicateRead.api.loadMissAVSubtitle("OLD-2")])
assert.equal(duplicateRead.writes.length, 1, "Concurrent readers migrate once")
const missingDirectory = harness()
missingDirectory.script.directory = ""
await assert.rejects(missingDirectory.api.saveMissAVSubtitle("TEST-1", cue("没有目录")), /无法获取当前脚本目录/)
assert.equal(missingDirectory.files.size, 0)
console.log("PASS: script-local subtitles folder; 121 retained downloads; legacy migration/fallback; unchanged preferences; safe concurrent migration and save")

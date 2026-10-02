// Run actual subtitle storage against a mocked native filesystem, not iPhone permissions.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const path = fileURLToPath(new URL("../subtitles.ts", import.meta.url))
const compiledModules = new Map()
const compile = path => {
  if (!compiledModules.has(path)) compiledModules.set(path, babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code)
  return compiledModules.get(path)
}
const cue = text => `1\n00:00:01,000 --> 00:00:03,000\n${text}`
const scriptDirectory = "/mock/scripts/MISSAV"
const newPath = code => `${scriptDirectory}/subtitles/${code}.srt`
const oldPath = code => `/mock/documents/MISSAV Subtitles/${code}.srt`
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

function harness(background = false) {
  const files = new Map()
  const preferences = new Map()
  const directories = []
  const writes = []
  const warnings = []
  const script = { directory: `${scriptDirectory}///` }
  let writeHook = async () => {}
  let renameHook = async () => {}
  let backgroundTasks = 0, inBackground = false
  let computeHook = async compute => compute()
  const thread = background ? { async runInBackground(compute) {
    backgroundTasks++; inBackground = true
    try { return await computeHook(compute) } finally { inBackground = false }
  } } : undefined
  const nativeFiles = {
    documentsDirectory: "/mock/documents/",
    exists: async path => files.has(path),
    createDirectory: async (path, recursive) => { assert.equal(recursive, true); directories.push(path) },
    readAsString: async path => { assert.ok(files.has(path)); return files.get(path) },
    writeAsString: async (path, content) => { assert.equal(inBackground, false); await writeHook(path, content); files.set(path, content); writes.push(path) },
    rename: async (path, target) => { await renameHook(path, target); assert.ok(files.has(path)); assert.ok(!files.has(target)); files.set(target, files.get(path)); files.delete(path) },
    remove: async path => { assert.match(path, /\.srt\.(pending|previous)$/); files.delete(path) },
  }
  const nativeStorage = { get: key => preferences.get(key), set: (key, value) => { assert.equal(inBackground, false); preferences.set(key, value) } }
  const modules = new Map()
  const load = path => {
    if (modules.has(path)) return modules.get(path).exports
    const module = { exports: {} }; modules.set(path, module)
    new Function("require", "module", "exports", "FileManager", "Storage", "console", "Thread", compile(path))(specifier => {
      if (specifier === "scripting") return { Script: script }
      return load(resolve(dirname(path), `${specifier}.ts`))
    }, module, module.exports, nativeFiles, nativeStorage, { warn: (...args) => warnings.push(args) }, thread)
    return module.exports
  }
  return { api: load(path), files, preferences, directories, writes, warnings, script,
    get backgroundTasks() { return backgroundTasks },
    setComputeHook(hook) { computeHook = hook },
    setWriteHook(hook) { writeHook = hook },
    setRenameHook(hook) { renameHook = hook },
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
const threaded = harness(true)
assert.equal(await threaded.api.saveMissAVSubtitle("THREAD-1", cue("后台解析对白")), 1)
assert.equal((await threaded.api.loadMissAVSubtitle("THREAD-1")).cues[0].text, "后台解析对白")
assert.equal(threaded.backgroundTasks, 2, "Save parsing and serialization run in background; load reuses parsed content, native writes stay on the caller thread")
const slowParse = harness(true)
let releaseParse
slowParse.setComputeHook(async compute => {
  if (!releaseParse) await new Promise(resolve => { releaseParse = resolve })
  return compute()
})
const olderDownload = slowParse.api.saveMissAVSubtitle("ORDER-1", cue("较早的下载"))
await settle()
assert.equal(typeof releaseParse, "function")
const newerDownload = slowParse.api.saveMissAVSubtitle("ORDER-1", cue("较新的下载"))
await settle()
assert.equal(slowParse.backgroundTasks, 1, "A later download queues before its background parse starts")
releaseParse()
await Promise.all([olderDownload, newerDownload])
assert.equal((await slowParse.api.loadMissAVSubtitle("ORDER-1")).cues[0].text, "较新的下载", "A slower earlier parse cannot overwrite a newer download")
console.log("PASS: script-local subtitles folder; 121 retained downloads; legacy migration/fallback; unchanged preferences; safe concurrent migration/save; actual background compute integration")

const failedWrite = harness()
await failedWrite.api.saveMissAVSubtitle("SAFE-1", cue("原字幕"))
failedWrite.api.setMissAVSubtitleEnabled("SAFE-1", false)
failedWrite.setWriteHook(async path => { failedWrite.files.set(path, "partial"); throw new Error("disk full") })
await assert.rejects(failedWrite.api.saveMissAVSubtitle("SAFE-1", cue("新字幕")), /disk full/)
assert.equal((await failedWrite.api.loadMissAVSubtitle("SAFE-1")).cues[0].text, "原字幕")
assert.equal(failedWrite.api.isMissAVSubtitleEnabled("SAFE-1"), false)
assert.equal(failedWrite.files.size, 1, "Failed staging cleanup cannot remove the original SRT")

const failedRename = harness()
await failedRename.api.saveMissAVSubtitle("SAFE-2", cue("可恢复字幕"))
failedRename.setRenameHook(async path => { if (path.endsWith(".pending")) throw new Error("rename failed") })
await assert.rejects(failedRename.api.saveMissAVSubtitle("SAFE-2", cue("替换字幕")), /rename failed/)
assert.equal((await failedRename.api.loadMissAVSubtitle("SAFE-2")).cues[0].text, "可恢复字幕")
assert.equal(failedRename.files.size, 1, "Commit failure restores the previous file")

const failedRestore = harness()
await failedRestore.api.saveMissAVSubtitle("SAFE-3", cue("恢复后仍可用"))
failedRestore.setRenameHook(async path => { if (/\.(pending|previous)$/.test(path)) throw new Error("filesystem unavailable") })
await assert.rejects(failedRestore.api.saveMissAVSubtitle("SAFE-3", cue("保存失败")), /原字幕保留/)
assert.equal(failedRestore.files.size, 1)
assert.ok(failedRestore.files.has(`${newPath("SAFE-3")}.previous`))
failedRestore.setRenameHook(async () => {})
assert.equal((await failedRestore.api.loadMissAVSubtitle("SAFE-3")).cues[0].text, "恢复后仍可用")
assert.ok(failedRestore.files.has(newPath("SAFE-3")))

const crash = harness()
crash.files.set(`${newPath("CRASH-1")}.previous`, cue("中断前字幕"))
crash.files.set(`${newPath("CRASH-1")}.pending`, "incomplete")
assert.equal((await crash.api.loadMissAVSubtitle("CRASH-1")).cues[0].text, "中断前字幕")
await crash.api.saveMissAVSubtitle("CRASH-1", cue("中断后重新下载"))
assert.equal(crash.files.size, 1)

const edited = harness(true)
await edited.api.saveMissAVSubtitle("EDIT-1", cue("缓存字幕"))
await edited.api.loadMissAVSubtitle("EDIT-1")
await edited.api.loadMissAVSubtitle("EDIT-1")
assert.equal(edited.backgroundTasks, 2)
edited.files.set(newPath("EDIT-1"), cue("用户编辑的字幕"))
assert.equal((await edited.api.loadMissAVSubtitle("EDIT-1")).cues[0].text, "用户编辑的字幕")
assert.equal(edited.backgroundTasks, 3, "Changed file contents invalidate the parsed cache")
assert.equal(edited.api.parseSubtitleTrack("1\n00:99:01,000 --> 00:99:02,000\n错误时间").cues.length, 0)
console.log("PASS: failed staging/rename/restore, interrupted-write recovery, preserved enabled preferences and manual-edit cache invalidation")

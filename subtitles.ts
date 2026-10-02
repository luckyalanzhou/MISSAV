import { Script } from "scripting"
import { runMissAVDataTask } from "./background-data"

export type SubtitleCue = {
  startSeconds: number
  endSeconds: number
  text: string
}

export type SubtitleTrack = {
  cues: SubtitleCue[]
  prefixMaxEndSeconds: number[]
}

const SUBTITLE_DIRECTORY_NAME = "subtitles"
const LEGACY_SUBTITLE_DIRECTORY_NAME = "MISSAV Subtitles"
const SUBTITLE_ENABLED_KEY_PREFIX = "missav_subtitle_enabled_v1_"
const MAX_SUBTITLE_CHARACTERS = 8_000_000
const MAX_SUBTITLE_CUES = 25_000
// Serialize operations on one work only; there is no retained-file count limit.
const subtitleFileOperations = new Map<string, Promise<unknown>>()
// This bounds RAM only, never the number of downloaded files. Read the file on
// every load so a manually edited/imported subtitle cannot remain stale.
const parsedTracks = new Map<string, SubtitleTrack>()
const pendingParses = new Map<string, Promise<SubtitleTrack>>()
const MAX_PARSE_CACHE_CHARACTERS = 2_000_000

const parseTimestamp = (value: string): number | null => {
  const long = value.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/)
  if (long) {
    const hours = Number(long[1])
    const minutes = Number(long[2])
    const seconds = Number(long[3])
    const milliseconds = Number(long[4].padEnd(3, "0"))
    if (!Number.isFinite(hours) || minutes >= 60 || seconds >= 60) return null
    const total = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
    return Number.isFinite(total) ? total : null
  }

  const short = value.trim().match(/^(\d{2}):(\d{2})\.(\d{1,3})$/)
  if (!short) return null
  const minutes = Number(short[1])
  const seconds = Number(short[2])
  const milliseconds = Number(short[3].padEnd(3, "0"))
  if (seconds >= 60) return null
  return minutes * 60 + seconds + milliseconds / 1000
}

const normalizeCueText = (lines: string[]): string => lines
  .join(" ")
  .replace(/<[^>]*>/g, "")
  .replace(/\{\\[^}]*\}/g, "")
  .replace(/&nbsp;/gi, " ")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ")
  .trim()

export function parseSubtitleTrack(source: string): SubtitleTrack {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  if (normalized.length > MAX_SUBTITLE_CHARACTERS) throw new Error("单个字幕文件过大，无法读取。")
  const cues: SubtitleCue[] = []

  for (const block of normalized.split(/\n\s*\n/)) {
    const lines = block.split("\n")
    const timingIndex = lines.findIndex(line => line.includes("-->"))
    if (timingIndex < 0) continue

    const [startValue, endValue] = lines[timingIndex].split("-->", 2)
    const startSeconds = startValue ? parseTimestamp(startValue.trim()) : null
    const endToken = endValue?.trim().split(/\s+/, 1)[0]
    const endSeconds = endToken ? parseTimestamp(endToken) : null
    const text = normalizeCueText(lines.slice(timingIndex + 1))
    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds || !text || isSubtitleAttributionCue(text)) continue
    cues.push({ startSeconds, endSeconds, text })
    if (cues.length > MAX_SUBTITLE_CUES) throw new Error("单个字幕文件的对白条目过多，无法读取。")
  }

  cues.sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds)
  let maxEndSeconds = Number.NEGATIVE_INFINITY
  const prefixMaxEndSeconds = cues.map(cue => {
    maxEndSeconds = Math.max(maxEndSeconds, cue.endSeconds)
    return maxEndSeconds
  })
  return { cues, prefixMaxEndSeconds }
}

export async function hasMissAVSubtitle(videoCode: string): Promise<boolean> {
  return (await loadMissAVSubtitle(videoCode)) !== null
}

export function isMissAVSubtitleEnabled(videoCode: string): boolean {
  return Storage.get<boolean>(subtitleEnabledKey(videoCode)) !== false
}

export function setMissAVSubtitleEnabled(videoCode: string, enabled: boolean): void {
  Storage.set(subtitleEnabledKey(videoCode), enabled)
}

export async function loadMissAVSubtitle(videoCode: string): Promise<SubtitleTrack | null> {
  const path = subtitleFilePath(videoCode)
  return withSubtitleFileOperation(path, async () => {
    await recoverSubtitleWrite(path)
    if (await FileManager.exists(path)) {
      const content = await FileManager.readAsString(path)
      const track = await parseMissAVSubtitle(content)
      return track.cues.length ? track : null
    }
    const legacyPath = `${FileManager.documentsDirectory.replace(/[\\/]+$/, "")}/${LEGACY_SUBTITLE_DIRECTORY_NAME}/${normalizeVideoCode(videoCode)}.srt`
    if (!await FileManager.exists(legacyPath)) return null
    const content = await FileManager.readAsString(legacyPath)
    const track = await parseMissAVSubtitle(content)
    if (!track.cues.length) return null
    try {
      await writeSubtitleSafely(path, content)
    } catch (error) {
      // Continue playing the old file if migration cannot write. Do not delete
      // the original or change this video's enabled/disabled preference.
      console.warn("迁移旧字幕失败，继续读取原文件:", error)
    }
    return track
  })
}

export async function saveMissAVSubtitle(videoCode: string, source: string): Promise<number> {
  const path = subtitleFilePath(videoCode)
  // Queue before dispatching background work. Otherwise a slow earlier parse
  // could finish last and overwrite a newer download for the same video.
  return withSubtitleFileOperation(path, async () => {
    const track = await parseMissAVSubtitle(source)
    if (!track.cues.length) throw new Error("没有识别到有效对白字幕，下载内容可能只有字幕生成器署名。")
    const content = await runMissAVDataTask("subtitle-serialize", () => serializeSubtitleTrack(track))
    await writeSubtitleSafely(path, content)
    rememberParsedTrack(content, track)
    setMissAVSubtitleEnabled(videoCode, true)
    return track.cues.length
  })
}

export async function parseMissAVSubtitle(source: string): Promise<SubtitleTrack> {
  const cached = parsedTracks.get(source)
  if (cached) { parsedTracks.delete(source); parsedTracks.set(source, cached); return cached }
  const pending = pendingParses.get(source)
  if (pending) return pending
  const task = runMissAVDataTask("subtitle-parse", () => parseSubtitleTrack(source))
  pendingParses.set(source, task)
  try {
    const track = await task
    if (track.cues.length) rememberParsedTrack(source, track)
    return track
  } finally { if (pendingParses.get(source) === task) pendingParses.delete(source) }
}

function rememberParsedTrack(content: string, track: SubtitleTrack): void {
  if (content.length > MAX_PARSE_CACHE_CHARACTERS) return
  parsedTracks.delete(content)
  parsedTracks.set(content, track)
  let characters = 0
  for (const key of parsedTracks.keys()) characters += key.length
  while (parsedTracks.size > 4 || characters > MAX_PARSE_CACHE_CHARACTERS) {
    const first = parsedTracks.keys().next().value as string
    characters -= first.length
    parsedTracks.delete(first)
  }
}

// rename never depends on overwriting an existing destination. A crash between
// the two renames leaves the old file recoverable as .previous on the next read.
async function recoverSubtitleWrite(path: string): Promise<void> {
  const previous = `${path}.previous`
  if (!await FileManager.exists(previous)) return
  if (!await FileManager.exists(path)) { await FileManager.rename(previous, path); return }
  const track = await parseMissAVSubtitle(await FileManager.readAsString(path))
  if (!track.cues.length) throw new Error("字幕写入恢复需要处理，原字幕仍保存在 .previous 文件中。")
  await removeSubtitleTemporary(previous)
}

async function removeSubtitleTemporary(path: string): Promise<void> {
  // Only these exact per-work staging/backup names may be removed, never .srt.
  if (!/\.srt\.(pending|previous)$/.test(path)) throw new Error("字幕临时文件路径无效。")
  try { if (await FileManager.exists(path)) await FileManager.remove(path) }
  catch { /* Keep a recoverable temporary copy if cleanup is unavailable. */ }
}

async function writeSubtitleSafely(path: string, content: string): Promise<void> {
  await FileManager.createDirectory(subtitleDirectoryPath(), true)
  await recoverSubtitleWrite(path)
  const pending = `${path}.pending`, previous = `${path}.previous`
  let backedUp = false
  try {
    await FileManager.writeAsString(pending, content)
    if (await FileManager.readAsString(pending) !== content) throw new Error("字幕文件写入不完整，已保留原字幕。")
    if (await FileManager.exists(path)) {
      // Unremoved backup must not be silently overwritten by a host rename.
      if (await FileManager.exists(previous)) throw new Error("旧字幕备份尚未清理，请稍后重试。")
      await FileManager.rename(path, previous)
      backedUp = true
    }
    await FileManager.rename(pending, path)
    await removeSubtitleTemporary(previous)
  } catch (error) {
    if (backedUp && !await FileManager.exists(path)) {
      try { await FileManager.rename(previous, path) }
      catch { throw new Error("保存字幕失败；原字幕保留在 .previous 文件，下次读取将尝试恢复。") }
    }
    throw error
  } finally { await removeSubtitleTemporary(pending) }
}

function withSubtitleFileOperation<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = subtitleFileOperations.get(path) ?? Promise.resolve()
  const result = previous.catch(() => {}).then(operation)
  subtitleFileOperations.set(path, result)
  const cleanup = () => { if (subtitleFileOperations.get(path) === result) subtitleFileOperations.delete(path) }
  void result.then(cleanup, cleanup)
  return result
}

function serializeSubtitleTrack(track: SubtitleTrack): string {
  return track.cues.map((cue, index) => `${index + 1}\n${formatTimestamp(cue.startSeconds)} --> ${formatTimestamp(cue.endSeconds)}\n${cue.text}`).join("\n\n")
}

function subtitleFilePath(videoCode: string): string {
  return `${subtitleDirectoryPath()}/${normalizeVideoCode(videoCode)}.srt`
}

function subtitleDirectoryPath(): string {
  const scriptDirectory = typeof Script.directory === "string" ? Script.directory.replace(/[\\/]+$/, "") : ""
  if (!scriptDirectory) throw new Error("无法获取当前脚本目录，字幕未保存。")
  return `${scriptDirectory}/${SUBTITLE_DIRECTORY_NAME}`
}

function subtitleEnabledKey(videoCode: string): string {
  return `${SUBTITLE_ENABLED_KEY_PREFIX}${normalizeVideoCode(videoCode)}`
}

function normalizeVideoCode(videoCode: string): string {
  const safeCode = videoCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "")
  if (!safeCode) throw new Error("作品番号无效，无法关联字幕。")
  return safeCode
}

function isSubtitleAttributionCue(text: string): boolean {
  return /(?:字幕由|generated\s+by|subtitles?\s+by)/i.test(text)
    && /(?:transub(?:\s+pro)?|transub\.cc)/i.test(text)
}

function formatTimestamp(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMilliseconds / 3_600_000)
  const minutes = Math.floor(totalMilliseconds / 60_000) % 60
  const wholeSeconds = Math.floor(totalMilliseconds / 1000) % 60
  const milliseconds = totalMilliseconds % 1000
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`
}

export function findSubtitleCue(track: SubtitleTrack, timeSeconds: number): SubtitleCue | null {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || !track.cues.length) return null

  let low = 0
  let high = track.cues.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (track.cues[middle].startSeconds <= timeSeconds) low = middle + 1
    else high = middle
  }

  for (let index = low - 1; index >= 0; index -= 1) {
    if (track.prefixMaxEndSeconds[index] <= timeSeconds) break
    const cue = track.cues[index]
    if (cue.startSeconds <= timeSeconds && timeSeconds < cue.endSeconds) return cue
  }
  return null
}

export const MISSAV_SUBTITLE_PREVIEW = parseSubtitleTrack(`1
00:00:01,000 --> 00:00:05,500
本地字幕测试：应在横屏底部单行显示

2
00:00:05,500 --> 00:00:11,500
拖动播放进度，字幕应切换到这一行

3
00:00:11,500 --> 99:59:59,999
暂停时字幕保持，继续播放后按时间更新
`)

import { Path } from "scripting"

export type MissAVSubtitleCue = { startSeconds: number; endSeconds: number; text: string }

const SUBTITLE_DIRECTORY = Path.join(FileManager.documentsDirectory, "MISSAV Subtitles")
const SUBTITLE_ENABLED_KEY_PREFIX = "missav_subtitle_enabled_v1_"
const MAX_SUBTITLE_CHARACTERS = 8_000_000
const MAX_SUBTITLE_CUES = 25_000
const subtitleEndIndexCache = new WeakMap<readonly MissAVSubtitleCue[], number[]>()

export function parseMissAVSubtitleText(input: string): MissAVSubtitleCue[] {
  const source = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  if (source.length > MAX_SUBTITLE_CHARACTERS) throw new Error("字幕文件过大，无法导入。")

  const cues: MissAVSubtitleCue[] = []
  for (const block of source.split(/\n\s*\n+/)) {
    const lines = block.split("\n").map(line => line.trimEnd())
    const timingLineIndex = lines.findIndex(line => line.includes("-->"))
    if (timingLineIndex < 0) continue

    const timing = lines[timingLineIndex].split("-->")
    if (timing.length !== 2) continue
    const startSeconds = parseSubtitleTimestamp(timing[0].trim().split(/\s+/)[0])
    const endSeconds = parseSubtitleTimestamp(timing[1].trim().split(/\s+/)[0])
    const text = lines.slice(timingLineIndex + 1).join("\n").trim()
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .trim()

    if (startSeconds == null || endSeconds == null || endSeconds <= startSeconds || !text) continue
    cues.push({ startSeconds, endSeconds, text })
    if (cues.length > MAX_SUBTITLE_CUES) throw new Error("字幕条目过多，无法导入。")
  }

  return cues.sort((left, right) => left.startSeconds - right.startSeconds)
}

export function findMissAVSubtitleCue(cues: readonly MissAVSubtitleCue[], timeSeconds: number): MissAVSubtitleCue | null {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || cues.length === 0) return null
  let low = 0
  let high = cues.length - 1
  let candidate = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (cues[middle].startSeconds <= timeSeconds) {
      candidate = middle
      low = middle + 1
    } else high = middle - 1
  }
  if (candidate < 0) return null

  let prefixMaximum = subtitleEndIndexCache.get(cues)
  if (!prefixMaximum) {
    prefixMaximum = []
    let maximum = 0
    for (const cue of cues) {
      maximum = Math.max(maximum, cue.endSeconds)
      prefixMaximum.push(maximum)
    }
    subtitleEndIndexCache.set(cues, prefixMaximum)
  }
  low = 0
  high = candidate
  let earliestPossible = candidate + 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (prefixMaximum[middle] > timeSeconds) {
      earliestPossible = middle
      high = middle - 1
    } else low = middle + 1
  }
  for (let index = candidate; index >= earliestPossible; index--) {
    const cue = cues[index]
    if (cue.startSeconds <= timeSeconds && timeSeconds < cue.endSeconds) return cue
  }
  return null
}

export function serializeMissAVSubtitleCues(cues: readonly MissAVSubtitleCue[]): string {
  return cues.map((cue, index) => `${index + 1}\n${formatSubtitleTimestamp(cue.startSeconds)} --> ${formatSubtitleTimestamp(cue.endSeconds)}\n${cue.text}`).join("\n\n")
}

export async function hasMissAVSubtitle(videoCode: string): Promise<boolean> {
  return FileManager.exists(subtitleFilePath(videoCode))
}

export function isMissAVSubtitleEnabled(videoCode: string): boolean {
  return Storage.get<boolean>(subtitleEnabledKey(videoCode)) !== false
}

export function setMissAVSubtitleEnabled(videoCode: string, enabled: boolean): void {
  Storage.set(subtitleEnabledKey(videoCode), enabled)
}

export async function loadMissAVSubtitle(videoCode: string): Promise<MissAVSubtitleCue[] | null> {
  const path = subtitleFilePath(videoCode)
  if (!await FileManager.exists(path)) return null
  const content = await FileManager.readAsString(path)
  const cues = parseMissAVSubtitleText(content)
  if (!cues.length) throw new Error("已保存的字幕文件没有有效字幕，请重新导入。")
  return cues
}

export async function saveMissAVSubtitle(videoCode: string, content: string): Promise<number> {
  const cues = parseMissAVSubtitleText(content)
  if (!cues.length) throw new Error("没有识别到有效字幕。请选择标准 SRT 或 WebVTT 字幕文件。")
  await FileManager.createDirectory(SUBTITLE_DIRECTORY, true)
  await FileManager.writeAsString(subtitleFilePath(videoCode), serializeMissAVSubtitleCues(cues))
  return cues.length
}

export async function removeMissAVSubtitle(videoCode: string): Promise<void> {
  const path = subtitleFilePath(videoCode)
  if (await FileManager.exists(path)) await FileManager.remove(path)
}

function subtitleFilePath(videoCode: string): string {
  const safeCode = normalizeVideoCode(videoCode)
  return Path.join(SUBTITLE_DIRECTORY, `${safeCode}.srt`)
}

function subtitleEnabledKey(videoCode: string): string {
  return `${SUBTITLE_ENABLED_KEY_PREFIX}${normalizeVideoCode(videoCode)}`
}

function normalizeVideoCode(videoCode: string): string {
  const safeCode = videoCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "")
  if (!safeCode) throw new Error("作品番号无效，无法关联字幕。")
  return safeCode
}

function parseSubtitleTimestamp(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1] || 0)
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const milliseconds = Number(match[4].padEnd(3, "0").slice(0, 3))
  if (minutes >= 60 || seconds >= 60) return null
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
}

function formatSubtitleTimestamp(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMilliseconds / 3_600_000)
  const minutes = Math.floor(totalMilliseconds / 60_000) % 60
  const wholeSeconds = Math.floor(totalMilliseconds / 1000) % 60
  const milliseconds = totalMilliseconds % 1000
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`
}

export type SubtitleCue = {
  startSeconds: number
  endSeconds: number
  text: string
}

export type SubtitleTrack = {
  cues: SubtitleCue[]
  prefixMaxEndSeconds: number[]
}

const SUBTITLE_DIRECTORY_NAME = "MISSAV Subtitles"
const SUBTITLE_ENABLED_KEY_PREFIX = "missav_subtitle_enabled_v1_"
const MAX_SUBTITLE_CHARACTERS = 8_000_000
const MAX_SUBTITLE_CUES = 25_000

const parseTimestamp = (value: string): number | null => {
  const long = value.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/)
  if (long) {
    const hours = Number(long[1])
    const minutes = Number(long[2])
    const seconds = Number(long[3])
    const milliseconds = Number(long[4].padEnd(3, "0"))
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
  }

  const short = value.trim().match(/^(\d{2}):(\d{2})\.(\d{1,3})$/)
  if (!short) return null
  const minutes = Number(short[1])
  const seconds = Number(short[2])
  const milliseconds = Number(short[3].padEnd(3, "0"))
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
  if (normalized.length > MAX_SUBTITLE_CHARACTERS) throw new Error("字幕文件过大，无法缓存。")
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
    if (cues.length > MAX_SUBTITLE_CUES) throw new Error("字幕条目过多，无法缓存。")
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
  if (!await FileManager.exists(path)) return null
  const track = parseSubtitleTrack(await FileManager.readAsString(path))
  if (!track.cues.length) return null
  return track
}

export async function saveMissAVSubtitle(videoCode: string, source: string): Promise<number> {
  const track = parseSubtitleTrack(source)
  if (!track.cues.length) throw new Error("没有识别到有效对白字幕，下载内容可能只有字幕生成器署名。")
  await FileManager.createDirectory(subtitleDirectoryPath(), true)
  await FileManager.writeAsString(subtitleFilePath(videoCode), serializeSubtitleTrack(track))
  setMissAVSubtitleEnabled(videoCode, true)
  return track.cues.length
}

function serializeSubtitleTrack(track: SubtitleTrack): string {
  return track.cues.map((cue, index) => `${index + 1}\n${formatTimestamp(cue.startSeconds)} --> ${formatTimestamp(cue.endSeconds)}\n${cue.text}`).join("\n\n")
}

function subtitleFilePath(videoCode: string): string {
  return `${subtitleDirectoryPath()}/${normalizeVideoCode(videoCode)}.srt`
}

function subtitleDirectoryPath(): string {
  const documentsDirectory = FileManager.documentsDirectory.replace(/[\\/]+$/, "")
  return `${documentsDirectory}/${SUBTITLE_DIRECTORY_NAME}`
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

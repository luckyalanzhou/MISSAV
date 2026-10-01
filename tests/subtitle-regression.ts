import { Script } from "scripting"
import { findSubtitleCue, MISSAV_SUBTITLE_PREVIEW, parseSubtitleTrack } from "../subtitles"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const run = (): void => {
  const srt = parseSubtitleTrack(`\uFEFF1\r\n00:00:01,2 --> 00:00:03,500\r\n<i>第一行</i>\r\n字幕第二行\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\n第二条字幕`)
  assert(srt.cues.length === 2, "SRT 应解析出有效字幕段")
  assert(srt.cues[0].text === "第一行 字幕第二行", "字幕换行应合并为单行并清理基础标签")
  assert(findSubtitleCue(srt, 1.2)?.text === "第一行 字幕第二行", "字幕起始时间应包含在显示区间内")
  assert(findSubtitleCue(srt, 3.5) === null, "字幕结束时间应为不包含的边界")
  assert(findSubtitleCue(srt, 4.5)?.text === "第二条字幕", "时间跳转后应匹配新字幕")

  const vtt = parseSubtitleTrack(`WEBVTT\n\nintro\n00:01.000 --> 00:02.250 align:start\nVTT 字幕`)
  assert(vtt.cues.length === 1 && findSubtitleCue(vtt, 1.5)?.text === "VTT 字幕", "WebVTT 时间戳和设置应正确解析")

  const overlapping = parseSubtitleTrack(`1\n00:00:01,000 --> 00:00:05,000\n较早但较长\n\n2\n00:00:03,000 --> 00:00:04,000\n较新的重叠字幕`)
  assert(findSubtitleCue(overlapping, 3.5)?.text === "较新的重叠字幕", "重叠区间应优先选择最近开始的字幕")
  assert(findSubtitleCue(overlapping, Number.NaN) === null, "无效播放时间不应显示字幕")
  assert(findSubtitleCue(MISSAV_SUBTITLE_PREVIEW, 30)?.text === "暂停时字幕保持，继续播放后按时间更新", "本地叠层预览应在视频播放超过 20 秒后仍可见")

  Script.exit({ passed: 9, message: "MISSAV subtitle parser and timing regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }

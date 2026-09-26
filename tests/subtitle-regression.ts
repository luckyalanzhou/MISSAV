import { Script } from "scripting"
import { findMissAVSubtitleCue, parseMissAVSubtitleText, serializeMissAVSubtitleCues } from "../subtitles"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const run = (): void => {
  const cues = parseMissAVSubtitleText("\uFEFF1\r\n00:00:01,200 --> 00:00:03,500\r\n<i>Hello &amp; welcome</i>\r\nsecond line\r\n\r\n2\r\n00:00:04.000 --> 00:00:05.250\r\nNext")
  assert(cues.length === 2, "应读取 SRT 多条字幕")
  assert(cues[0].startSeconds === 1.2 && cues[0].endSeconds === 3.5, "应正确解析 SRT 时间戳")
  assert(cues[0].text === "Hello & welcome\nsecond line", "应清理基础标签并保留换行")
  assert(findMissAVSubtitleCue(cues, 1.2)?.text === cues[0].text, "字幕开始时刻应显示字幕")
  assert(findMissAVSubtitleCue(cues, 3.5) === null, "字幕结束时刻不应继续显示字幕")
  assert(findMissAVSubtitleCue(cues, 4.5)?.text === "Next", "应支持点号毫秒格式")
  const overlap = parseMissAVSubtitleText("1\n00:00:00,000 --> 00:00:20,000\nLong cue\n\n2\n00:00:04,000 --> 00:00:04,500\nShort cue")
  assert(findMissAVSubtitleCue(overlap, 5)?.text === "Long cue", "应处理较早字幕与后续字幕时间重叠")

  const vtt = parseMissAVSubtitleText("WEBVTT\n\n00:01.000 --> 00:02.000 align:start\n<v Speaker>Caption</v>")
  assert(vtt.length === 1 && vtt[0].startSeconds === 1 && vtt[0].text === "Caption", "应支持 WebVTT 时间和常见文本标签")
  assert(parseMissAVSubtitleText("not a subtitle file").length === 0, "无效字幕应返回空结果")
  assert(serializeMissAVSubtitleCues(vtt).includes("00:00:01,000 --> 00:00:02,000"), "应可将 WebVTT 规范化为 SRT")
  Script.exit({ passed: 10, message: "MISSAV subtitle regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }

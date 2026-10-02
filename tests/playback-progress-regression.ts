import { Script } from "scripting"
import { formatMissAVContinueWatching, resolveMissAVResumePosition } from "../playback-progress"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const run = (): void => {
  assert(resolveMissAVResumePosition(undefined, undefined, 0) === 0, "没有已保存进度时应从头播放")
  assert(resolveMissAVResumePosition(2, 100, 100) === 0, "不足 5 秒的进度不应续播")
  assert(resolveMissAVResumePosition(123.9, 600, 600) === 123, "中途退出应恢复到向下取整后的上次位置")
  assert(resolveMissAVResumePosition(96, 100, 100) === 0, "已播放到 95% 以上时应从头开始")
  assert(resolveMissAVResumePosition(700, 800, 600) === 0, "应以当前媒体时长判断是否已接近播放结束")
  assert(formatMissAVContinueWatching(754.9) === "继续观看 · 12:34", "历史记录应显示上次保存的播放秒数，不是清晰度或日期")
  assert(formatMissAVContinueWatching(3723.9) === "继续观看 · 1:02:03", "超过一小时的进度应保留小时")
  for (const position of [undefined, NaN, Infinity, -1, 0]) assert(formatMissAVContinueWatching(position) === "继续观看 · 00:00", "无有效进度的旧记录应显示零，不能显示 NaN 或负时间")
  assert(formatMissAVContinueWatching(59.9) === "继续观看 · 00:59", "显示时间应向下取整，不能提前跨分钟")
  assert(formatMissAVContinueWatching(60) === "继续观看 · 01:00", "分钟边界应正确格式化")
  assert(formatMissAVContinueWatching(3600) === "继续观看 · 1:00:00", "小时边界应正确格式化")
  Script.exit({ passed: 15, message: "MISSAV playback progress and history label regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }

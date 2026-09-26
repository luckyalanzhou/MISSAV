import { Script } from "scripting"
import { resolveMissAVResumePosition } from "../playback-progress"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const run = (): void => {
  assert(resolveMissAVResumePosition(undefined, undefined, 0) === 0, "没有已保存进度时应从头播放")
  assert(resolveMissAVResumePosition(2, 100, 100) === 0, "不足 5 秒的进度不应续播")
  assert(resolveMissAVResumePosition(123.9, 600, 600) === 123, "中途退出应恢复到向下取整后的上次位置")
  assert(resolveMissAVResumePosition(96, 100, 100) === 0, "已播放到 95% 以上时应从头开始")
  assert(resolveMissAVResumePosition(700, 800, 600) === 0, "应以当前媒体时长判断是否已接近播放结束")
  Script.exit({ passed: 5, message: "MISSAV playback progress regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }

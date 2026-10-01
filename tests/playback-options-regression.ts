import { Script } from "scripting"
import { DEFAULT_PLAYBACK_OPTIONS, normalizePlaybackOptions } from "../playback-options"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

try {
  assert(JSON.stringify(normalizePlaybackOptions(undefined)) === JSON.stringify(DEFAULT_PLAYBACK_OPTIONS), "首次播放应使用默认字号和字幕位置")
  assert(normalizePlaybackOptions(null).subtitleFontSize === 17, "空存储值应回退默认设置")
  assert(normalizePlaybackOptions("invalid").subtitleBottomInset === 64, "非对象设置应安全回退")
  assert(normalizePlaybackOptions({ subtitleFontSize: 100 }).subtitleFontSize === 32, "字号应限制上界")
  assert(normalizePlaybackOptions({ subtitleFontSize: -1 }).subtitleFontSize === 14, "字号应限制下界")
  assert(normalizePlaybackOptions({ subtitleFontSize: 23.4 }).subtitleFontSize === 23, "字号应使用整数")
  assert(normalizePlaybackOptions({ subtitleFontSize: Number.NaN }).subtitleFontSize === 17, "无效字号应回退")
  assert(normalizePlaybackOptions({ subtitleBottomInset: 0 }).subtitleBottomInset === 24, "位置应保留底部安全距离")
  assert(normalizePlaybackOptions({ subtitleBottomInset: 999 }).subtitleBottomInset === 160, "位置不能无限向上移动")
  assert(normalizePlaybackOptions({ subtitleBottomInset: Number.POSITIVE_INFINITY }).subtitleBottomInset === 64, "无穷位置应回退")
  assert(JSON.stringify(normalizePlaybackOptions({ pictureMode: "stretch" })) === JSON.stringify(DEFAULT_PLAYBACK_OPTIONS), "旧画面比例设置应被忽略并交给原生播放器")
  Script.exit({ passed: 11, message: "MISSAV playback options regression tests passed" })
} catch (error) {
  Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) })
}

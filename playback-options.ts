export type PictureMode = "fit" | "fill" | "stretch"

export type PlaybackOptions = {
  subtitleFontSize: number
  subtitleBottomInset: number
  pictureMode: PictureMode
}

export const SUBTITLE_FONT_RANGE = { min: 14, max: 32, step: 1 }
export const SUBTITLE_POSITION_RANGE = { min: 24, max: 160, step: 1 }
export const DEFAULT_PLAYBACK_OPTIONS: PlaybackOptions = {
  subtitleFontSize: 17,
  subtitleBottomInset: 64,
  pictureMode: "fit",
}
export const PICTURE_MODES: Array<{ value: PictureMode; title: string; gravity: "resizeAspect" | "resizeAspectFill" | "resize" }> = [
  { value: "fit", title: "适应屏幕", gravity: "resizeAspect" },
  { value: "fill", title: "裁切全屏", gravity: "resizeAspectFill" },
  { value: "stretch", title: "拉伸全屏", gravity: "resize" },
]
const STORAGE_KEY = "missav_playback_options_v1"

function boundedNumber(value: unknown, fallback: number, range: { min: number; max: number }): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(range.max, Math.max(range.min, Math.round(value)))
    : fallback
}

export function normalizePlaybackOptions(value: unknown): PlaybackOptions {
  const options = value && typeof value === "object" ? value as Partial<PlaybackOptions> : {}
  return {
    subtitleFontSize: boundedNumber(options.subtitleFontSize, DEFAULT_PLAYBACK_OPTIONS.subtitleFontSize, SUBTITLE_FONT_RANGE),
    subtitleBottomInset: boundedNumber(options.subtitleBottomInset, DEFAULT_PLAYBACK_OPTIONS.subtitleBottomInset, SUBTITLE_POSITION_RANGE),
    pictureMode: PICTURE_MODES.some(mode => mode.value === options.pictureMode) ? options.pictureMode! : "fit",
  }
}

export function loadPlaybackOptions(): PlaybackOptions {
  return normalizePlaybackOptions(Storage.get<PlaybackOptions>(STORAGE_KEY))
}

export function savePlaybackOptions(options: PlaybackOptions): void {
  Storage.set(STORAGE_KEY, normalizePlaybackOptions(options))
}

export function pictureGravity(mode: PictureMode): "resizeAspect" | "resizeAspectFill" | "resize" {
  return PICTURE_MODES.find(item => item.value === mode)?.gravity ?? "resizeAspect"
}

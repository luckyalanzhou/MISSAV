export type PlaybackOptions = {
  subtitleFontSize: number
  subtitleBottomInset: number
}

export const SUBTITLE_FONT_RANGE = { min: 14, max: 32, step: 1 }
export const SUBTITLE_POSITION_RANGE = { min: 24, max: 160, step: 1 }
export const DEFAULT_PLAYBACK_OPTIONS: PlaybackOptions = {
  subtitleFontSize: 17,
  subtitleBottomInset: 64,
}
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
  }
}

export function loadPlaybackOptions(): PlaybackOptions {
  return normalizePlaybackOptions(Storage.get<PlaybackOptions>(STORAGE_KEY))
}

export function savePlaybackOptions(options: PlaybackOptions): void {
  Storage.set(STORAGE_KEY, normalizePlaybackOptions(options))
}

const MINIMUM_RESUME_POSITION_SECONDS = 5
const COMPLETED_RATIO = 0.95

export function formatMissAVContinueWatching(positionSeconds: number | undefined): string {
  const seconds = positionSeconds != null && Number.isFinite(positionSeconds) ? Math.max(0, Math.floor(positionSeconds)) : 0
  const hours = Math.floor(seconds / 3600)
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, "0")
  const remainder = String(seconds % 60).padStart(2, "0")
  return `继续观看 · ${hours > 0 ? `${hours}:` : ""}${minutes}:${remainder}`
}

export function resolveMissAVResumePosition(savedPosition: number | undefined, savedDuration: number | undefined, currentDuration: number): number {
  if (savedPosition == null || !Number.isFinite(savedPosition) || savedPosition < MINIMUM_RESUME_POSITION_SECONDS) return 0
  const duration = Number.isFinite(currentDuration) && currentDuration > 0 ? currentDuration : savedDuration || 0
  if (duration > 0 && savedPosition / duration >= COMPLETED_RATIO) return 0
  return Math.floor(savedPosition)
}

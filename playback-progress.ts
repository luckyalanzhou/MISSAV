const MINIMUM_RESUME_POSITION_SECONDS = 5
const COMPLETED_RATIO = 0.95

export function resolveMissAVResumePosition(savedPosition: number | undefined, savedDuration: number | undefined, currentDuration: number): number {
  if (savedPosition == null || !Number.isFinite(savedPosition) || savedPosition < MINIMUM_RESUME_POSITION_SECONDS) return 0
  const duration = Number.isFinite(currentDuration) && currentDuration > 0 ? currentDuration : savedDuration || 0
  if (duration > 0 && savedPosition / duration >= COMPLETED_RATIO) return 0
  return Math.floor(savedPosition)
}

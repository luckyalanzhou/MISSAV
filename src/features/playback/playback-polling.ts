// Scripting's host guarantees setTimeout/clearTimeout, not browser interval APIs.
// Keep only one pending timeout, and cancel it when the player/view is closed.
export function startPlaybackPolling(callback: () => void, intervalMilliseconds: number): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = () => {
    timer = undefined
    if (cancelled) return
    try {
      callback()
    } finally {
      // A transient callback error must not silently end all future updates.
      if (!cancelled) timer = setTimeout(tick, intervalMilliseconds)
    }
  }

  timer = setTimeout(tick, intervalMilliseconds)
  return () => {
    cancelled = true
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
}

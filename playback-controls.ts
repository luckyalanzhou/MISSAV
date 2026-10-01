// Native AVPlayerView does not expose transport-bar visibility. This controls only
// the script's buttons, using the same tap/idle interaction without stealing taps.
export const PLAYBACK_CONTROLS_HIDE_DELAY = 3_000

export function createPlaybackControls(onVisibilityChanged: (visible: boolean) => void) {
  let visible = true
  let playing = false
  let pinned = false
  let disposed = false
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const cancel = () => {
    generation += 1
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const setVisible = (value: boolean) => {
    if (value === visible) return
    visible = value
    onVisibilityChanged(value)
  }
  const schedule = () => {
    cancel()
    if (disposed || !visible || !playing || pinned) return
    const current = generation
    timer = setTimeout(() => {
      if (disposed || current !== generation) return
      timer = undefined
      if (playing && !pinned) setVisible(false)
    }, PLAYBACK_CONTROLS_HIDE_DELAY)
  }
  const show = () => {
    if (disposed) return
    setVisible(true)
    schedule()
  }
  return {
    show,
    toggle: () => {
      if (disposed) return
      if (pinned || !playing) { show(); return }
      setVisible(!visible)
      schedule()
    },
    setPlaying: (value: boolean) => {
      if (disposed || playing === value) return
      playing = value
      if (!playing) show()
      else schedule()
    },
    setPinned: (value: boolean) => {
      if (disposed) return
      pinned = value
      show()
    },
    dispose: () => { disposed = true; cancel() },
  }
}

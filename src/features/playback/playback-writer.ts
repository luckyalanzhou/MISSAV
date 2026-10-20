type Snapshot = { position: number; duration: number }

// At most one native write and one latest pending snapshot. A slow database
// cannot accumulate an unbounded chain of stale five-second samples.
export function createPlaybackProgressWriter(save: (position: number, duration: number) => Promise<void> | void, onError: (error: unknown) => void) {
  let pending: Snapshot | undefined
  let lastQueued: Snapshot | undefined
  let running: Promise<void> | undefined
  const same = (a: Snapshot | undefined, b: Snapshot) => a?.position === b.position && a?.duration === b.duration
  const start = () => {
    if (running) return
    running = Promise.resolve().then(async () => {
      while (pending) {
        const snapshot = pending; pending = undefined
        try { await save(snapshot.position, snapshot.duration) }
        catch (error) {
          if (same(lastQueued, snapshot)) lastQueued = undefined
          try { onError(error) } catch { /* Error reporting must not strand cleanup. */ }
        }
      }
    }).finally(() => { running = undefined; if (pending) start() })
  }
  return {
    enqueue(position: number, duration: number) {
      if (!Number.isFinite(position) || position < 0) return
      const snapshot = { position, duration: Number.isFinite(duration) && duration > 0 ? duration : 0 }
      if (same(lastQueued, snapshot)) return
      lastQueued = snapshot; pending = snapshot; start()
    },
    async flush() { while (running) await running },
  }
}

export class MissAVRequestCancelledError extends Error {
  constructor() { super("页面请求已取消。"); this.name = "MissAVRequestCancelledError" }
}

// Scripting's native WebView has no documented stopLoading API. Cancel our
// work, release its controller, and prevent late callbacks from using it.
export class MissAVRequestScope {
  cancelled = false
  private listeners = new Set<() => void>()

  assertActive(): void { if (this.cancelled) throw new MissAVRequestCancelledError() }
  onCancel(listener: () => void): () => void {
    if (this.cancelled) { listener(); return () => {} }
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    const listeners = [...this.listeners]
    this.listeners.clear()
    for (const listener of listeners) {
      try { listener() } catch { /* One native cleanup failure must not strand other owners. */ }
    }
  }
  waitFor<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const remove = this.onCancel(() => reject(new MissAVRequestCancelledError()))
      promise.then(value => { remove(); this.cancelled ? reject(new MissAVRequestCancelledError()) : resolve(value) }, error => { remove(); reject(error) })
    })
  }
}

export function isMissAVRequestCancelled(error: unknown): boolean { return error instanceof MissAVRequestCancelledError }

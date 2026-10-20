import { MissAVRequestScope } from "./request-scope"

// One owner for the access gate, context changes and native request lifetime.
export class MissAVAccessSession {
  revision = 0
  private gate: { promise: Promise<void>; release(): void } | null = null
  private scopes = new Set<MissAVRequestScope>()
  private listeners = new Set<() => void>()

  get verifying(): boolean { return this.gate !== null }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  track(scope: MissAVRequestScope): () => void {
    scope.assertActive()
    this.scopes.add(scope)
    return () => { this.scopes.delete(scope) }
  }
  async wait(scope: MissAVRequestScope): Promise<void> {
    scope.assertActive()
    while (this.gate) { await scope.waitFor(this.gate.promise); scope.assertActive() }
  }
  invalidate(): void {
    this.revision += 1
    for (const scope of [...this.scopes]) scope.cancel()
    this.notify()
  }
  beginVerification(): () => void {
    if (this.gate) throw new Error("访问线路验证正在进行。")
    let release!: () => void
    const gate = { promise: new Promise<void>(resolve => { release = resolve }), release: () => release() }
    this.gate = gate
    this.invalidate()
    return () => {
      if (this.gate !== gate) return
      this.gate = null
      gate.release()
      this.notify()
    }
  }
  private notify(): void {
    for (const listener of [...this.listeners]) {
      try { listener() } catch { /* One observer cannot interrupt access cleanup. */ }
    }
  }
}

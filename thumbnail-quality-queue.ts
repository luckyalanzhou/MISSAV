import type { MissAVVideoItem } from "./client"
import { MissAVRequestScope } from "./request-scope"

type CachedQuality = { key: string; height: number | null; expiresAt: number }
type Job = { key: string; context: string; video: MissAVVideoItem; listeners: Set<(height: number | null) => void>; pending: boolean }
type Options = {
  key: (video: MissAVVideoItem) => string
  context: () => string
  canStart: () => boolean
  load: (video: MissAVVideoItem, scope: MissAVRequestScope) => Promise<number | null>
  read: () => unknown
  write: (values: CachedQuality[]) => void
}

export function validQualityHeight(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 144 && value <= 8640
}

// One visible work at a time. Entries contain quality metadata, never media URLs.
export class ThumbnailQualityQueue {
  private cache = new Map<string, CachedQuality>()
  private jobs = new Map<string, Job>()
  private loaded = false
  private active: { job: Job; scope: MissAVRequestScope } | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private blockedContext: string | null = null
  private paused = false

  private options: Options
  constructor(options: Options) { this.options = options }

  private cached(key: string): CachedQuality | undefined {
    if (!this.loaded) {
      this.loaded = true
      try {
        const values = this.options.read()
        if (Array.isArray(values)) for (const value of values.slice(-500)) {
          if (typeof value?.key === "string" && validQualityHeight(value.height)
            && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now()
            && value.expiresAt <= Date.now() + 24 * 60 * 60_000) this.cache.set(value.key, { ...value })
        }
      } catch { /* A missing or damaged optional cache must not affect lists. */ }
    }
    const value = this.cache.get(key)
    if (value && value.expiresAt > Date.now()) return value
    this.cache.delete(key)
    return undefined
  }

  watch(video: MissAVVideoItem, listener: (height: number | null) => void): () => void {
    const key = this.options.key(video)
    const context = this.options.context()
    let job = this.jobs.get(key)
    if (job && job.context !== context) {
      if (this.active?.job === job) this.active.scope.cancel()
      this.jobs.delete(key)
      job = undefined
    }
    const cached = this.cached(key)
    if (!job) {
      job = { key, context, video: { ...video }, listeners: new Set(), pending: !cached }
      this.jobs.set(key, job)
    }
    job.listeners.add(listener)
    listener(cached?.height ?? null)
    this.schedule()
    const owned = job
    return () => {
      owned.listeners.delete(listener)
      if (owned.listeners.size) return
      if (this.jobs.get(key) === owned) this.jobs.delete(key)
      if (this.active?.job === owned) this.active.scope.cancel()
      if (!this.jobs.size && this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    }
  }

  pause(): void { this.paused = true; this.active?.scope.cancel(); if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined }
  resume(): void { this.paused = false; this.schedule() }

  private schedule(): void {
    if (this.paused || this.active || this.timer !== undefined) return
    const context = this.options.context()
    if (this.blockedContext === context || ![...this.jobs.values()].some(job => job.pending && job.context === context)) return
    // Avoid requests for rows flashed past during a quick scroll.
    this.timer = setTimeout(() => { this.timer = undefined; void this.pump() }, 300)
  }

  private async pump(): Promise<void> {
    if (this.paused || this.active) return
    if (!this.options.canStart()) { this.schedule(); return }
    const context = this.options.context()
    if (context === this.blockedContext) return
    const job = [...this.jobs.values()].find(value => value.pending && value.context === context)
    if (!job) return
    const scope = new MissAVRequestScope()
    const active = { job, scope }
    this.active = active
    try {
      const height = await scope.waitFor(this.options.load(job.video, scope))
      scope.assertActive()
      if (job.context !== this.options.context() || !job.listeners.size) return
      const resolved = validQualityHeight(height) ? height : null
      this.cache.set(job.key, { key: job.key, height: resolved, expiresAt: Date.now() + (resolved ? 24 * 60 * 60_000 : 10 * 60_000) })
      while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!)
      job.pending = false
      for (const listener of job.listeners) listener(resolved)
      try { this.options.write([...this.cache.values()].filter(value => value.height !== null && value.expiresAt > Date.now())) } catch { /* Memory results remain usable. */ }
    } catch (error) {
      // A deadline also cancels its scope. Only retry cancellation while a
      // foreground operation/minimize actually has priority, not timeouts.
      if ((!scope.cancelled || (!this.paused && this.options.canStart())) && job.listeners.size && job.context === this.options.context()) {
        job.pending = false
        this.cache.set(job.key, { key: job.key, height: null, expiresAt: Date.now() + 60_000 })
        while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!)
        if (/Cloudflare|站点拒绝|HTTP (?:403|429)/i.test(error instanceof Error ? error.message : "")) this.blockedContext = job.context
      }
    } finally {
      if (this.active === active) this.active = null
      this.schedule()
    }
  }
}

export function highestSourceQuality(sources: ReadonlyArray<{ qualityHeight?: number }>): number | null {
  const heights = sources.map(source => source.qualityHeight).filter(validQualityHeight)
  return heights.length ? Math.max(...heights) : null
}

export function highestManifestQuality(manifest: string): number | null {
  if (!manifest.trimStart().startsWith("#EXTM3U")) return null
  const heights = [...manifest.matchAll(/^#EXT-X-STREAM-INF:[^\r\n]*\bRESOLUTION=\d+x(\d+)/gim)]
    .map(match => Number(match[1])).filter(validQualityHeight)
  return heights.length ? Math.max(...heights) : null
}

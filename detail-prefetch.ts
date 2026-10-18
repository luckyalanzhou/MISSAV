import { getMissAVBaseURL } from "./domain"
import { missavClient, MissAVRequestScope, isMissAVRequestCancelled, type MissAVVideoItem } from "./client"
import { subscribeMissAVLifecycle } from "./lifecycle"

type PrefetchJob = { key: string; context: string; video: MissAVVideoItem; watchers: number; scope?: MissAVRequestScope }

/**
 * Reads visible list items one at a time and lets detail navigation reuse the
 * most recent successful result. The queue intentionally has no UI of its
 * own: a list card remains the single place that starts and stops a job.
 */
export class DetailPrefetchQueue {
  private jobs = new Map<string, PrefetchJob>()
  private active: PrefetchJob | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private paused = false
  private blockedContext: string | null = null

  watch(video: MissAVVideoItem): () => void {
    const context = this.context()
    if (this.blockedContext && this.blockedContext !== context) this.blockedContext = null
    if (this.paused || this.blockedContext === context || missavClient.hasRecentVideoDetail(video)) return () => undefined
    const key = `${context}|${video.videoCode.toLowerCase()}`
    let job = this.jobs.get(key)
    if (!job) {
      job = { key, context, video, watchers: 0 }
      this.jobs.set(key, job)
    }
    job.watchers += 1
    const currentJob = job
    this.schedule()
    return () => {
      currentJob.watchers = Math.max(0, currentJob.watchers - 1)
      if (currentJob.watchers === 0 && this.jobs.get(key) === currentJob) this.jobs.delete(key)
      if (this.active === currentJob && currentJob.watchers === 0) currentJob.scope?.cancel()
    }
  }

  cancelAll(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
    this.jobs.clear()
    this.active?.scope?.cancel()
    this.blockedContext = null
  }

  pause(): void {
    this.paused = true
    this.cancelAll()
  }

  resume(): void {
    this.paused = false
    this.blockedContext = null
    this.schedule()
  }

  private context(): string { return `${new URL(getMissAVBaseURL()).origin}|${missavClient.detailCacheRevision}` }

  private schedule(): void {
    if (this.paused || this.active || !this.jobs.size || this.timer !== null || this.blockedContext === this.context()) return
    this.timer = setTimeout(() => { this.timer = null; void this.pump() }, 180)
  }

  private async pump(): Promise<void> {
    if (this.paused || this.active || !this.jobs.size) return
    const job = this.jobs.values().next().value as PrefetchJob | undefined
    if (!job) return
    this.jobs.delete(job.key)
    this.active = job
    const scope = new MissAVRequestScope()
    job.scope = scope
    try {
      await missavClient.getVideo(job.video, { scope })
    } catch (reason) {
      if (!isMissAVRequestCancelled(reason)) this.blockedContext = job.context
    } finally {
      if (this.active === job) this.active = null
      this.schedule()
    }
  }
}

export const detailPrefetch = new DetailPrefetchQueue()

subscribeMissAVLifecycle(event => {
  if (event.kind === "minimize") detailPrefetch.pause()
  else detailPrefetch.resume()
})

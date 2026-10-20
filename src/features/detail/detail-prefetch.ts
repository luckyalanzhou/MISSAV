import { missavClient, type MissAVVideoDetail, type MissAVVideoItem } from "../../site/client"
import { resolveMissAVURL } from "../../site/domain"
import { MissAVRequestScope, isMissAVRequestCancelled } from "../../core/request/request-scope"
import type { MissAVDetailTrace } from "../../site/detail-trace"
import { subscribeMissAVLifecycle } from "../../app/lifecycle"

type LoadOptions = { scope: MissAVRequestScope; trace?: MissAVDetailTrace }
type Dependencies = {
  context(): string
  identity?(video: MissAVVideoItem): string
  canStart(): boolean
  cached(video: MissAVVideoItem): boolean
  load(video: MissAVVideoItem, options: LoadOptions & { preferRecent: true }): Promise<MissAVVideoDetail>
  changed(listener: () => void): () => void
  delayMs?: number
}
type Task = { scope: MissAVRequestScope; promise: Promise<MissAVVideoDetail>; context: string }
type Interest = { key: string; video: MissAVVideoItem; watchers: number; consumers: number; task: Task | null; attempted: string | null }

// Visible interest survives cancellation. Background and foreground consumers
// share a task; the client owns signed-URL expiry.
export class DetailPrefetchQueue {
  private interests = new Map<string, Interest>()
  private active: Task | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private paused = false
  private context = ""
  private blockedContext: string | null = null
  private foreground = 0
  private priority: Interest | null = null

  constructor(private dependencies: Dependencies = {
    context: () => missavClient.detailContext(),
    canStart: () => missavClient.canPrefetchDetail(),
    cached: video => missavClient.hasRecentVideoDetail(video),
    load: (video, options) => missavClient.getVideo(video, options),
    changed: listener => missavClient.subscribeDetailContext(listener),
  }) {
    this.context = dependencies.context()
    dependencies.changed(() => { this.syncContext(); this.schedule() })
  }

  watch(video: MissAVVideoItem): () => void {
    this.syncContext()
    const key = this.identity(video)
    const isNew = !this.interests.has(key)
    const interest = this.interest(video)
    if (isNew) {
      this.recoverAfterFailure()
      this.priority = interest
    }
    interest.watchers += 1
    this.schedule()
    let removed = false
    return () => {
      if (removed) return
      removed = true
      interest.watchers -= 1
      this.release(interest)
    }
  }

  async load(video: MissAVVideoItem, options: LoadOptions): Promise<MissAVVideoDetail> {
    options.scope.assertActive()
    this.syncContext()
    const interest = this.interest(video)
    interest.consumers += 1
    this.foreground += 1
    if (this.active && this.active !== interest.task) this.active.scope.cancel()
    const shared = Boolean(interest.task && !interest.task.scope.cancelled)
    const task = interest.task && !interest.task.scope.cancelled ? interest.task : this.start(interest, options.trace)
    try {
      const detail = await options.scope.waitFor(task.promise)
      this.recoverAfterFailure(interest)
      if (shared) options.trace?.mark("detail-parse", { sourceCount: detail.sources.length })
      return detail
    } finally {
      interest.consumers -= 1
      this.foreground -= 1
      this.release(interest)
      this.schedule()
    }
  }

  pause(): void {
    this.paused = true
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
    for (const interest of this.interests.values()) if (!interest.consumers) interest.task?.scope.cancel()
  }
  resume(): void { this.paused = false; this.recoverAfterFailure(); this.schedule() }

  private interest(video: MissAVVideoItem): Interest {
    const key = this.identity(video)
    let interest = this.interests.get(key)
    if (!interest) {
      interest = { key, video, watchers: 0, consumers: 0, task: null, attempted: null }
      this.interests.set(key, interest)
    }
    return interest
  }
  private release(interest: Interest): void {
    if (interest.watchers || interest.consumers) return
    interest.task?.scope.cancel()
    if (this.priority === interest) this.priority = null
    if (this.interests.get(interest.key) === interest) this.interests.delete(interest.key)
  }
  private syncContext(): void {
    const context = this.dependencies.context()
    if (context === this.context) return
    this.context = context
    this.blockedContext = null
    this.priority = null
    for (const interest of this.interests.values()) { interest.task?.scope.cancel(); interest.attempted = null }
  }
  private identity(video: MissAVVideoItem): string {
    if (this.dependencies.identity) return this.dependencies.identity(video)
    const resolved = resolveMissAVURL(video.detailPath)
    try {
      const url = new URL(resolved)
      if (url.hostname === "missav.ws" || url.hostname === "missav.ai") return `${url.pathname}${url.search}`
      return url.toString()
    } catch { return resolved }
  }
  private recoverAfterFailure(successful?: Interest): void {
    if (this.blockedContext !== this.context) return
    const failedContext = this.blockedContext
    this.blockedContext = null
    for (const interest of this.interests.values()) {
      if (interest !== successful && interest.attempted === failedContext) interest.attempted = null
    }
  }
  private start(interest: Interest, trace?: MissAVDetailTrace): Task {
    const scope = new MissAVRequestScope()
    const context = this.context
    const task = { scope, context } as Task
    task.promise = scope.waitFor(Promise.resolve().then(() => {
      scope.assertActive()
      return this.dependencies.load(interest.video, { scope, trace, preferRecent: true })
    })).then(detail => {
      scope.assertActive()
      if (task.context === this.context) interest.attempted = task.context
      return detail
    }).catch(reason => {
      if (!isMissAVRequestCancelled(reason) && task.context === this.context) {
        interest.attempted = task.context
        this.blockedContext = task.context
      }
      throw reason
    }).finally(() => {
      if (interest.task === task) interest.task = null
      if (this.active === task) this.active = null
      this.release(interest)
      this.schedule()
    })
    interest.task = task
    this.active = task
    void task.promise.catch(() => {})
    return task
  }
  private schedule(): void {
    if (this.paused || this.foreground || this.active || this.timer !== null) return
    this.syncContext()
    if (this.blockedContext === this.context) return
    const eligible = (interest: Interest) => interest.watchers && !interest.task && interest.attempted !== this.context && !this.dependencies.cached(interest.video)
    const next = this.priority && eligible(this.priority) ? this.priority : [...this.interests.values()].find(eligible)
    if (!next) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.syncContext()
      if (this.paused || this.foreground || this.active || !next.watchers || next.task || this.blockedContext === this.context) { this.schedule(); return }
      if (!this.dependencies.canStart()) { this.schedule(); return }
      if (this.dependencies.cached(next.video)) { next.attempted = this.context; this.schedule(); return }
      if (this.priority === next) this.priority = null
      this.start(next)
    }, this.dependencies.delayMs ?? 180)
  }
}

export const detailPrefetch = new DetailPrefetchQueue()
subscribeMissAVLifecycle(event => {
  if (event.kind === "minimize") detailPrefetch.pause()
  else detailPrefetch.resume()
})

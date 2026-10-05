import type { MissAVSearchPage, MissAVSearchParams, MissAVVideoItem } from "./client"
import type { MissAVPlaybackRecord } from "./storage"
import { resolveMissAVResumePosition } from "./playback-progress"

export type HomeSection = "latest" | "trending"
export type HomeScreenData = {
  recent: MissAVPlaybackRecord[]
  hasRecommendationHistory: boolean
  latest: MissAVVideoItem[]
  trending: MissAVVideoItem[]
  loading: Record<HomeSection, boolean>
  errors: Record<HomeSection | "history", string | null>
}
export function emptyHomeScreenData(): HomeScreenData {
  return { recent: [], hasRecommendationHistory: false, latest: [], trending: [], loading: { latest: true, trending: true }, errors: { latest: null, trending: null, history: null } }
}
export function continueWatchingRecords(records: MissAVPlaybackRecord[]): MissAVPlaybackRecord[] {
  return records.filter(record => resolveMissAVResumePosition(record.positionSeconds, record.durationSeconds, 0) > 0).slice(0, 5)
}
export function playbackProgressFraction(record: MissAVPlaybackRecord): number | undefined {
  if (!record.durationSeconds || !Number.isFinite(record.durationSeconds) || record.durationSeconds <= 0) return undefined
  return Math.min(1, Math.max(0, (record.positionSeconds || 0) / record.durationSeconds))
}

type Scope = { cancelled: boolean; cancel(): void }
type Dependencies = {
  history(): Promise<MissAVPlaybackRecord[]>
  recommendationHistory?(): Promise<boolean>
  cached(params: MissAVSearchParams): Promise<MissAVSearchPage | null>
  search(params: MissAVSearchParams, scope: Scope, force: boolean): Promise<MissAVSearchPage>
  scope(): Scope
  changed(data: HomeScreenData): void
  now?: () => number
}
const queries: Record<HomeSection, MissAVSearchParams> = {
  latest: { collection: "new", page: 1, sort: "published_at", filter: "" },
  trending: { collection: "today-hot", page: 1, sort: "today_views", filter: "" },
}

// One owner per HomeTab/domain. Local data never waits for WebKit or listings.
export class HomeScreenLoader {
  private data = emptyHomeScreenData()
  private disposed = false
  private localGeneration = 0
  private remoteGeneration = 0
  private active: { scope: Scope; promise: Promise<void> } | null = null
  private freshUntil: Record<HomeSection, number> = { latest: 0, trending: 0 }
  private retryAfter: Record<HomeSection, number> = { latest: 0, trending: 0 }
  private dependencies: Dependencies
  constructor(dependencies: Dependencies) { this.dependencies = dependencies }
  private publish(patch: Partial<HomeScreenData>) {
    if (this.disposed) return
    this.data = { ...this.data, ...patch }
    this.dependencies.changed(this.data)
  }
  async loadLocal() {
    if (this.disposed) return
    const generation = ++this.localGeneration
    let records: MissAVPlaybackRecord[] | undefined
    try {
      records = await this.dependencies.history()
      if (this.disposed || generation !== this.localGeneration) return
      this.publish({ recent: continueWatchingRecords(records), hasRecommendationHistory: records.length > 0 || this.data.hasRecommendationHistory, errors: { ...this.data.errors, history: null } })
    } catch {
      if (this.disposed || generation !== this.localGeneration) return
      if (!this.dependencies.recommendationHistory) this.publish({ errors: { ...this.data.errors, history: "播放记录暂时无法读取。" } })
    }
    if (this.dependencies.recommendationHistory && !this.disposed && generation === this.localGeneration) {
      try {
        const hasBrowseHistory = await this.dependencies.recommendationHistory()
        if (this.disposed || generation !== this.localGeneration) return
        this.publish({ hasRecommendationHistory: Boolean(records?.length) || hasBrowseHistory, errors: { ...this.data.errors, history: records ? null : "播放记录暂时无法读取。" } })
      } catch {
        if (!this.disposed && generation === this.localGeneration && !records) this.publish({ errors: { ...this.data.errors, history: "本机历史记录暂时无法读取。" } })
      }
    }
  }
  loadRemote(force = false): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.active && !force) return this.active.promise
    const now = this.dependencies.now?.() ?? Date.now()
    const sections = (["latest", "trending"] as HomeSection[]).filter(section => force || now >= Math.max(this.freshUntil[section], this.retryAfter[section]))
    if (!sections.length) return Promise.resolve()
    this.active?.scope.cancel()
    const generation = ++this.remoteGeneration
    const scope = this.dependencies.scope()
    const valid = () => !this.disposed && generation === this.remoteGeneration && !scope.cancelled
    const tasks = sections.map(async section => {
      this.publish({ loading: { ...this.data.loading, [section]: true }, errors: { ...this.data.errors, [section]: null } })
      try {
        if (!force && !this.data[section].length) {
          try {
            const cached = await this.dependencies.cached(queries[section])
            if (!valid()) return
            if (cached) this.publish({ [section]: cached.items.slice(0, 6) })
          } catch { /* An optional cache read cannot block online recovery. */ }
        }
        if (!valid()) return
        const result = await this.dependencies.search(queries[section], scope, force)
        if (!valid()) return
        const finishedAt = this.dependencies.now?.() ?? Date.now()
        if (result.stale || result.refreshError) this.retryAfter[section] = finishedAt + 10_000
        else this.freshUntil[section] = finishedAt + 90_000
        this.publish({ [section]: result.items.slice(0, 6), errors: { ...this.data.errors, [section]: result.refreshError || (result.stale ? "当前显示缓存内容，请稍后刷新。" : null) } })
      } catch (reason) {
        if (valid()) {
          this.retryAfter[section] = (this.dependencies.now?.() ?? Date.now()) + 10_000
          this.publish({ errors: { ...this.data.errors, [section]: reason instanceof Error ? reason.message : String(reason) } })
        }
      } finally {
        if (valid()) this.publish({ loading: { ...this.data.loading, [section]: false } })
      }
    })
    const owner = { scope, promise: Promise.all(tasks).then(() => {}) }
    this.active = owner
    void owner.promise.finally(() => { if (this.active === owner) this.active = null })
    return owner.promise
  }
  refresh(): Promise<void> { return Promise.all([this.loadLocal(), this.loadRemote(true)]).then(() => {}) }
  dispose() {
    this.disposed = true
    ++this.localGeneration; ++this.remoteGeneration
    this.active?.scope.cancel()
    this.active = null
  }
}

import { missavClient, type MissAVVideoItem } from "./client"
import { recommendationProfile, tokenize } from "./database"

export type MissAVRecommendation = { video: MissAVVideoItem; score: number; reason: string }

const CANDIDATE_TTL = 3 * 60 * 1000
let candidateCache: { expiresAt: number; items: MissAVVideoItem[] } | null = null
let candidatePromise: Promise<MissAVVideoItem[]> | null = null

async function loadCandidates(): Promise<MissAVVideoItem[]> {
  if (candidateCache && candidateCache.expiresAt > Date.now()) return candidateCache.items
  if (candidatePromise) return candidatePromise
  candidatePromise = (async () => {
    const pages = await Promise.allSettled([
      missavClient.searchVideoPage({ collection: "today-hot", page: 1, sort: "today_views", filter: "" }),
      missavClient.searchVideoPage({ collection: "weekly-hot", page: 1, sort: "weekly_views", filter: "" }),
      missavClient.searchVideoPage({ collection: "new", page: 1, sort: "released_at", filter: "" }),
    ])
    const candidates = new Map<string, MissAVVideoItem>()
    for (const result of pages) if (result.status === "fulfilled") for (const video of result.value.items) candidates.set(video.videoCode, video)
    const items = [...candidates.values()]
    candidateCache = { expiresAt: Date.now() + CANDIDATE_TTL, items }
    return items
  })()
  try { return await candidatePromise } finally { candidatePromise = null }
}

export async function loadLocalRecommendations(limit = 20): Promise<MissAVRecommendation[]> {
  const [profile, sourceItems] = await Promise.all([recommendationProfile(), loadCandidates()])
  const candidates = sourceItems.filter(video => !profile.excluded.has(video.videoCode))
  const hasProfile = profile.terms.size > 0
  return candidates.map((video, index) => {
    const terms = tokenize(`${video.title} ${video.videoCode}`)
    const matched = terms.map(term => ({ term, weight: profile.terms.get(term) || 0 })).filter(item => item.weight > 0).sort((a, b) => b.weight - a.weight)
    const affinity = matched.reduce((sum, item) => sum + item.weight, 0)
    const freshness = Math.max(0, 24 - index) * 0.08
    const score = hasProfile ? affinity + freshness : freshness
    const reason = matched[0] ? `因为你关注过“${displayTerm(matched[0].term)}”相关内容` : hasProfile ? "结合近期热门与本地浏览偏好" : "根据当前热门内容推荐"
    return { video, score, reason }
  }).sort((a, b) => b.score - a.score).slice(0, limit)
}

function displayTerm(value: string): string { return value.length > 18 ? `${value.slice(0, 18)}…` : value.toUpperCase() }

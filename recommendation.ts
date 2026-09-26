import { missavClient, type MissAVVideoItem } from "./client"
import { recommendationProfile, tokenize } from "./database"
import { getMissAVBaseURL } from "./domain"

export type MissAVRecommendation = { video: MissAVVideoItem; score: number; reason: string }

const CANDIDATE_TTL = 3 * 60 * 1000
let candidateCache: { domain: string; expiresAt: number; items: MissAVVideoItem[] } | null = null
const candidatePromises = new Map<string, Promise<MissAVVideoItem[]>>()

async function loadCandidates(forceRefresh = false): Promise<MissAVVideoItem[]> {
  const domain = getMissAVBaseURL()
  if (!forceRefresh && candidateCache?.domain === domain && candidateCache.expiresAt > Date.now()) return candidateCache.items.map(item => ({ ...item }))
  const existing = candidatePromises.get(domain)
  if (!forceRefresh && existing) return existing.then(items => items.map(item => ({ ...item })))
  let request: Promise<MissAVVideoItem[]>
  request = (async () => {
    const pages = await Promise.allSettled([
      missavClient.searchVideoPage({ collection: "today-hot", page: 1, sort: "today_views", filter: "" }, { forceRefresh }),
      missavClient.searchVideoPage({ collection: "weekly-hot", page: 1, sort: "weekly_views", filter: "" }, { forceRefresh }),
      missavClient.searchVideoPage({ collection: "new", page: 1, sort: "released_at", filter: "" }, { forceRefresh }),
    ])
    if (pages.every(result => result.status === "rejected")) throw new Error("无法获取推荐候选内容，请检查网络后重试。")
    const candidates = new Map<string, MissAVVideoItem>()
    for (const result of pages) if (result.status === "fulfilled") for (const video of result.value.items) candidates.set(video.videoCode, video)
    const items = [...candidates.values()]
    if (pages.some(result => result.status === "fulfilled") && candidatePromises.get(domain) === request) {
      candidateCache = { domain, expiresAt: Date.now() + CANDIDATE_TTL, items }
    }
    return items
  })()
  candidatePromises.set(domain, request)
  try { return (await request).map(item => ({ ...item })) }
  finally { if (candidatePromises.get(domain) === request) candidatePromises.delete(domain) }
}

export async function loadLocalRecommendations(limit = 20, forceRefresh = false): Promise<MissAVRecommendation[]> {
  const [profile, sourceItems] = await Promise.all([recommendationProfile(), loadCandidates(forceRefresh)])
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

export const MISSAV_DOMAIN_OPTIONS = [
  { value: "https://missav.ws/", title: "missav.ws" },
  { value: "https://missav.ai/", title: "missav.ai" },
] as const

export type MissAVBaseURL = typeof MISSAV_DOMAIN_OPTIONS[number]["value"]

// Shared by browser entry points, page requests and playback referrers.
export const MISSAV_LOCALE = "cn"
export const MISSAV_ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9"

const DOMAIN_KEY = "missav_preferred_domain_v1"
const DEFAULT_DOMAIN: MissAVBaseURL = "https://missav.ws/"

export function isMissAVBaseURL(value: unknown): value is MissAVBaseURL {
  return MISSAV_DOMAIN_OPTIONS.some(option => option.value === value)
}

export function getMissAVBaseURL(): MissAVBaseURL {
  const stored = Storage.get<unknown>(DOMAIN_KEY)
  return isMissAVBaseURL(stored) ? stored : DEFAULT_DOMAIN
}

export function setMissAVBaseURL(value: MissAVBaseURL): void {
  Storage.set(DOMAIN_KEY, value)
}

export function getMissAVLandingURL(baseURL: MissAVBaseURL = getMissAVBaseURL()): string {
  return new URL(`${MISSAV_LOCALE}/`, baseURL).toString()
}

export function getMissAVDomainLabel(value = getMissAVBaseURL()): string {
  return MISSAV_DOMAIN_OPTIONS.find(option => option.value === value)?.title ?? "missav.ws"
}

export function resolveMissAVURL(value: string): string {
  const decoded = value.trim()
  if (!decoded) return ""
  const baseURL = getMissAVBaseURL()
  try {
    const url = new URL(decoded.startsWith("//") ? `https:${decoded}` : decoded, baseURL)
    if (url.hostname === "missav.ws" || url.hostname === "missav.ai") {
      const selected = new URL(baseURL)
      url.protocol = selected.protocol
      url.host = selected.host
      // Local history can still contain older language URLs.
      // Preserve dynamic prefixes, queries and media paths without a locale.
      url.pathname = url.pathname.replace(/^((?:\/dm\d+)?\/)(?:ja|en|cn|ko|ms|th|de|fr|vi|id|fil|pt)(?=\/|$)/i, `$1${MISSAV_LOCALE}`)
    }
    return url.toString()
  } catch {
    return decoded
  }
}

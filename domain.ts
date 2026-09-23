export const MISSAV_DOMAIN_OPTIONS = [
  { value: "https://missav.ws/", title: "missav.ws" },
  { value: "https://missav.ai/", title: "missav.ai" },
] as const

export type MissAVBaseURL = typeof MISSAV_DOMAIN_OPTIONS[number]["value"]

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
    }
    return url.toString()
  } catch {
    return decoded
  }
}

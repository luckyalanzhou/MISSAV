const MAX_PAYLOAD_CHARACTERS = 2_000_000
type SubtitleSearchCacheBackend = {
  read(code: string): Promise<string | null>
  write(code: string, payload: string, touchedAt: number): Promise<void>
}
let backend: SubtitleSearchCacheBackend | undefined

export function installSubtitleSearchCache(value: SubtitleSearchCacheBackend): void { backend = value }

export async function readSubtitleSearchCachePayload(code: string): Promise<string | null> {
  try {
    const payload = await backend?.read(code)
    return typeof payload === "string" && payload.length <= MAX_PAYLOAD_CHARACTERS ? payload : null
  } catch { return null }
}

export async function writeSubtitleSearchCachePayload(code: string, payload: string, touchedAt: number): Promise<void> {
  if (!payload || payload.length > MAX_PAYLOAD_CHARACTERS || !Number.isFinite(touchedAt)) return
  try {
    await backend?.write(code, payload, touchedAt)
  } catch { /* Search results remain valid when optional cache persistence fails. */ }
}

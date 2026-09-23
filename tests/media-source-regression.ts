import { Script } from "scripting"
import { parseMissAVSources, type MissAVVideoSource } from "../client"
import { matchFreshMissAVPlaybackSource } from "../playback-source"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const run = (): void => {
  const html = `
    <video src="item.dvd_id ? cdnUrl(\`/\${item.dvd_id}/preview.mp4\`) : "></video>
    <video src="https:\/\/fourhoi.com\/other-title\/preview.mp4"></video>
    <a href="https:\/\/keepshare.org\/download\/magnet:?xt=urn:btih:ABC&amp;dn=TITLE.mp4">Magnet</a>
    <script>source='https:\/\/surrit.com\/asset-id\/playlist.m3u8';source842='https:\/\/surrit.com\/asset-id\/720p\/video.m3u8';source1280='https:\/\/surrit.com\/asset-id\/1080p\/video.m3u8';mirror='https:\/\/surrit.com\/asset-id\/1080p\/video.m3u8?token=fresh';</script>
  `
  const sources = parseMissAVSources(html)
  assert(sources.length === 3, `应只保留 1080p、720p 和一个自动 HLS，实际为 ${sources.map(item => item.label).join(", ")}`)
  assert(sources.map(item => item.label).join(",") === "1080p,720p,自动清晰度", "固定清晰度必须优先，且不得出现额外“自动”")
  assert(sources.every(item => item.type === "application/vnd.apple.mpegurl"), "磁力下载与预览 MP4 不得混入播放源")

  const selected = sources[0]
  const refreshed: MissAVVideoSource[] = [
    { ...selected, url: `${selected.url}?token=next` },
    { label: "1080p", qualityHeight: 1080, type: selected.type, url: "https://other.example/asset/1080p/video.m3u8" },
  ]
  assert(matchFreshMissAVPlaybackSource(selected, refreshed)?.url.includes("surrit.com") === true, "刷新必须优先匹配同一资源路径")
  const ambiguous = refreshed.map(item => ({ ...item, url: item.url.replace("surrit.com", "third.example") }))
  assert(matchFreshMissAVPlaybackSource(selected, ambiguous) === null, "多个同类型同清晰度候选存在时不得任意误选")

  Script.exit({ passed: 6, message: "MISSAV media source regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }

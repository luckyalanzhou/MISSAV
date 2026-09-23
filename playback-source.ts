import type { MissAVVideoSource } from "./client"

export function matchFreshMissAVPlaybackSource(selected: MissAVVideoSource, freshSources: MissAVVideoSource[]): MissAVVideoSource | null {
  const sameResource = freshSources.find(item => playbackResourceKey(item.url) === playbackResourceKey(selected.url) && item.type === selected.type)
  if (sameResource) return sameResource
  const compatible = freshSources.filter(item => item.type === selected.type && (selected.qualityHeight != null ? item.qualityHeight === selected.qualityHeight : item.qualityHeight == null))
  return compatible.length === 1 ? compatible[0] : null
}

function playbackResourceKey(value: string): string {
  try { const url = new URL(value); return `${url.protocol}//${url.host.toLowerCase()}${url.pathname}` } catch { return value }
}

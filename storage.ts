import type { MissAVVideoDetail, MissAVVideoItem, MissAVVideoSource } from "./client"
import {
  clearBrowseHistory,
  clearPlaybackHistory,
  isFavourite,
  loadBrowseHistory,
  loadFavourites,
  loadPlaybackHistory,
  recordBrowse,
  recordPlayback,
  saveVideoDetail,
  saveVideoDetailAndRecordBrowse,
  toggleFavourite,
  type MissAVBrowseRecord,
  type MissAVFavouriteRecord,
  type MissAVPlaybackRecord,
} from "./database"

export type { MissAVBrowseRecord, MissAVFavouriteRecord, MissAVPlaybackRecord }
export const loadMissAVFavourites = loadFavourites
export const loadMissAVHistory = loadPlaybackHistory
export const loadMissAVBrowseHistory = loadBrowseHistory
export const isMissAVFavourite = isFavourite
export const toggleMissAVFavourite = toggleFavourite
export const recordMissAVPlayback = recordPlayback
export const recordMissAVBrowse = recordBrowse
export const saveMissAVVideoDetail = saveVideoDetail
export const clearMissAVHistory = clearPlaybackHistory
export const clearMissAVBrowseHistory = clearBrowseHistory

export async function rememberMissAVDetail(video: MissAVVideoItem, detail: MissAVVideoDetail): Promise<void> {
  await saveVideoDetailAndRecordBrowse(video, detail)
}

export async function rememberMissAVPlayback(video: MissAVVideoItem, source: MissAVVideoSource): Promise<void> {
  await recordPlayback(video, source)
}

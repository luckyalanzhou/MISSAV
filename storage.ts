import type { MissAVVideoDetail, MissAVVideoItem, MissAVVideoSource } from "./client"
import {
  clearBrowseHistory,
  clearPlaybackHistory,
  isFavourite,
  loadBrowseHistory,
  loadFavourites,
  loadPlaybackHistory,
  loadPlaybackProgress,
  recordBrowse,
  recordPlayback,
  savePlaybackProgress,
  saveVideoDetail,
  saveVideoDetailAndRecordBrowse,
  toggleFavourite,
  type MissAVBrowseRecord,
  type MissAVFavouriteRecord,
  type MissAVPlaybackRecord,
  type MissAVPlaybackProgress,
} from "./database"

export type { MissAVBrowseRecord, MissAVFavouriteRecord, MissAVPlaybackRecord, MissAVPlaybackProgress }
export const loadMissAVFavourites = loadFavourites
export const loadMissAVHistory = loadPlaybackHistory
export const loadMissAVPlaybackProgress = loadPlaybackProgress
export const loadMissAVBrowseHistory = loadBrowseHistory
export const isMissAVFavourite = isFavourite
export const toggleMissAVFavourite = toggleFavourite
export const recordMissAVPlayback = recordPlayback
export const saveMissAVPlaybackProgress = savePlaybackProgress
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

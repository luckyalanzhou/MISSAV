import { Button, HStack, ScrollView, Text, VStack, ZStack, useEffect, useRef, useState } from "scripting"
import type { MissAVVideoItem } from "../../site/client"
import { formatMissAVContinueWatching } from "../../features/playback/playback-progress"
import { ACCENT, ACCENT_FILL, CapsuleSurface, READING_MAX_WIDTH, SECONDARY_SURFACE, glassButtonStyle, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SectionHeading, SECTION_SPACING } from "../design"
import {
  clearMissAVBrowseHistory,
  clearMissAVHistory,
  loadMissAVBrowseHistory,
  loadMissAVHistory,
  type MissAVBrowseRecord,
  type MissAVPlaybackRecord,
} from "../../data/storage"
import { DetailPage } from "./detail"
import { useDetailNavigation } from "./detail-navigation"
import { DestructiveMenu } from "../components/destructive_menu"
import { StateView } from "../components/state_view"
import { VideoRowList } from "../components/video_row"

type LibrarySegment = "playback" | "browse"
type LibraryData = {
  playback: MissAVPlaybackRecord[]
  browse: MissAVBrowseRecord[]
  hasMorePlayback: boolean
  hasMoreBrowse: boolean
}

const LIBRARY_PAGE_SIZE = 100
const emptyData: LibraryData = { playback: [], browse: [], hasMorePlayback: false, hasMoreBrowse: false }

const segmentMetadata: Record<LibrarySegment, { title: string; subtitle: string; emptyTitle: string; emptyDescription: string; emptyIcon: string }> = {
  playback: {
    title: "播放记录",
    subtitle: "最近播放过的内容，可随时继续观看。",
    emptyTitle: "还没有播放记录",
    emptyDescription: "开始播放后，最近观看的视频会出现在这里。",
    emptyIcon: "clock",
  },
  browse: {
    title: "浏览记录",
    subtitle: "打开过详情的内容，只保存在本机。",
    emptyTitle: "还没有浏览记录",
    emptyDescription: "打开视频详情后，会直接出现在这里。",
    emptyIcon: "eye",
  },
}

export function LibraryPage(props: { historyRevision: number; onHistoryChanged: () => void; onDiscover: () => void }) {
  const [segment, setSegment] = useState<LibrarySegment>("playback")
  const [data, setData] = useState<LibraryData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [clearError, setClearError] = useState<string | null>(null)
  const [clearing, setClearing] = useState<"playback" | "browse" | null>(null)
  const detailNavigation = useDetailNavigation()
  const selected = detailNavigation.selected
  const detailPresented = detailNavigation.isPresented
  const generation = useRef(0)
  const loadingMoreRef = useRef(false)

  async function load() {
    const current = ++generation.current
    loadingMoreRef.current = false
    setLoadingMore(false)
    setLoadMoreError(null)
    setLoading(true)
    setError(null)
    try {
      const [playback, browse] = await Promise.all([
        loadMissAVHistory(LIBRARY_PAGE_SIZE + 1),
        loadMissAVBrowseHistory(LIBRARY_PAGE_SIZE + 1),
      ])
      if (current === generation.current) setData(previous => ({
        ...previous,
        playback: playback.slice(0, LIBRARY_PAGE_SIZE),
        browse: browse.slice(0, LIBRARY_PAGE_SIZE),
        hasMorePlayback: playback.length > LIBRARY_PAGE_SIZE,
        hasMoreBrowse: browse.length > LIBRARY_PAGE_SIZE,
      }))
    } catch (reason) {
      if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }

  async function refresh() { await load() }

  async function loadMore() {
    const requestedSegment = segment
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError(null)
    const current = generation.current
    try {
      if (requestedSegment === "playback") {
        const records = await loadMissAVHistory(LIBRARY_PAGE_SIZE + 1, data.playback.length)
        if (current === generation.current && requestedSegment === segment) setData(previous => ({
          ...previous,
          playback: [...previous.playback, ...records.slice(0, LIBRARY_PAGE_SIZE).filter(item => !previous.playback.some(existing => existing.videoCode === item.videoCode))],
          hasMorePlayback: records.length > LIBRARY_PAGE_SIZE,
        }))
      } else {
        const records = await loadMissAVBrowseHistory(LIBRARY_PAGE_SIZE + 1, data.browse.length)
        if (current === generation.current && requestedSegment === segment) setData(previous => ({
          ...previous,
          browse: [...previous.browse, ...records.slice(0, LIBRARY_PAGE_SIZE).filter(item => !previous.browse.some(existing => existing.videoCode === item.videoCode))],
          hasMoreBrowse: records.length > LIBRARY_PAGE_SIZE,
        }))
      }
    } catch (reason) {
      if (current === generation.current) setLoadMoreError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }

  useEffect(() => { void load() }, [props.historyRevision])

  function open(video: MissAVVideoItem) {
    void detailNavigation.open(video)
  }

  async function clearPlayback() {
    if (clearing) return
    setClearing("playback"); setClearError(null)
    try {
      await clearMissAVHistory()
      setData(current => ({ ...current, playback: [], hasMorePlayback: false }))
      props.onHistoryChanged()
    } catch {
      setClearError("无法清除播放记录，请稍后重试。")
    } finally { setClearing(null) }
  }

  async function clearBrowse() {
    if (clearing) return
    setClearing("browse"); setClearError(null)
    try {
      await clearMissAVBrowseHistory()
      setData(current => ({ ...current, browse: [], hasMoreBrowse: false }))
      props.onHistoryChanged()
    } catch {
      setClearError("无法清除浏览记录，请稍后重试。")
    } finally { setClearing(null) }
  }

  const metadata = segmentMetadata[segment]
  const items = segment === "playback" ? data.playback.map(item => item.video) : data.browse.map(item => item.video)
  const hasMore = segment === "playback" ? data.hasMorePlayback : data.hasMoreBrowse
  const recordSummary = loading && !items.length ? "正在读取本机记录…" : error && !items.length ? "暂时无法读取本机记录" : `${hasMore ? "已加载 " : "共 "}${items.length} 条记录 · 仅保存在本机`
  const statuses = segment === "playback"
    ? new Map(data.playback.map(item => [item.videoCode, formatMissAVContinueWatching(item.positionSeconds)]))
    : segment === "browse"
      ? new Map(data.browse.map(item => [item.videoCode, item.viewCount > 1 ? `浏览 ${item.viewCount} 次` : "最近浏览"]))
      : undefined
  const statusSystemImage = segment === "playback" ? "play.circle" : segment === "browse" ? "eye" : undefined

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} onDisappear={detailNavigation.cancel}>
    <PageBackground />
    <ScrollView
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
      refreshable={refresh}
      navigationDestination={{
        isPresented: detailPresented,
        content: selected ? <DetailPage key={`${selected.detail.watchUrl}:${selected.navigationID}`} video={selected.video} initialDetail={selected.detail} initialTrace={selected.trace} preparation={selected.preparation} onHistoryChanged={props.onHistoryChanged} /> : <VStack />,
      }}
    >
      <VStack spacing={SECTION_SPACING} alignment="leading" frame={{ maxWidth: READING_MAX_WIDTH }} padding={{ horizontal: PAGE_PADDING, top: 0, bottom: PAGE_BOTTOM_PADDING }}>
        <HStack spacing={9} frame={{ maxWidth: "infinity", alignment: "leading" }} accessibilityLabel="选择资料库类型">
          <Button title="播放记录" systemImage={segment === "playback" ? "checkmark" : undefined} action={() => setSegment("playback")} buttonStyle={glassButtonStyle(segment === "playback")} buttonBorderShape="capsule" controlSize="regular" font="subheadline" tint={segment === "playback" ? ACCENT_FILL : SECONDARY_SURFACE} background={<CapsuleSurface />} foregroundStyle={segment === "playback" ? "white" : "label"} frame={{ maxWidth: "infinity", minHeight: 46 }} accessibilityLabel={`播放记录${segment === "playback" ? "，已选择" : ""}`} />
          <Button title="浏览记录" systemImage={segment === "browse" ? "checkmark" : undefined} action={() => setSegment("browse")} buttonStyle={glassButtonStyle(segment === "browse")} buttonBorderShape="capsule" controlSize="regular" font="subheadline" tint={segment === "browse" ? ACCENT_FILL : SECONDARY_SURFACE} background={<CapsuleSurface />} foregroundStyle={segment === "browse" ? "white" : "label"} frame={{ maxWidth: "infinity", minHeight: 46 }} accessibilityLabel={`浏览记录${segment === "browse" ? "，已选择" : ""}`} />
        </HStack>

        <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <SectionHeading title={metadata.title} subtitle={metadata.subtitle} level="primary" />
          <Text font="footnote" foregroundStyle="secondaryLabel" contentTransition="numericText" frame={{ maxWidth: "infinity", alignment: "leading" }}>{recordSummary}</Text>
        </VStack>

        {loading && !items.length
          ? <StateView title="正在加载资料库" loading presentation="section" />
          : error
              ? <StateView title="资料库加载失败" description={error} kind="error" action={() => { void load() }} presentation="section" />
              : items.length
                ? <VideoRowList items={items} status={video => statuses?.get(video.videoCode)} statusSystemImage={statusSystemImage} onOpen={open} onLastItemAppear={hasMore ? () => { void loadMore() } : undefined} />
                : <StateView title={metadata.emptyTitle} description={metadata.emptyDescription} systemImage={metadata.emptyIcon} action={props.onDiscover} actionTitle="浏览视频" />}

        {loadMoreError ? <StateView title="加载更多失败" description={loadMoreError} kind="error" action={() => { void loadMore() }} presentation="row" /> : undefined}
        {loadingMore ? <HStack spacing={8} frame={{ maxWidth: "infinity", minHeight: 44 }}><ProgressView progressViewStyle="circular" tint={ACCENT} /><Text font="footnote" foregroundStyle="secondaryLabel">正在加载更多记录…</Text></HStack> : undefined}
        {clearError ? <StateView title="清除失败" description={clearError} kind="error" presentation="row" /> : undefined}
        {items.length ? <HStack spacing={12} padding={{ top: 8 }} frame={{ maxWidth: "infinity" }}>
          <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">浏览记录和播放记录不会上传。</Text>
          {segment === "playback" ? <DestructiveMenu title="清空播放记录" confirmationTitle="确认清空播放记录" description="删除全部本机播放记录，不会影响浏览记录。" action={clearPlayback} busy={clearing === "playback"} /> : <DestructiveMenu title="清空浏览记录" confirmationTitle="确认清空浏览记录" description="删除全部本机浏览记录，不会影响播放记录。" action={clearBrowse} busy={clearing === "browse"} />}
        </HStack> : undefined}
      </VStack>
    </ScrollView>
  </ZStack>
}

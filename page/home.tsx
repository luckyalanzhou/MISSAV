import { HStack, Image, LazyHStack, ScrollView, Text, VStack, ZStack, useEffect, useObservable, useRef, useState } from "scripting"
import { missavClient, MissAVRequestScope, isMissAVRequestCancelled, type MissAVVideoItem } from "../client"
import { ActionRow, PAGE_BOTTOM_PADDING, PAGE_PADDING, PAGE_TOP_PADDING, PageBackground, SECTION_SPACING, SectionHeading } from "../design"
import { loadMissAVHistory, type MissAVPlaybackRecord } from "../storage"
import { formatMissAVContinueWatching } from "../playback-progress"
import { MediaHero, MediaTile } from "./components/media_cards"
import { StateView } from "./components/state_view"
import { DetailPage } from "./detail"
import { DetailPreparationStatus, useDetailNavigation } from "./detail-navigation"
import { RecommendationsPage } from "./recommendations"

type HomeRemote = { latest: MissAVVideoItem[]; trending: MissAVVideoItem[] }
type HomeLocal = { recent: MissAVPlaybackRecord[] }

export function MediaHomePage(props: { revision: number; accessRevision?: number; onHistoryChanged: () => void; onDiscover: () => void; toolbar?: any }) {
  const [remote, setRemote] = useState<HomeRemote>({ latest: [], trending: [] })
  const [local, setLocal] = useState<HomeLocal>({ recent: [] })
  const [remoteLoading, setRemoteLoading] = useState(true)
  const [localLoading, setLocalLoading] = useState(true)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const detailNavigation = useDetailNavigation()
  const selected = detailNavigation.selected
  const detailPresented = detailNavigation.isPresented
  const recommendationsPresented = useObservable(false)
  const remoteGeneration = useRef(0)
  const localGeneration = useRef(0)
  const loadedRemote = useRef(false)
  const requestScope = useRef<MissAVRequestScope | null>(null)

  async function loadRemote(force = false, reuseVerifiedCache = false) {
    if (loadedRemote.current && !force && !reuseVerifiedCache) return
    loadedRemote.current = true
    const current = ++remoteGeneration.current
    requestScope.current?.cancel()
    const scope = new MissAVRequestScope()
    requestScope.current = scope
    setRemoteLoading(true)
    setRemoteError(null)
    const results = await Promise.allSettled([
      missavClient.searchVideoPage({ collection: "today-hot", page: 1, sort: "today_views", filter: "" }, { forceRefresh: force, scope, allowStale: true }),
      missavClient.searchVideoPage({ collection: "new", page: 1, sort: "published_at", filter: "" }, { forceRefresh: force, scope, allowStale: true }),
    ])
    if (current !== remoteGeneration.current) return
    setRemote(previous => ({
      trending: results[0].status === "fulfilled" ? results[0].value.items.slice(0, 10) : previous.trending,
      latest: results[1].status === "fulfilled" ? results[1].value.items.slice(0, 10) : previous.latest,
    }))
    const failures = results.flatMap((result, index) => {
      const message = result.status === "fulfilled" ? result.value.refreshError : !isMissAVRequestCancelled(result.reason) ? errorMessage(result.reason) : undefined
      return message ? [`${index === 0 ? "今日热门" : "最近更新"}：${message}`] : []
    })
    if (failures.length) setRemoteError(`在线内容更新失败（${failures.join("；")}）。`)
    setRemoteLoading(false)
    requestScope.current = null
  }

  async function loadLocal() {
    const current = ++localGeneration.current
    setLocalLoading(true)
    const results = await Promise.allSettled([loadMissAVHistory(8)])
    if (current !== localGeneration.current) return
    setLocal(previous => ({
      recent: results[0].status === "fulfilled" ? results[0].value : previous.recent,
    }))
    setLocalLoading(false)
  }

  async function refresh() { await Promise.all([loadRemote(true), loadLocal()]) }
  function open(video: MissAVVideoItem) { void detailNavigation.open(video) }
  useEffect(() => { void loadRemote(false, true) }, [props.accessRevision])
  useEffect(() => () => { ++remoteGeneration.current; ++localGeneration.current; requestScope.current?.cancel() }, [])
  useEffect(() => { void loadLocal() }, [props.revision])

  const continueWatching = local.recent[0]
  const recommended = remote.trending
  const latest = remote.latest

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} onDisappear={detailNavigation.cancel} overlay={<DetailPreparationStatus navigation={detailNavigation} />}>
    <PageBackground />
    <ScrollView navigationTitle="首页" navigationBarTitleDisplayMode="inline" toolbar={props.toolbar} refreshable={refresh} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage key={`${selected.detail.watchUrl}:${selected.navigationID}`} video={selected.video} initialDetail={selected.detail} preparation={selected.preparation} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
      <VStack spacing={SECTION_SPACING} alignment="leading" padding={{ top: PAGE_TOP_PADDING, bottom: PAGE_BOTTOM_PADDING }}>
        <VStack spacing={12} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <SectionHeading title="继续观看" subtitle={continueWatching ? "从最近播放的作品继续。" : "播放记录将显示在这里。"} level="primary" />
          {continueWatching
            ? <MediaHero video={continueWatching.video} eyebrow={formatMissAVContinueWatching(continueWatching.positionSeconds)} description={[continueWatching.videoCode.toUpperCase(), continueWatching.video.duration].filter(Boolean).join(" · ")} onOpen={open} />
            : localLoading
              ? <StateView title="正在读取播放记录" loading presentation="section" />
              : <StateView title="暂无播放记录" description="浏览作品并开始播放后，可从这里继续观看。" systemImage="play.circle" action={props.onDiscover} actionTitle="前往浏览" presentation="section" />}
        </VStack>

        <VStack spacing={0} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <ActionRow title="为你推荐" subtitle="根据保存在本机的浏览记录和播放记录生成。" systemImage="sparkles" action={() => recommendationsPresented.setValue(true)} navigationDestination={{ isPresented: recommendationsPresented, content: <RecommendationsPage revision={props.revision} onHistoryChanged={props.onHistoryChanged} onDiscover={props.onDiscover} /> }} />
        </VStack>

        {recommended.length
          ? <HomeShelf title="今日热门" subtitle="今日观看较多的作品" items={recommended} onOpen={open} />
          : remoteLoading
            ? <VStack padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}><StateView title="正在更新今日热门" loading presentation="row" /></VStack>
            : undefined}

        {latest.length
          ? <HomeShelf title="最近更新" subtitle="近期收录的作品" items={latest} onOpen={open} />
          : !remoteLoading && !recommended.length
            ? <VStack padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}><StateView title="首页内容暂时无法更新" description={remoteError || "请下拉刷新后重试。"} kind="error" action={() => { void loadRemote(true) }} presentation="section" /></VStack>
            : undefined}

        {remoteError && (recommended.length || latest.length)
          ? <HStack spacing={8} alignment="center" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Image systemName="wifi.exclamationmark" foregroundStyle="secondaryLabel" />
              <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{`${remoteError} 当前显示已成功载入的内容。`}</Text>
            </HStack>
          : undefined}
      </VStack>
    </ScrollView>
  </ZStack>
}

function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }

function HomeShelf(props: { title: string; subtitle: string; items: MissAVVideoItem[]; onOpen: (video: MissAVVideoItem) => void }) {
  return <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
    <VStack spacing={3} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="title2" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.title}</Text>
      <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.subtitle}</Text>
    </VStack>
    <ScrollView axes="horizontal" scrollIndicator="hidden">
      <LazyHStack spacing={14} alignment="top" padding={{ horizontal: PAGE_PADDING }}>
        {props.items.map(video => <MediaTile key={video.videoCode} video={video} onOpen={props.onOpen} />)}
      </LazyHStack>
    </ScrollView>
  </VStack>
}

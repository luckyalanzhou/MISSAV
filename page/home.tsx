import { Divider, HStack, Image, LazyHStack, ScrollView, Text, VStack, ZStack, useEffect, useObservable, useRef, useState } from "scripting"
import { missavClient, type MissAVVideoItem } from "../client"
import { ActionRow, PAGE_BOTTOM_PADDING, PAGE_PADDING, PAGE_TOP_PADDING, PageBackground, SECTION_SPACING, SectionHeading } from "../design"
import { loadMissAVFavourites, loadMissAVHistory } from "../storage"
import { MediaHero, MediaTile } from "./components/media_cards"
import { StateView } from "./components/state_view"
import { DetailPage } from "./detail"
import { RecommendationsPage } from "./recommendations"

type HomeRemote = { latest: MissAVVideoItem[]; trending: MissAVVideoItem[] }
type HomeLocal = { recent: MissAVVideoItem[]; favourites: MissAVVideoItem[] }

export function MediaHomePage(props: { revision: number; onFavouriteChanged: () => void; onHistoryChanged: () => void; onDiscover: () => void; onLibrary: () => void; toolbar?: any }) {
  const [remote, setRemote] = useState<HomeRemote>({ latest: [], trending: [] })
  const [local, setLocal] = useState<HomeLocal>({ recent: [], favourites: [] })
  const [remoteLoading, setRemoteLoading] = useState(true)
  const [localLoading, setLocalLoading] = useState(true)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [selected, setSelected] = useState<MissAVVideoItem | null>(null)
  const detailPresented = useObservable(false)
  const recommendationsPresented = useObservable(false)
  const remoteGeneration = useRef(0)
  const localGeneration = useRef(0)
  const loadedRemote = useRef(false)

  async function loadRemote(force = false) {
    if (loadedRemote.current && !force) return
    loadedRemote.current = true
    const current = ++remoteGeneration.current
    setRemoteLoading(true)
    setRemoteError(null)
    const results = await Promise.allSettled([
      missavClient.searchVideoPage({ collection: "today-hot", page: 1, sort: "today_views", filter: "" }, { forceRefresh: force }),
      missavClient.searchVideoPage({ collection: "new", page: 1, sort: "released_at", filter: "" }, { forceRefresh: force }),
    ])
    if (current !== remoteGeneration.current) return
    setRemote(previous => ({
      trending: results[0].status === "fulfilled" ? results[0].value.items.slice(0, 10) : previous.trending,
      latest: results[1].status === "fulfilled" ? results[1].value.items.slice(0, 10) : previous.latest,
    }))
    if (results.some(result => result.status === "rejected")) setRemoteError("部分在线内容暂时无法更新。")
    setRemoteLoading(false)
  }

  async function loadLocal() {
    const current = ++localGeneration.current
    setLocalLoading(true)
    const results = await Promise.allSettled([loadMissAVHistory(8), loadMissAVFavourites(8)])
    if (current !== localGeneration.current) return
    setLocal(previous => ({
      recent: results[0].status === "fulfilled" ? results[0].value.map(item => item.video) : previous.recent,
      favourites: results[1].status === "fulfilled" ? results[1].value.map(item => item.video) : previous.favourites,
    }))
    setLocalLoading(false)
  }

  async function refresh() { await Promise.all([loadRemote(true), loadLocal()]) }
  function open(video: MissAVVideoItem) { setSelected(video); detailPresented.setValue(true) }
  useEffect(() => { void loadRemote() }, [])
  useEffect(() => { void loadLocal() }, [props.revision])

  const continueWatching = local.recent[0]
  const recommended = remote.trending
  const latest = remote.latest

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <ScrollView navigationTitle="首页" navigationBarTitleDisplayMode="inline" toolbar={props.toolbar} refreshable={refresh} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage video={selected} onFavouriteChanged={props.onFavouriteChanged} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
      <VStack spacing={SECTION_SPACING} alignment="leading" padding={{ top: PAGE_TOP_PADDING, bottom: PAGE_BOTTOM_PADDING }}>
        <VStack spacing={12} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <SectionHeading title="继续观看" subtitle={continueWatching ? "从最近播放的作品继续。" : "播放记录将显示在这里。"} level="primary" />
          {continueWatching
            ? <MediaHero video={continueWatching} eyebrow="最近播放" description={[continueWatching.videoCode.toUpperCase(), continueWatching.duration].filter(Boolean).join(" · ")} onOpen={open} />
            : localLoading
              ? <StateView title="正在读取播放记录" loading presentation="section" />
              : <StateView title="暂无播放记录" description="浏览作品并开始播放后，可从这里继续观看。" systemImage="play.circle" action={props.onDiscover} actionTitle="前往浏览" presentation="section" />}
        </VStack>

        <VStack spacing={0} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <ActionRow title="为你推荐" subtitle="根据保存在本机的收藏和观看记录生成。" systemImage="sparkles" action={() => recommendationsPresented.setValue(true)} navigationDestination={{ isPresented: recommendationsPresented, content: <RecommendationsPage revision={props.revision} onFavouriteChanged={props.onFavouriteChanged} onHistoryChanged={props.onHistoryChanged} onDiscover={props.onDiscover} /> }} />
          <Divider />
          <ActionRow title="本机收藏" subtitle={`${local.favourites.length} 部作品，仅保存在本机。`} systemImage="heart" action={props.onLibrary} />
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
              <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">部分在线内容暂时无法更新，当前显示已成功载入的内容。</Text>
            </HStack>
          : undefined}
      </VStack>
    </ScrollView>
  </ZStack>
}

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

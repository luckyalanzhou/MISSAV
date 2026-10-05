import { HStack, Image, LazyHStack, LazyVGrid, NavigationLink, ProgressView, ScrollView, Text, VStack, ZStack, useEffect, useRef, useState } from "scripting"
import { missavClient, MissAVRequestScope, type MissAVCollection, type MissAVCollectionGroup, type MissAVVideoItem } from "../client"
import { loadMissAVHistory, loadMissAVBrowseHistory, type MissAVPlaybackRecord } from "../storage"
import { formatMissAVContinueWatching } from "../playback-progress"
import { emptyHomeScreenData, HomeScreenLoader, playbackProgressFraction, type HomeSection } from "../home-screen-data"
import { ACCENT, ActionRow, MEDIA_TILE_WIDTH, PAGE_BOTTOM_PADDING, PAGE_PADDING, PAGE_TOP_PADDING, PageBackground, SECTION_SPACING, SectionHeading } from "../design"
import { MediaGridCard, MediaTile } from "./components/media_cards"
import { StateView } from "./components/state_view"
import { DetailPage } from "./detail"
import { DetailPreparationStatus, useDetailNavigation } from "./detail-navigation"
import { DiscoverPage } from "./discover"
import { RecommendationsPage } from "./recommendations"

const quickCollections: Array<{ group: MissAVCollectionGroup; title: string; image: string; collection: MissAVCollection }> = [
  { group: "subtitles", title: "中文字幕", image: "captions.bubble", collection: "chinese-subtitle" },
  { group: "japanese", title: "日本 AV", image: "play.rectangle", collection: "new" },
  { group: "amateur", title: "素人", image: "person", collection: "siro" },
  { group: "uncensored", title: "无码影片", image: "lock.open", collection: "uncensored-leak" },
  { group: "asian", title: "亚洲 AV", image: "film", collection: "madou" },
]

export function MediaHomePage(props: { revision: number; accessRevision?: number; onHistoryChanged: () => void; onDiscover: () => void; toolbar?: any }) {
  const [data, setData] = useState(emptyHomeScreenData)
  const loader = useRef<HomeScreenLoader | null>(null)
  const [recommendationsPresented, setRecommendationsPresented] = useState(false)
  const detailNavigation = useDetailNavigation()
  const selected = detailNavigation.selected
  const detailPresented = detailNavigation.isPresented

  useEffect(() => {
    const owner = new HomeScreenLoader({
      history: () => loadMissAVHistory(50),
      recommendationHistory: async () => (await loadMissAVBrowseHistory(1)).length > 0,
      cached: params => missavClient.readCachedVideoPage(params),
      search: (params, scope, forceRefresh) => missavClient.searchVideoPage(params, { scope: scope as MissAVRequestScope, forceRefresh, allowStale: true }),
      scope: () => new MissAVRequestScope(),
      changed: setData,
    })
    loader.current = owner
    void owner.loadRemote()
    return () => {
      owner.dispose()
      if (loader.current === owner) loader.current = null
    }
  }, [])
  useEffect(() => { void loader.current?.loadLocal() }, [props.revision])
  useEffect(() => { if (props.accessRevision) void loader.current?.loadRemote(true) }, [props.accessRevision])

  function open(video: MissAVVideoItem) { void detailNavigation.open(video) }
  const continueWatching = data.recent
  const refresh = () => loader.current?.refresh() || Promise.resolve()

  function onlineSection(section: HomeSection, title: string, collection: MissAVCollection) {
    const items = data[section]
    const error = data.errors[section]
    return <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <VStack padding={{ horizontal: PAGE_PADDING }}><SectionHeading title={title} trailing={<NavigationLink destination={<DiscoverPage key={`home-all-${collection}`} initialCollection={collection} onHistoryChanged={props.onHistoryChanged} />}><Text font="subheadline" foregroundStyle={ACCENT}>查看全部</Text></NavigationLink>} /></VStack>
      {items.length ? section === "latest"
        ? <LazyVGrid columns={[{ size: { type: "flexible" }, spacing: 12 }, { size: { type: "flexible" }, spacing: 12 }]} spacing={16} padding={{ horizontal: PAGE_PADDING }}>{items.map(video => <MediaGridCard key={video.videoCode} video={video} onOpen={open} />)}</LazyVGrid>
        : <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={14} alignment="top" padding={{ horizontal: PAGE_PADDING }}>{items.map(video => <MediaTile key={video.videoCode} video={video} onOpen={open} />)}</LazyHStack></ScrollView>
        : data.loading[section]
          ? <VStack padding={{ horizontal: PAGE_PADDING }}><StateView title={`正在更新${title}`} loading presentation="row" /></VStack>
          : error
            ? <VStack padding={{ horizontal: PAGE_PADDING }}><StateView title={`${title}暂时无法更新`} description={error} kind="error" action={() => { void loader.current?.loadRemote(true) }} actionTitle="重试" presentation="row" /></VStack>
            : <VStack padding={{ horizontal: PAGE_PADDING }}><StateView title={`${title}暂无内容`} description="可以前往浏览栏目查看其他作品。" kind="empty" action={props.onDiscover} actionTitle="前往浏览" presentation="row" /></VStack>}
      {error && items.length ? <HStack spacing={8} alignment="center" padding={{ horizontal: PAGE_PADDING }}><Image systemName="wifi.exclamationmark" foregroundStyle="secondaryLabel" /><Text font="footnote" foregroundStyle="secondaryLabel">{`${title}更新失败，正在显示已载入的内容。`}</Text></HStack> : undefined}
    </VStack>
  }

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} onDisappear={detailNavigation.cancel} overlay={<DetailPreparationStatus navigation={detailNavigation} />}>
    <PageBackground />
    <ScrollView navigationTitle="首页" navigationBarTitleDisplayMode="inline" toolbar={props.toolbar} refreshable={refresh} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage key={`${selected.detail.watchUrl}:${selected.navigationID}`} video={selected.video} initialDetail={selected.detail} preparation={selected.preparation} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
      <VStack spacing={SECTION_SPACING} alignment="leading" padding={{ top: PAGE_TOP_PADDING, bottom: PAGE_BOTTOM_PADDING }}>
        {continueWatching.length ? <VStack spacing={12} alignment="leading">
          <VStack spacing={3} padding={{ horizontal: PAGE_PADDING }}><SectionHeading title="继续观看" subtitle={`${continueWatching.length} 部未看完`} level="primary" /></VStack>
          <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={14} alignment="top" padding={{ horizontal: PAGE_PADDING }}>{continueWatching.map(record => <ContinueWatchingCard key={record.videoCode} record={record} onOpen={open} />)}</LazyHStack></ScrollView>
        </VStack> : undefined}

        <VStack spacing={12} alignment="leading">
          <VStack padding={{ horizontal: PAGE_PADDING }}><SectionHeading title="快速浏览" subtitle="直达常用栏目" /></VStack>
          <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={9} padding={{ horizontal: PAGE_PADDING }}>{quickCollections.map(item => <NavigationLink key={item.group} destination={<DiscoverPage key={`home-category-${item.group}-${props.accessRevision || 0}`} initialCollection={item.collection} onHistoryChanged={props.onHistoryChanged} />} buttonStyle="plain"><CategoryShortcut title={item.title} image={item.image} /></NavigationLink>)}</LazyHStack></ScrollView>
        </VStack>

        {onlineSection("latest", "最近更新", "new")}
        {onlineSection("trending", "今日热门", "today-hot")}

        {data.hasRecommendationHistory ? <VStack spacing={0} alignment="leading" padding={{ horizontal: PAGE_PADDING }}>
          <ActionRow title="为你推荐" subtitle="根据本机的浏览和播放记录生成。" systemImage="sparkles" action={() => setRecommendationsPresented(true)} navigationDestination={{ isPresented: recommendationsPresented, content: <RecommendationsPage revision={props.revision} onHistoryChanged={props.onHistoryChanged} onDiscover={props.onDiscover} /> }} />
        </VStack> : undefined}

        {data.errors.history ? <HStack spacing={8} padding={{ horizontal: PAGE_PADDING }}><Image systemName="exclamationmark.triangle" foregroundStyle="secondaryLabel" /><Text font="footnote" foregroundStyle="secondaryLabel">{data.errors.history}</Text></HStack> : undefined}
      </VStack>
    </ScrollView>
  </ZStack>
}

function CategoryShortcut(props: { title: string; image: string }) {
  return <HStack spacing={8} padding={{ horizontal: 13, vertical: 10 }} frame={{ minHeight: 44 }} background="secondarySystemBackground" clipShape="capsule" contentShape="capsule" accessibilityLabel={`浏览${props.title}`}>
    <Image systemName={props.image} font="caption" foregroundStyle={ACCENT} />
    <Text font="subheadline" fontWeight="semibold" lineLimit={1}>{props.title}</Text>
  </HStack>
}

function ContinueWatchingCard(props: { record: MissAVPlaybackRecord; onOpen: (video: MissAVVideoItem) => void }) {
  const progress = playbackProgressFraction(props.record)
  return <VStack spacing={7} alignment="leading" frame={{ width: MEDIA_TILE_WIDTH }}>
    <MediaTile video={props.record.video} status={formatMissAVContinueWatching(props.record.positionSeconds)} onOpen={props.onOpen} />
    {progress !== undefined ? <ProgressView value={progress} total={1} progressViewStyle="linear" tint={ACCENT} accessibilityLabel={`已播放 ${Math.round(progress * 100)}%`} /> : undefined}
  </VStack>
}

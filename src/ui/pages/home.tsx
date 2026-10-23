import { HStack, Image, LazyHStack, LazyVGrid, NavigationLink, ScrollView, Text, VStack, ZStack, useEffect, useRef, useState } from "scripting"
import { missavClient, MissAVRequestScope, type MissAVCollection, type MissAVVideoItem } from "../../site/client"
import { loadAllMissAVHistory } from "../../data/storage"
import { formatMissAVContinueWatching } from "../../features/playback/playback-progress"
import { emptyHomeScreenData, HomeScreenLoader, playbackProgressFraction, type HomeSection } from "../../features/home/home-screen-data"
import { CapsuleSurface, CONTENT_MAX_WIDTH, SECONDARY_SURFACE, glassButtonStyle, PAGE_BOTTOM_PADDING, PAGE_PADDING, PAGE_TOP_PADDING, PageBackground, SectionHeading } from "../design"
import { MediaGridCard, MediaTile } from "../components/media_cards"
import { ContinueWatchingCard, HOME_QUICK_COLLECTIONS, HomeQuickCollectionChip, HomeSearchEntry } from "../components/home_components"
import { StateView } from "../components/state_view"
import { DetailPage } from "./detail"
import { useDetailNavigation } from "./detail-navigation"
import { DiscoverPage } from "./discover"
import { SearchPage } from "./search"

export function MediaHomePage(props: { revision: number; accessRevision?: number; onHistoryChanged: () => void; onDiscover: () => void; toolbar?: any }) {
  const [data, setData] = useState(emptyHomeScreenData)
  const loader = useRef<HomeScreenLoader | null>(null)
  const detailNavigation = useDetailNavigation()
  const selected = detailNavigation.selected
  const detailPresented = detailNavigation.isPresented

  useEffect(() => {
    const owner = new HomeScreenLoader({
      history: () => loadAllMissAVHistory(),
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
      <VStack padding={{ horizontal: PAGE_PADDING }}><SectionHeading title={title} trailing={<NavigationLink destination={<DiscoverPage key={`home-all-${collection}`} initialCollection={collection} onHistoryChanged={props.onHistoryChanged} />} buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="small" tint="secondarySystemFill" frame={{ minHeight: 44 }}><Text font="footnote" foregroundStyle="label" lineLimit={1}>查看全部</Text></NavigationLink>} /></VStack>
      {items.length ? section === "latest"
        ? <LazyVGrid columns={[{ size: { type: "adaptive", min: 154, max: 220 }, spacing: 12 }]} spacing={16} padding={{ horizontal: PAGE_PADDING }}>{items.map(video => <MediaGridCard key={video.videoCode} video={video} responsiveArtwork onOpen={open} />)}</LazyVGrid>
        : <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={14} alignment="top" padding={{ horizontal: PAGE_PADDING }}>{items.map(video => <MediaTile key={video.videoCode} video={video} onOpen={open} />)}</LazyHStack></ScrollView>
        : data.loading[section]
          ? <VStack padding={{ horizontal: PAGE_PADDING }}><StateView title={`正在更新${title}`} loading presentation="row" /></VStack>
          : error
            ? <VStack padding={{ horizontal: PAGE_PADDING }}><StateView title={`${title}暂时无法更新`} description={error} kind="error" action={() => { void loader.current?.loadRemote(true) }} actionTitle="重试" presentation="row" /></VStack>
            : <VStack padding={{ horizontal: PAGE_PADDING }}><StateView title={`${title}暂无内容`} description="可以前往浏览栏目查看其他作品。" kind="empty" action={props.onDiscover} actionTitle="前往浏览" presentation="row" /></VStack>}
      {error && items.length ? <HStack spacing={8} alignment="center" padding={{ horizontal: PAGE_PADDING }}><Image systemName="wifi.exclamationmark" foregroundStyle="secondaryLabel" /><Text font="footnote" foregroundStyle="secondaryLabel">{`${title}更新失败，正在显示已载入的内容。`}</Text></HStack> : undefined}
    </VStack>
  }

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} onDisappear={detailNavigation.cancel}>
    <PageBackground />
    <ScrollView navigationTitle="首页" navigationBarTitleDisplayMode="inline" toolbar={props.toolbar} refreshable={refresh} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage key={`${selected.detail.watchUrl}:${selected.navigationID}`} video={selected.video} initialDetail={selected.detail} initialTrace={selected.trace} preparation={selected.preparation} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
      <VStack spacing={28} alignment="leading" frame={{ maxWidth: CONTENT_MAX_WIDTH }} padding={{ top: PAGE_TOP_PADDING, bottom: PAGE_BOTTOM_PADDING }}>
        <VStack spacing={16} padding={{ horizontal: PAGE_PADDING }}>
          <NavigationLink destination={<SearchPage key={`home-search-${props.accessRevision || 0}`} onHistoryChanged={props.onHistoryChanged} />} buttonStyle="plain" frame={{ minHeight: 56 }}><HomeSearchEntry /></NavigationLink>
        </VStack>
        {continueWatching.length || data.errors.history ? <VStack spacing={12} alignment="leading">
          <VStack spacing={3} padding={{ horizontal: PAGE_PADDING }}><SectionHeading title="继续观看" subtitle={continueWatching.length ? `${continueWatching.length} 部未看完` : undefined} level="primary" /></VStack>
          {continueWatching.length ? <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={14} alignment="top" padding={{ horizontal: PAGE_PADDING }}>{continueWatching.map(record => <ContinueWatchingCard key={record.videoCode} video={record.video} resumeLabel={formatMissAVContinueWatching(record.positionSeconds)} progressFraction={playbackProgressFraction(record)} onOpen={open} />)}</LazyHStack></ScrollView> : undefined}
          {data.errors.history ? <VStack padding={{ horizontal: PAGE_PADDING }}><StateView title="播放记录读取失败" description={data.errors.history} kind="error" action={() => { void loader.current?.loadLocal() }} actionTitle="重试" presentation="row" /></VStack> : undefined}
        </VStack> : undefined}

        <VStack spacing={12} alignment="leading">
          <VStack padding={{ horizontal: PAGE_PADDING }}><SectionHeading title="快速浏览" subtitle="直达常用栏目" /></VStack>
          <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={9} padding={{ horizontal: PAGE_PADDING }}>{HOME_QUICK_COLLECTIONS.map(item => <NavigationLink key={item.group} destination={<DiscoverPage key={`home-category-${item.group}-${props.accessRevision || 0}`} initialCollection={item.collection} onHistoryChanged={props.onHistoryChanged} />} buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="regular" tint={SECONDARY_SURFACE} background={<CapsuleSurface />} frame={{ minHeight: 46 }}><HomeQuickCollectionChip title={item.title} image={item.image} /></NavigationLink>)}</LazyHStack></ScrollView>
        </VStack>

        {onlineSection("latest", "最近更新", "new")}
        {onlineSection("trending", "今日热门", "today-hot")}

      </VStack>
    </ScrollView>
  </ZStack>
}

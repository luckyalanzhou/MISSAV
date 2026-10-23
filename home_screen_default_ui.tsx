import { Button, HStack, Image, LazyHStack, LazyVGrid, NavigationLink, NavigationStack, ScrollView, Script, Text, Toolbar, ToolbarItem, VStack, ZStack, useEffect, useObservable, useRef, useState } from "scripting"
import { missavClient, MissAVRequestScope, type MissAVCollection, type MissAVVideoItem } from "./src/site/client"
import { ACCENT, CardSurface, CapsuleSurface, CONTENT_MAX_WIDTH, SECONDARY_SURFACE, glassButtonStyle, PAGE_BOTTOM_PADDING, PAGE_PADDING, PAGE_TOP_PADDING, PageBackground, PageIntro, SectionHeading } from "./src/ui/design"
import { loadAllMissAVHistory, loadMissAVBrowseHistory } from "./src/data/storage"
import { formatMissAVContinueWatching } from "./src/features/playback/playback-progress"
import { emptyHomeScreenData, HomeScreenLoader, playbackProgressFraction, type HomeSection } from "./src/features/home/home-screen-data"
import { MediaGridCard, MediaTile } from "./src/ui/components/media_cards"
import { ContinueWatchingCard, HOME_QUICK_COLLECTIONS, HomeQuickCollectionChip, HomeSearchEntry } from "./src/ui/components/home_components"
import { StateView } from "./src/ui/components/state_view"
import { DetailPage } from "./src/ui/pages/detail"
import { DetailPreparationStatus, useDetailNavigation } from "./src/ui/pages/detail-navigation"
import { DiscoverPage } from "./src/ui/pages/discover"
import { LibraryPage } from "./src/ui/pages/library"
import { RecommendationsPage } from "./src/ui/pages/recommendations"
import { SearchPage } from "./src/ui/pages/search"
import { SettingsPage } from "./src/ui/pages/settings"
import { initializeMissAVRuntime } from "./src/app/runtime"

export default function MISSAVHomeScreenView() {
  const [data, setData] = useState(emptyHomeScreenData)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [domainRevision, setDomainRevision] = useState(0)
  const loader = useRef<HomeScreenLoader | null>(null)
  const discoverPresented = useObservable(false)
  const detailNavigation = useDetailNavigation()
  const selected = detailNavigation.selected
  const bumpHistory = () => setHistoryRevision(value => value + 1)
  const common = { onHistoryChanged: bumpHistory }
  const openDiscover = () => discoverPresented.setValue(true)
  const open = (video: MissAVVideoItem) => { void detailNavigation.open(video) }
  function refreshAfterDomainOrAccessChange() {
    loader.current?.dispose()
    detailNavigation.cancel()
    setData(emptyHomeScreenData())
    setDomainRevision(value => value + 1)
  }

  useEffect(() => {
    initializeMissAVRuntime()
  }, [])

  useEffect(() => {
    const owner = new HomeScreenLoader({
      history: () => loadAllMissAVHistory(),
      recommendationHistory: async () => (await loadMissAVBrowseHistory(1)).length > 0,
      cached: params => missavClient.readCachedVideoPage(params),
      search: (params, scope, forceRefresh) => missavClient.searchVideoPage(params, { scope: scope as MissAVRequestScope, forceRefresh, allowStale: true }),
      scope: () => new MissAVRequestScope(),
      changed: setData,
    })
    loader.current = owner
    void owner.loadRemote()
    const removeListener = Script.onHomeTabEvent(event => {
      if (event === "selected") { void owner.loadLocal(); void owner.loadRemote() }
    })
    return () => {
      removeListener()
      owner.dispose()
      if (loader.current === owner) loader.current = null
    }
  }, [domainRevision])
  // History changes do not restart online listing requests or recreate listeners.
  useEffect(() => { void loader.current?.loadLocal() }, [historyRevision, domainRevision])

  const toolbar = <Toolbar><ToolbarItem placement="topBarTrailing">
    <NavigationLink destination={<SettingsPage onDomainChanged={refreshAfterDomainOrAccessChange} onAccessVerified={refreshAfterDomainOrAccessChange} />} buttonStyle="plain" accessibilityLabel="设置" frame={{ width: 44, height: 44 }}><Image systemName="gearshape" font="headline" foregroundStyle="label" /></NavigationLink>
  </ToolbarItem></Toolbar>

  function onlineSection(section: HomeSection, title: string, collection: MissAVCollection) {
    const items = data[section]
    const error = data.errors[section]
    return <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <SectionHeading title={title} trailing={<NavigationLink destination={<DiscoverPage key={`${collection}-${domainRevision}`} initialCollection={collection} {...common} />} buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="small" tint="secondarySystemFill" frame={{ minHeight: 44 }}><Text font="footnote" foregroundStyle="label" lineLimit={1}>查看全部</Text></NavigationLink>} />
      {items.length ? section === "latest"
        ? <LazyVGrid columns={[{ size: { type: "adaptive", min: 154, max: 220 }, spacing: 12 }]} spacing={16}>{items.map(video => <MediaGridCard key={video.videoCode} video={video} responsiveArtwork onOpen={open} />)}</LazyVGrid>
        : <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={14} alignment="top">{items.map(video => <MediaTile key={video.videoCode} video={video} onOpen={open} />)}</LazyHStack></ScrollView>
        : data.loading[section] ? <StateView title={`正在更新${title}`} loading presentation="row" />
        : <StateView title={`${title}暂时无法更新`} description={error || "可前往浏览或下拉刷新。"} kind="error" presentation="section" action={() => { void loader.current?.loadRemote(true) }} actionTitle="重试" />}
      {error && items.length ? <Text font="footnote" foregroundStyle="secondaryLabel">{`${error} 保留已加载内容，可下拉刷新。`}</Text> : undefined}
    </VStack>
  }

  return <NavigationStack><ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} onDisappear={detailNavigation.cancel} overlay={<DetailPreparationStatus navigation={detailNavigation} />}>
    <PageBackground />
    <ScrollView navigationTitle="MISSAV" navigationBarTitleDisplayMode="inline" toolbar={toolbar} scrollEdgeEffectHidden={{ edges: "top", hidden: true }} refreshable={() => loader.current?.refresh() || Promise.resolve()} navigationDestination={{ isPresented: detailNavigation.isPresented, content: selected ? <DetailPage key={`${selected.detail.watchUrl}:${selected.navigationID}`} video={selected.video} initialDetail={selected.detail} initialTrace={selected.trace} preparation={selected.preparation} onHistoryChanged={bumpHistory} /> : <VStack /> }}>
      <VStack spacing={28} alignment="leading" frame={{ maxWidth: CONTENT_MAX_WIDTH }} padding={{ horizontal: PAGE_PADDING, top: PAGE_TOP_PADDING, bottom: PAGE_BOTTOM_PADDING }}>
        <PageIntro title="发现好内容" subtitle="继续观看，或探索新的作品。" systemImage="play.rectangle" />
        <NavigationLink destination={<SearchPage key={`home-search-${domainRevision}`} {...common} />} buttonStyle="plain" frame={{ minHeight: 56 }}><HomeSearchEntry /></NavigationLink>

        {data.recent.length ? <VStack spacing={12} alignment="leading">
          <SectionHeading title="继续观看" subtitle={`${data.recent.length} 部未看完`} level="primary" />
          <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={14} alignment="top">{data.recent.map(record => <ContinueWatchingCard key={record.videoCode} video={record.video} resumeLabel={formatMissAVContinueWatching(record.positionSeconds)} progressFraction={playbackProgressFraction(record)} onOpen={open} />)}</LazyHStack></ScrollView>
        </VStack> : undefined}
        {data.errors.history ? <Text font="footnote" foregroundStyle="secondaryLabel">{data.errors.history}</Text> : undefined}

        <VStack spacing={12} alignment="leading">
          <SectionHeading title="快速浏览" subtitle="直达常用栏目" />
          <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={9}>{HOME_QUICK_COLLECTIONS.map(item => <NavigationLink key={item.group} destination={<DiscoverPage key={`home-category-${item.group}-${domainRevision}`} initialCollection={item.collection} {...common} />} buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="regular" tint={SECONDARY_SURFACE} background={<CapsuleSurface />} frame={{ minHeight: 46 }}><HomeQuickCollectionChip title={item.title} image={item.image} /></NavigationLink>)}</LazyHStack></ScrollView>
        </VStack>

        <HStack spacing={12}>
          <Button action={openDiscover} buttonStyle="plain" frame={{ maxWidth: "infinity", minHeight: 56 }} navigationDestination={{ isPresented: discoverPresented, content: <DiscoverPage key={`home-discover-${domainRevision}`} {...common} /> }}><HomeAction title="浏览" systemImage="square.grid.2x2" /></Button>
          <NavigationLink destination={<HomeHistoryRoute kind="library" revision={historyRevision} domainRevision={domainRevision} {...common} />} buttonStyle="plain" frame={{ maxWidth: "infinity", minHeight: 56 }}><HomeAction title="资料库" systemImage="play.square.stack" /></NavigationLink>
        </HStack>

        {onlineSection("latest", "最近更新", "new")}
        {onlineSection("trending", "今日热门", "today-hot")}
        <NavigationLink destination={<HomeHistoryRoute kind="recommendations" revision={historyRevision} domainRevision={domainRevision} {...common} />} buttonStyle="plain" frame={{ minHeight: 56 }}><HomeAction title="为你推荐" systemImage="sparkles" /></NavigationLink>
      </VStack>
    </ScrollView>
  </ZStack></NavigationStack>
}

// Empty-state navigation belongs to the visible child, not a hidden root button.
function HomeHistoryRoute(props: { kind: "library" | "recommendations"; revision: number; domainRevision: number; onHistoryChanged: () => void }) {
  const discoverPresented = useObservable(false)
  const onDiscover = () => discoverPresented.setValue(true)
  return <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} navigationDestination={{ isPresented: discoverPresented, content: discoverPresented.value ? <DiscoverPage key={`history-discover-${props.domainRevision}`} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
    {props.kind === "library" ? <LibraryPage historyRevision={props.revision} onHistoryChanged={props.onHistoryChanged} onDiscover={onDiscover} /> : <RecommendationsPage revision={props.revision} onHistoryChanged={props.onHistoryChanged} onDiscover={onDiscover} />}
  </VStack>
}

function HomeAction(props: { title: string; systemImage: string }) {
  return <HStack spacing={10} padding={14} frame={{ maxWidth: "infinity", minHeight: 56 }} background={<CardSurface />} contentShape="rect" accessibilityLabel={props.title}>
    <Image systemName={props.systemImage} foregroundStyle={ACCENT} />
    <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.title}</Text>
    <Image systemName="chevron.right" font="caption2" foregroundStyle="tertiaryLabel" />
  </HStack>
}

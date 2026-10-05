import { Button, HStack, Image, LazyHStack, LazyVGrid, NavigationLink, NavigationStack, ProgressView, ScrollView, Script, Text, Toolbar, ToolbarItem, VStack, ZStack, useEffect, useObservable, useRef, useState } from "scripting"
import { isMissAVAccessReady } from "./access"
import { removeLegacyMissAVAccountData } from "./removed-account-migration"
import { missavClient, MissAVRequestScope, type MissAVCollection, type MissAVVideoItem } from "./client"
import { ACCENT, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground } from "./design"
import { loadMissAVHistory, type MissAVPlaybackRecord } from "./storage"
import { formatMissAVContinueWatching } from "./playback-progress"
import { emptyHomeScreenData, HomeScreenLoader, playbackProgressFraction, type HomeSection } from "./home-screen-data"
import { MediaArtwork, MediaGridCard, MediaTile } from "./page/components/media_cards"
import { StateView } from "./page/components/state_view"
import { DetailPage } from "./page/detail"
import { DetailPreparationStatus, useDetailNavigation } from "./page/detail-navigation"
import { DiscoverPage } from "./page/discover"
import { LibraryPage } from "./page/library"
import { RecommendationsPage } from "./page/recommendations"
import { SearchPage } from "./page/search"
import { SettingsPage } from "./page/settings"
import { AccessGate } from "./page/access_gate"

export default function MISSAVHomeScreenView() {
  const [accessReady, setAccessReady] = useState(() => isMissAVAccessReady())
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
    try { removeLegacyMissAVAccountData() } catch { console.error("清理旧会话备份失败，下次启动重试。") }
    return Script.onHomeTabEvent(event => {
      if (event === "selected" && !accessReady && isMissAVAccessReady()) setAccessReady(true)
    })
  }, [accessReady])

  useEffect(() => {
    if (!accessReady) return
    const owner = new HomeScreenLoader({
      history: () => loadMissAVHistory(50),
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
  }, [accessReady, domainRevision])
  // History changes do not restart online listing requests or recreate listeners.
  useEffect(() => { if (accessReady) void loader.current?.loadLocal() }, [accessReady, historyRevision, domainRevision])

  if (!accessReady) return <AccessGate onReady={() => setAccessReady(true)} />
  const toolbar = <Toolbar><ToolbarItem placement="topBarTrailing">
    <NavigationLink destination={<SettingsPage onDomainChanged={refreshAfterDomainOrAccessChange} onAccessVerified={refreshAfterDomainOrAccessChange} />} buttonStyle="plain" accessibilityLabel="设置" frame={{ width: 44, height: 44 }}><Image systemName="gearshape" font="headline" foregroundStyle="label" /></NavigationLink>
  </ToolbarItem></Toolbar>

  function onlineSection(section: HomeSection, title: string, collection: MissAVCollection) {
    const items = data[section]
    const error = data.errors[section]
    return <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <HStack spacing={12}>
        <Text font="title2" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }}>{title}</Text>
        <NavigationLink destination={<DiscoverPage key={`${collection}-${domainRevision}`} initialCollection={collection} {...common} />}><Text font="subheadline" foregroundStyle={ACCENT}>查看全部</Text></NavigationLink>
      </HStack>
      {items.length ? section === "latest"
        ? <LazyVGrid columns={[{ size: { type: "flexible" }, spacing: 14 }, { size: { type: "flexible" }, spacing: 14 }]} spacing={18}>{items.map(video => <MediaGridCard key={video.videoCode} video={video} onOpen={open} />)}</LazyVGrid>
        : <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={14} alignment="top">{items.map(video => <MediaTile key={video.videoCode} video={video} onOpen={open} />)}</LazyHStack></ScrollView>
        : data.loading[section] ? <StateView title={`正在更新${title}`} loading presentation="row" />
        : <StateView title={`${title}暂时无法更新`} description={error || "可前往浏览或下拉刷新。"} kind="error" presentation="section" action={() => { void loader.current?.loadRemote(true) }} actionTitle="重试" />}
      {error && items.length ? <Text font="footnote" foregroundStyle="secondaryLabel">{`${error} 保留已加载内容，可下拉刷新。`}</Text> : undefined}
    </VStack>
  }

  return <NavigationStack><ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} onDisappear={detailNavigation.cancel} overlay={<DetailPreparationStatus navigation={detailNavigation} />}>
    <PageBackground />
    <ScrollView navigationTitle="MISSAV" navigationBarTitleDisplayMode="inline" toolbar={toolbar} scrollEdgeEffectHidden={{ edges: "top", hidden: true }} refreshable={() => loader.current?.refresh() || Promise.resolve()} navigationDestination={{ isPresented: detailNavigation.isPresented, content: selected ? <DetailPage key={`${selected.detail.watchUrl}:${selected.navigationID}`} video={selected.video} initialDetail={selected.detail} preparation={selected.preparation} onHistoryChanged={bumpHistory} /> : <VStack /> }}>
      <VStack spacing={22} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 12, bottom: PAGE_BOTTOM_PADDING }}>
        <NavigationLink destination={<SearchPage key={`home-search-${domainRevision}`} {...common} />} buttonStyle="plain"><HomeAction title="搜索番号、女优或作品" systemImage="magnifyingglass" /></NavigationLink>

        {data.recent.length ? <VStack spacing={8} alignment="leading">
          <HStack spacing={8}>
            <Text font="title2" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }}>继续观看</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">显示 {data.recent.length} 部</Text>
            {data.recent.length > 2 ? <Image systemName="arrow.left.and.right" font="caption2" foregroundStyle="tertiaryLabel" accessibilityLabel="可左右滑动" /> : undefined}
          </HStack>
          <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={12} alignment="top">{data.recent.map(record => <ContinueWatchingCard key={record.videoCode} record={record} onOpen={open} />)}</LazyHStack></ScrollView>
        </VStack> : undefined}
        {data.errors.history ? <Text font="footnote" foregroundStyle="secondaryLabel">{data.errors.history}</Text> : undefined}

        <HStack spacing={12}>
          <Button action={openDiscover} buttonStyle="plain" frame={{ maxWidth: "infinity" }} navigationDestination={{ isPresented: discoverPresented, content: <DiscoverPage key={`home-discover-${domainRevision}`} {...common} /> }}><HomeAction title="浏览" systemImage="square.grid.2x2" /></Button>
          <NavigationLink destination={<HomeHistoryRoute kind="library" revision={historyRevision} domainRevision={domainRevision} {...common} />} buttonStyle="plain" frame={{ maxWidth: "infinity" }}><HomeAction title="资料库" systemImage="play.square.stack" /></NavigationLink>
        </HStack>

        {onlineSection("latest", "最近更新", "new")}
        {onlineSection("trending", "今日热门", "today-hot")}
        <NavigationLink destination={<HomeHistoryRoute kind="recommendations" revision={historyRevision} domainRevision={domainRevision} {...common} />} buttonStyle="plain"><HomeAction title="为你推荐" systemImage="sparkles" /></NavigationLink>
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
  return <HStack spacing={10} padding={12} frame={{ maxWidth: "infinity", minHeight: 50 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 12 }} contentShape="rect" accessibilityLabel={props.title}>
    <Image systemName={props.systemImage} foregroundStyle={ACCENT} />
    <Text font="subheadline" fontWeight="semibold" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.title}</Text>
    <Image systemName="chevron.right" font="caption2" foregroundStyle="tertiaryLabel" />
  </HStack>
}

function ContinueWatchingCard(props: { record: MissAVPlaybackRecord; onOpen: (video: MissAVVideoItem) => void }) {
  const cardWidth = 160
  const video = props.record.video
  const progress = playbackProgressFraction(props.record)
  const metadata = [video.videoCode.toUpperCase(), video.duration].filter(Boolean).join(" · ")
  const status = formatMissAVContinueWatching(props.record.positionSeconds)
  return <Button action={() => props.onOpen(video)} buttonStyle="plain" frame={{ width: cardWidth }} contentShape="rect" accessibilityLabel={[video.title, metadata, status, "继续播放"].filter(Boolean).join("，")}>
    <VStack spacing={5} alignment="leading" frame={{ width: cardWidth, alignment: "leading" }}>
      <MediaArtwork video={video} width={cardWidth} height={90} />
      <Text font="subheadline" fontWeight="semibold" lineLimit={2} frame={{ width: cardWidth, minHeight: 36, alignment: "leading" }} multilineTextAlignment="leading">{video.title}</Text>
      <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ width: cardWidth, alignment: "leading" }}>{metadata}</Text>
      <HStack spacing={4} frame={{ width: cardWidth, alignment: "leading" }}><Image systemName="clock.arrow.circlepath" font="caption2" foregroundStyle={ACCENT} /><Text font="caption2" fontWeight="semibold" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{status}</Text></HStack>
    {progress !== undefined ? <ProgressView value={progress} total={1} progressViewStyle="linear" tint={ACCENT} accessibilityLabel={`已播放 ${Math.round(progress * 100)}%`} /> : undefined}
    </VStack>
  </Button>
}

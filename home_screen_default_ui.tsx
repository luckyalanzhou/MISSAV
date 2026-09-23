import { Divider, HStack, Image, LazyVGrid, NavigationLink, NavigationStack, ScrollView, Script, Text, VStack, ZStack, useEffect, useRef, useState } from "scripting"
import { isMissAVAccessReady } from "./access"
import { missavClient, type MissAVVideoItem } from "./client"
import { ACCESSORY_ALIGNMENT_WIDTH, ACCENT, ICON_ALIGNMENT_WIDTH, MEDIA_RADIUS, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, ROW_MIN_HEIGHT, SECTION_SPACING } from "./design"
import { loadMissAVFavourites, loadMissAVHistory } from "./storage"
import { MediaArtwork } from "./page/components/media_cards"
import { StateView } from "./page/components/state_view"
import { DetailPage } from "./page/detail"
import { DiscoverPage } from "./page/discover"
import { LibraryPage } from "./page/library"
import { RecommendationsPage } from "./page/recommendations"
import { SearchPage } from "./page/search"
import { SettingsPage } from "./page/settings"
import { AccessGate } from "./page/access_gate"

type HomeScreenData = { recent: MissAVVideoItem[]; favourites: MissAVVideoItem[]; trending: MissAVVideoItem[] }
const emptyData: HomeScreenData = { recent: [], favourites: [], trending: [] }
const HOME_REMOTE_TTL = 90_000

export default function MISSAVHomeScreenView() {
  const [accessReady, setAccessReady] = useState(() => isMissAVAccessReady())
  const [data, setData] = useState<HomeScreenData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [favouritesRevision, setFavouritesRevision] = useState(0)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [domainRevision, setDomainRevision] = useState(0)
  const [accountRevision, setAccountRevision] = useState(0)
  const loadGeneration = useRef(0)
  const lastRemoteLoad = useRef(0)
  const bumpFavourites = () => setFavouritesRevision(value => value + 1)
  const bumpHistory = () => setHistoryRevision(value => value + 1)
  const bumpDomain = () => setDomainRevision(value => value + 1)
  const bumpAccount = () => setAccountRevision(value => value + 1)

  async function load(forceRemote = false) {
    const current = ++loadGeneration.current
    setLoading(true); setError(null)
    const shouldLoadRemote = forceRemote || Date.now() - lastRemoteLoad.current >= HOME_REMOTE_TTL
    const results = await Promise.allSettled([
      loadMissAVHistory(6),
      loadMissAVFavourites(),
      shouldLoadRemote ? missavClient.searchVideoPage({ collection: "today-hot", page: 1, sort: "today_views", filter: "" }) : Promise.resolve(null),
    ])
    if (current !== loadGeneration.current) return
    if (shouldLoadRemote && results[2].status === "fulfilled") lastRemoteLoad.current = Date.now()
    setData(previous => ({
      recent: results[0].status === "fulfilled" ? results[0].value.map(item => item.video) : previous.recent,
      favourites: results[1].status === "fulfilled" ? results[1].value.map(item => item.video) : previous.favourites,
      trending: results[2].status === "fulfilled" && results[2].value ? results[2].value.items.slice(0, 6) : previous.trending,
    }))
    if (results.some(result => result.status === "rejected")) setError("部分内容暂时无法更新，当前已显示可用内容。")
    setLoading(false)
  }

  useEffect(() => Script.onHomeTabEvent(event => {
    if (event === "selected" && !accessReady && isMissAVAccessReady()) setAccessReady(true)
  }), [accessReady])

  useEffect(() => {
    if (!accessReady) return
    void load()
    return Script.onHomeTabEvent(event => { if (event === "selected") void load() })
  }, [accessReady, favouritesRevision, historyRevision, domainRevision])

  if (!accessReady) return <AccessGate onReady={() => setAccessReady(true)} />
  const common = { onFavouriteChanged: bumpFavourites, onHistoryChanged: bumpHistory }
  return <NavigationStack><ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollView navigationTitle="MISSAV" navigationBarTitleDisplayMode="inline" scrollEdgeEffectHidden={{ edges: "top", hidden: true }} refreshable={() => load(true)}>
    <VStack spacing={SECTION_SPACING} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 12, bottom: PAGE_BOTTOM_PADDING }}>
      <VStack spacing={4} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="title2" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">快速浏览</Text><Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">继续观看最近内容，或使用下方入口查找作品。</Text></VStack>

      {loading && !data.recent.length && !data.trending.length ? <StateView title="正在准备首页" loading presentation="section" /> : undefined}
      {data.recent.length ? <VideoSection title="继续观看" subtitle="从最近播放的作品继续" items={data.recent} {...common} /> : undefined}

      <VStack spacing={0} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <NavigationLink destination={<DiscoverPage key={`home-discover-${domainRevision}`} {...common} />} buttonStyle="plain"><HomeAction title="浏览" subtitle="浏览最近更新与热门内容" systemImage="square.grid.2x2" /></NavigationLink>
        <Divider />
        <NavigationLink destination={<SearchPage key={`home-search-${domainRevision}`} {...common} />} buttonStyle="plain"><HomeAction title="搜索" subtitle="按番号、女优或作品标题搜索" systemImage="magnifyingglass" /></NavigationLink>
        <Divider />
        <NavigationLink destination={<LibraryPage favouritesRevision={favouritesRevision} historyRevision={historyRevision} accountRevision={accountRevision} {...common} onDiscover={() => {}} />} buttonStyle="plain"><HomeAction title="资料库" subtitle={`${data.favourites.length} 部本机收藏作品`} systemImage="play.square.stack" /></NavigationLink>
        <Divider />
        <NavigationLink destination={<RecommendationsPage revision={favouritesRevision + historyRevision} {...common} onDiscover={() => {}} />} buttonStyle="plain"><HomeAction title="为你推荐" subtitle="根据本机收藏和观看记录生成" systemImage="sparkles" /></NavigationLink>
      </VStack>

      {data.trending.length ? <VideoSection title="今日热门" subtitle="今日观看较多的作品" items={data.trending} {...common} /> : undefined}
      {!loading && !data.recent.length && !data.trending.length ? <StateView title="暂时没有可显示的内容" description={error || "前往浏览或搜索页面开始探索。"} systemImage="play.rectangle" /> : undefined}
      {error && (data.recent.length || data.trending.length) ? <HStack spacing={8}><Image systemName="wifi.exclamationmark" foregroundStyle="secondaryLabel" /><Text font="footnote" foregroundStyle="secondaryLabel">{error}</Text></HStack> : undefined}
      <NavigationLink destination={<SettingsPage onDomainChanged={bumpDomain} onAccountChanged={bumpAccount} />} buttonStyle="plain"><HStack spacing={12} padding={{ vertical: 8 }} frame={{ maxWidth: "infinity", minHeight: 54 }} contentShape="rect"><Image systemName="gearshape" foregroundStyle="secondaryLabel" frame={{ width: 28 }} /><Text font="body" fontWeight="semibold" frame={{ maxWidth: "infinity", alignment: "leading" }}>设置</Text><Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" /></HStack></NavigationLink>
    </VStack>
  </ScrollView></ZStack></NavigationStack>
}

function HomeAction(props: { title: string; subtitle: string; systemImage: string }) {
  return <HStack spacing={12} alignment="center" padding={{ vertical: 8 }} frame={{ maxWidth: "infinity", minHeight: ROW_MIN_HEIGHT }} contentShape="rect" accessibilityLabel={`${props.title}，${props.subtitle}`}>
    <Image systemName={props.systemImage} foregroundStyle={ACCENT} frame={{ width: ICON_ALIGNMENT_WIDTH }} />
    <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.title}</Text><Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.subtitle}</Text></VStack>
    <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" frame={{ width: ACCESSORY_ALIGNMENT_WIDTH, maxHeight: "infinity", alignment: "center" }} />
  </HStack>
}

function VideoSection(props: { title: string; subtitle: string; items: MissAVVideoItem[]; onFavouriteChanged: () => void; onHistoryChanged: () => void }) {
  return <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><VStack spacing={3} alignment="leading"><Text font="title2" fontWeight="bold">{props.title}</Text><Text font="footnote" foregroundStyle="secondaryLabel">{props.subtitle}</Text></VStack><LazyVGrid columns={[{ size: { type: "adaptive", min: 150, max: 230 }, spacing: 14 }]} spacing={18}>{props.items.map(video => <NavigationLink key={video.videoCode} destination={<DetailPage video={video} onFavouriteChanged={props.onFavouriteChanged} onHistoryChanged={props.onHistoryChanged} />} buttonStyle="plain"><HomeVideo video={video} /></NavigationLink>)}</LazyVGrid></VStack>
}

function HomeVideo(props: { video: MissAVVideoItem }) {
  const metadata = [props.video.videoCode.toUpperCase(), props.video.duration].filter(Boolean).join(" · ")
  return <VStack spacing={7} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }} contentShape="rect"><MediaArtwork video={props.video} height={96} radius={MEDIA_RADIUS} /><Text font="subheadline" fontWeight="semibold" lineLimit={2} frame={{ maxWidth: "infinity", minHeight: 38, alignment: "leading" }} multilineTextAlignment="leading">{props.video.title}</Text><Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{metadata}</Text></VStack>
}

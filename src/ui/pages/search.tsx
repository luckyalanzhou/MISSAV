import { Button, HStack, Image, LazyHStack, LazyVStack, Picker, ProgressView, ScrollView, ScrollViewReader, Text, TextField, VStack, ZStack, useEffect, useObservable, useRef, useState, type ScrollViewProxy } from "scripting"
import { defaultMissAVCollectionSort, missavClient, MissAVRequestScope, type MissAVCollection, type MissAVVideoItem } from "../../site/client"
import { ACCENT, CardSurface, CapsuleSurface, READING_MAX_WIDTH, SURFACE, glassButtonStyle, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, PageIntro, SECTION_SPACING } from "../design"
import { DetailPage } from "./detail"
import { DetailPreparationStatus, useDetailNavigation } from "./detail-navigation"
import { MediaGridCard, MediaTile } from "../components/media_cards"
import { VideoRowList } from "../components/video_row"
import { StateView } from "../components/state_view"
import { MissAVListingRequest } from "../../site/listing/listing-request"

type ResultSource = { kind: "query"; query: string } | { kind: "collection"; collection: MissAVCollection; title: string }
type SearchResultLayout = "list" | "cover"

const SEARCH_RESULT_LAYOUT_KEY = "missav.search.result-layout.v1"

function initialSearchResultLayout(): SearchResultLayout {
  return Storage.get<string>(SEARCH_RESULT_LAYOUT_KEY) === "cover" ? "cover" : "list"
}

const discoveryCollections: ReadonlyArray<{ collection: MissAVCollection; title: string; subtitle: string; systemImage: string }> = [
  { collection: "chinese-subtitle", title: "中文字幕", subtitle: "浏览网站中文字幕栏目", systemImage: "captions.bubble" },
  { collection: "new", title: "日本 AV", subtitle: "浏览最近更新，更多分类见浏览页", systemImage: "film" },
  { collection: "siro", title: "素人", subtitle: "浏览 SIRO，更多分类见浏览页", systemImage: "person" },
  { collection: "uncensored-leak", title: "无码影片", subtitle: "浏览无码流出，更多分类见浏览页", systemImage: "lock.open" },
  { collection: "madou", title: "亚洲 AV", subtitle: "浏览麻豆传媒，更多子栏目见浏览页", systemImage: "globe.asia.australia" },
]

export function SearchPage(props: { onHistoryChanged: () => void; toolbar?: any }) {
  const [keyword, setKeyword] = useState("")
  const [inputEpoch, setInputEpoch] = useState(0)
  const [inputFocused, setInputFocused] = useState(false)
  const [source, setSource] = useState<ResultSource | null>(null)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [failedPage, setFailedPage] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<MissAVVideoItem[]>([])
  const [resultLayout, setResultLayout] = useState<SearchResultLayout>(initialSearchResultLayout)
  const [resultsRevision, setResultsRevision] = useState(0)
  const [popular, setPopular] = useState<MissAVVideoItem[]>([])
  const [popularLoading, setPopularLoading] = useState(true)
  const detailNavigation = useDetailNavigation()
  const selected = detailNavigation.selected
  const detailPresented = detailNavigation.isPresented
  const loadedDiscovery = useRef(false)
  const listingRequest = useRef(new MissAVListingRequest())
  const discoveryScope = useRef<MissAVRequestScope | null>(null)
  const scrollProxy = useRef<ScrollViewProxy | null>(null)

  async function loadDiscoveryOnce() {
    if (loadedDiscovery.current) return
    loadedDiscovery.current = true
    const scope = new MissAVRequestScope()
    discoveryScope.current = scope
    try {
      const result = await missavClient.searchVideoPage({ collection: "today-hot", page: 1, sort: "today_views", filter: "" }, { scope })
      if (scope.cancelled) return
      setPopular(result.items.slice(0, 8))
    } catch {
      // Discovery remains useful through categories when the recommendation request fails.
    } finally { if (!scope.cancelled) setPopularLoading(false); if (discoveryScope.current === scope) discoveryScope.current = null }
  }

  async function loadResults(nextSource: ResultSource, nextPage = 1, forceRefresh = false) {
    const sourceChanged = !source || source.kind !== nextSource.kind || (source.kind === "query" ? source.query !== (nextSource.kind === "query" ? nextSource.query : "") : source.collection !== (nextSource.kind === "collection" ? nextSource.collection : ""))
    setLoading(true); setError(null); setSource(nextSource)
    if (sourceChanged) { setItems([]); setHasNext(false); setPage(1) }
    setFailedPage(null)
    const params = nextSource.kind === "query"
      ? { query: nextSource.query, page: nextPage, sort: "released_at" as const, filter: "" as const }
      : { collection: nextSource.collection, page: nextPage, sort: defaultMissAVCollectionSort(nextSource.collection), filter: "" as const }
    await listingRequest.current.load(params, { forceRefresh, allowStale: true }, {
      loaded: result => {
        setItems(result.items); setPage(result.page); setHasNext(result.hasNext); setFailedPage(null); setResultsRevision(value => value + 1)
        setError(result.refreshError || null)
      },
      failed: reason => { setFailedPage(nextPage); setError(reason instanceof Error ? reason.message : String(reason)) },
      settled: () => setLoading(false),
    })
  }

  function dismissKeyboard() {
    if (!inputFocused) return
    setInputFocused(false)
    setInputEpoch(value => value + 1)
  }
  function runSearch() {
    const query = keyword.trim()
    dismissKeyboard()
    if (!query) { listingRequest.current.cancel(); setLoading(false); setFailedPage(null); setError(null); setSource({ kind: "query", query: "" }); setItems([]); setPage(1); setHasNext(false); return }
    void loadResults({ kind: "query", query }, 1, true)
  }
  function open(video: MissAVVideoItem) { void detailNavigation.open(video) }
  function changeResultLayout(value: string | number) {
    const next: SearchResultLayout = value === "cover" ? "cover" : "list"
    setResultLayout(next)
  }
  function showDiscovery() { listingRequest.current.cancel(); setSource(null); setItems([]); setError(null); setFailedPage(null); setLoading(false) }
  useEffect(() => () => { listingRequest.current.cancel(); discoveryScope.current?.cancel() }, [])
  useEffect(() => { if (resultsRevision) scrollProxy.current?.scrollTo("results-top", "top") }, [resultsRevision])
  useEffect(() => { Storage.set(SEARCH_RESULT_LAYOUT_KEY, resultLayout) }, [resultLayout])

  const resultTitle = source?.kind === "query" ? `“${source.query}”` : source?.title

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} onDisappear={detailNavigation.cancel} overlay={<DetailPreparationStatus navigation={detailNavigation} />}>
    <PageBackground />
    <ScrollViewReader>{proxy => { scrollProxy.current = proxy; return <ScrollView navigationTitle="搜索" navigationBarTitleDisplayMode="inline" toolbar={props.toolbar} scrollDismissesKeyboard="interactively" onAppear={() => { void loadDiscoveryOnce() }} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage key={`${selected.detail.watchUrl}:${selected.navigationID}`} video={selected.video} initialDetail={selected.detail} initialTrace={selected.trace} preparation={selected.preparation} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
      <VStack key="results-top" spacing={SECTION_SPACING} alignment="leading" frame={{ maxWidth: READING_MAX_WIDTH }} padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
        {!source ? <PageIntro title="找到想看的" subtitle="输入番号、女优或作品名称。" systemImage="magnifyingglass" /> : undefined}
        <HStack spacing={10} padding={{ horizontal: 14 }} frame={{ maxWidth: "infinity", minHeight: 56 }} background={<CardSurface />} contentShape="rect">
          <Image systemName="magnifyingglass" foregroundStyle="secondaryLabel" />
          <TextField key={`search-input-${inputEpoch}`} title="搜索" prompt="番号、女优或作品标题" value={keyword} onChanged={setKeyword} onSubmit={runSearch} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} frame={{ maxWidth: "infinity" }} />
          {keyword.length ? <Button action={() => setKeyword("")} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="清除搜索词"><Image systemName="xmark.circle.fill" foregroundStyle="tertiaryLabel" /></Button> : undefined}
          <Button action={runSearch} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="搜索"><Image systemName="arrow.right.circle.fill" foregroundStyle={ACCENT} font="title3" /></Button>
        </HStack>

        <VStack spacing={0} alignment="leading" frame={{ maxWidth: "infinity" }}>
        {!source ? <DiscoveryContent popular={popular} popularLoading={popularLoading} onOpen={open} onSelectCollection={(collection, title) => { void loadResults({ kind: "collection", collection, title }, 1) }} /> : <VStack spacing={14} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity" }}>
              <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text font="title3" fontWeight="bold" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{resultTitle ?? "搜索结果"}</Text>
                <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{`第 ${page} 页 · ${items.length} 部作品`}</Text>
              </VStack>
              {loading && items.length ? <ProgressView progressViewStyle="circular" tint={ACCENT} /> : undefined}
            </HStack>
            <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Picker title="结果显示方式" pickerStyle="segmented" value={resultLayout} onChanged={changeResultLayout} frame={{ maxWidth: "infinity" }}>
                <Text tag="list">列表</Text>
                <Text tag="cover">大封面</Text>
              </Picker>
              <Button title="浏览分类" systemImage="square.grid.2x2" action={showDiscovery} buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="small" tint="secondarySystemFill" foregroundStyle="label" frame={{ minHeight: 44, alignment: "trailing" }} />
            </VStack>
          </VStack>
          {loading && !items.length ? <StateView title={source.kind === "query" ? `正在搜索“${source.query}”` : `正在加载${source.title}`} description="正在载入作品列表。" loading presentation="section" /> : source.kind === "query" && !source.query ? <StateView title="输入搜索内容" description="请输入番号、女优或作品标题，然后开始搜索。" kind="empty" systemImage="magnifyingglass" /> : error && !items.length ? <StateView title="加载失败" description={error} kind="error" action={() => { void loadResults(source, failedPage ?? page, true) }} /> : !items.length ? <StateView title="未找到结果" description="请尝试其他番号、女优、作品标题或浏览分类。" kind="empty" systemImage="magnifyingglass" action={showDiscovery} actionTitle="浏览分类" /> : <SearchResultList items={items} layout={resultLayout} onOpen={open} />}
          {error && items.length ? <HStack spacing={8} frame={{ maxWidth: "infinity" }}><Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity" }}>{error}</Text><Button title="重试" systemImage="arrow.clockwise" tint="secondarySystemFill" foregroundStyle="label" buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="small" frame={{ minHeight: 44 }} action={() => { void loadResults(source, failedPage ?? page, true) }} /></HStack> : undefined}
          {items.length ? <HStack spacing={10} frame={{ maxWidth: "infinity" }}><Button title="上一页" systemImage="chevron.left" disabled={page <= 1 || loading} buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="small" tint="secondarySystemFill" foregroundStyle="label" frame={{ minHeight: 44 }} action={() => { void loadResults(source, page - 1) }} /><Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">{`第 ${page} 页`}</Text><Button title="下一页" systemImage="chevron.right" tint={ACCENT} disabled={!hasNext || loading} buttonStyle={glassButtonStyle(true)} buttonBorderShape="capsule" controlSize="small" frame={{ minHeight: 44 }} action={() => { void loadResults(source, page + 1) }} /></HStack> : undefined}
        </VStack>}
        </VStack>
      </VStack>
    </ScrollView>}}</ScrollViewReader>
  </ZStack>
}

function SearchResultList(props: { items: MissAVVideoItem[]; layout: SearchResultLayout; onOpen: (video: MissAVVideoItem) => void }) {
  if (props.layout === "list") return <VideoRowList items={props.items} onOpen={props.onOpen} />
  return <LazyVStack spacing={16} frame={{ maxWidth: "infinity" }}>{props.items.map(video => <MediaGridCard key={video.videoCode} video={video} responsiveArtwork onOpen={props.onOpen} />)}</LazyVStack>
}

function DiscoveryContent(props: { popular: MissAVVideoItem[]; popularLoading: boolean; onOpen: (video: MissAVVideoItem) => void; onSelectCollection: (collection: MissAVCollection, title: string) => void }) {
  return <VStack spacing={SECTION_SPACING} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
    <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="title2" fontWeight="bold">热门推荐</Text>
      {props.popularLoading ? <ProgressView tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: 156 }} /> : props.popular.length ? <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={12} alignment="top">{props.popular.map(video => <MediaTile key={video.videoCode} video={video} onOpen={props.onOpen} />)}</LazyHStack></ScrollView> : <Text font="subheadline" foregroundStyle="secondaryLabel">热门推荐暂时不可用，你仍可浏览下方分类。</Text>}
    </VStack>
    <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="title2" fontWeight="bold">浏览分类</Text>
      <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={9}>{discoveryCollections.map(item => <Button key={item.collection} action={() => props.onSelectCollection(item.collection, item.title)} buttonStyle={glassButtonStyle()} buttonBorderShape="capsule" controlSize="regular" tint={SURFACE} background={<CapsuleSurface />} frame={{ minHeight: 46 }} accessibilityLabel={`${item.title}，${item.subtitle}`}>
        <HStack spacing={8} padding={{ horizontal: 3 }} contentShape="capsule">
          <Image systemName={item.systemImage} font="caption" foregroundStyle="secondaryLabel" />
          <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>{item.title}</Text>
        </HStack>
      </Button>)}</LazyHStack></ScrollView>
    </VStack>
  </VStack>
}

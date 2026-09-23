import { Button, Divider, HStack, Image, LazyHStack, LazyVGrid, LazyVStack, Picker, ProgressView, ScrollView, ScrollViewReader, Text, TextField, VStack, ZStack, useEffect, useObservable, useRef, useState, type ScrollViewProxy } from "scripting"
import { missavClient, type MissAVCollection, type MissAVVideoItem } from "../client"
import { ACCESSORY_ALIGNMENT_WIDTH, ACCENT, MEDIA_ROW_HEIGHT, MEDIA_ROW_RADIUS, MEDIA_ROW_WIDTH, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING } from "../design"
import { DetailPage } from "./detail"
import { MediaArtwork, MediaTile } from "./components/media_cards"
import { StateView } from "./components/state_view"

type ResultSource = { kind: "query"; query: string } | { kind: "collection"; collection: MissAVCollection; title: string }
type SearchResultLayout = "list" | "cover"

const SEARCH_RESULT_LAYOUT_KEY = "missav.search.result-layout.v1"

function initialSearchResultLayout(): SearchResultLayout {
  return Storage.get<string>(SEARCH_RESULT_LAYOUT_KEY) === "cover" ? "cover" : "list"
}

const discoveryCollections: ReadonlyArray<{ collection: MissAVCollection; title: string; subtitle: string; systemImage: string }> = [
  { collection: "new", title: "最近更新", subtitle: "按收录时间浏览近期内容", systemImage: "clock.arrow.circlepath" },
  { collection: "release", title: "新作", subtitle: "浏览近期发行的作品", systemImage: "sparkles" },
  { collection: "english-subtitle", title: "英文字幕", subtitle: "浏览带英文字幕的作品", systemImage: "captions.bubble" },
  { collection: "weekly-hot", title: "本周热门", subtitle: "浏览本周观看较多的作品", systemImage: "chart.line.uptrend.xyaxis" },
]

export function SearchPage(props: { onFavouriteChanged: () => void; onHistoryChanged: () => void; toolbar?: any }) {
  const [keyword, setKeyword] = useState("")
  const [inputEpoch, setInputEpoch] = useState(0)
  const [inputFocused, setInputFocused] = useState(false)
  const [source, setSource] = useState<ResultSource | null>(null)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<MissAVVideoItem[]>([])
  const [resultLayout, setResultLayout] = useState<SearchResultLayout>(initialSearchResultLayout)
  const [resultsRevision, setResultsRevision] = useState(0)
  const [popular, setPopular] = useState<MissAVVideoItem[]>([])
  const [popularLoading, setPopularLoading] = useState(true)
  const [selected, setSelected] = useState<MissAVVideoItem | null>(null)
  const detailPresented = useObservable(false)
  const generation = useRef(0)
  const loadedDiscovery = useRef(false)
  const scrollProxy = useRef<ScrollViewProxy | null>(null)

  async function loadDiscoveryOnce() {
    if (loadedDiscovery.current) return
    loadedDiscovery.current = true
    try {
      const result = await missavClient.searchVideoPage({ collection: "today-hot", page: 1, sort: "today_views", filter: "" })
      setPopular(result.items.slice(0, 8))
    } catch {
      // Discovery remains useful through categories when the recommendation request fails.
    } finally { setPopularLoading(false) }
  }

  async function loadResults(nextSource: ResultSource, nextPage = 1) {
    const gen = ++generation.current
    const sourceChanged = !source || source.kind !== nextSource.kind || (source.kind === "query" ? source.query !== (nextSource.kind === "query" ? nextSource.query : "") : source.collection !== (nextSource.kind === "collection" ? nextSource.collection : ""))
    setLoading(true); setError(null); setSource(nextSource)
    if (sourceChanged) { setItems([]); setHasNext(false); setPage(1) }
    try {
      const result = nextSource.kind === "query"
        ? await missavClient.searchVideoPage({ query: nextSource.query, page: nextPage, sort: "released_at", filter: "" })
        : await missavClient.searchVideoPage({ collection: nextSource.collection, page: nextPage, sort: "released_at", filter: "" })
      if (gen !== generation.current) return
      setItems(result.items); setPage(result.page); setHasNext(result.hasNext); setResultsRevision(value => value + 1)
    } catch (reason) {
      if (gen === generation.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (gen === generation.current) setLoading(false) }
  }

  function dismissKeyboard() {
    if (!inputFocused) return
    setInputFocused(false)
    setInputEpoch(value => value + 1)
  }
  function runSearch() {
    const query = keyword.trim()
    dismissKeyboard()
    if (!query) { ++generation.current; setLoading(false); setError("请输入番号、女优或作品标题。"); setSource({ kind: "query", query: "" }); setItems([]); setPage(1); setHasNext(false); return }
    void loadResults({ kind: "query", query }, 1)
  }
  function open(video: MissAVVideoItem) { setSelected(video); detailPresented.setValue(true) }
  function changeResultLayout(value: string | number) {
    const next: SearchResultLayout = value === "cover" ? "cover" : "list"
    setResultLayout(next)
  }
  function showDiscovery() { ++generation.current; setSource(null); setItems([]); setError(null); setLoading(false) }
  useEffect(() => { if (resultsRevision) scrollProxy.current?.scrollTo("results-top", "top") }, [resultsRevision])
  useEffect(() => { Storage.set(SEARCH_RESULT_LAYOUT_KEY, resultLayout) }, [resultLayout])

  const resultTitle = source?.kind === "query" ? `“${source.query}”` : source?.title

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <ScrollViewReader>{proxy => { scrollProxy.current = proxy; return <ScrollView navigationTitle="搜索" navigationBarTitleDisplayMode="inline" toolbar={props.toolbar} scrollDismissesKeyboard="interactively" onAppear={() => { void loadDiscoveryOnce() }} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage video={selected} onFavouriteChanged={props.onFavouriteChanged} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
      <VStack key="results-top" spacing={SECTION_SPACING} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
        <HStack spacing={10} padding={{ horizontal: 14 }} frame={{ maxWidth: "infinity", minHeight: 48 }} background="tertiarySystemFill" clipShape={{ type: "rect", cornerRadius: 14, style: "continuous" }}>
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
              <Button title="浏览分类" systemImage="square.grid.2x2" action={showDiscovery} frame={{ maxWidth: "infinity", minHeight: 44, alignment: "trailing" }} />
            </VStack>
          </VStack>
          {loading && !items.length ? <ProgressView tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: 260 }} /> : error && !items.length ? <StateView title={source.kind === "query" && !source.query ? "输入搜索内容" : "加载失败"} description={error} kind="error" action={source.kind === "query" && !source.query ? undefined : () => { void loadResults(source, page) }} /> : !items.length ? <StateView title="未找到结果" description="请尝试其他番号、女优、作品标题或浏览分类。" kind="empty" systemImage="magnifyingglass" action={showDiscovery} actionTitle="浏览分类" /> : <SearchResultList items={items} layout={resultLayout} onOpen={open} />}
          {error && items.length ? <Text font="footnote" foregroundStyle="secondaryLabel">新结果加载失败，当前仍显示上次成功的结果。</Text> : undefined}
          {items.length ? <HStack spacing={10} frame={{ maxWidth: "infinity" }}><Button title="上一页" systemImage="chevron.left" disabled={page <= 1 || loading} action={() => { void loadResults(source, page - 1) }} /><Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">{`第 ${page} 页`}</Text><Button title="下一页" systemImage="chevron.right" tint={ACCENT} disabled={!hasNext || loading} action={() => { void loadResults(source, page + 1) }} /></HStack> : undefined}
        </VStack>}
        </VStack>
      </VStack>
    </ScrollView>}}</ScrollViewReader>
  </ZStack>
}

function SearchResultList(props: { items: MissAVVideoItem[]; layout: SearchResultLayout; onOpen: (video: MissAVVideoItem) => void }) {
  return <LazyVStack spacing={0} frame={{ maxWidth: "infinity" }}>
    {props.items.map((video, index) => <VStack key={video.videoCode} spacing={0} frame={{ maxWidth: "infinity" }}>
      <SearchResultCard video={video} layout={props.layout} onOpen={props.onOpen} />
      {index < props.items.length - 1 ? <Divider padding={props.layout === "cover" ? { vertical: 16 } : undefined} /> : undefined}
    </VStack>)}
  </LazyVStack>
}

function SearchResultCard(props: { video: MissAVVideoItem; layout: SearchResultLayout; onOpen: (video: MissAVVideoItem) => void }) {
  const metadata = [props.video.videoCode.toUpperCase(), props.video.duration].filter(Boolean).join(" · ")
  const accessibility = [props.video.title, metadata, props.video.badge, "打开详情"].filter(Boolean).join("，")
  const details = <VStack spacing={4} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
    <Text font="headline" fontWeight="semibold" lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.video.title}</Text>
    <Text font={props.layout === "cover" ? "subheadline" : "caption"} foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{metadata}</Text>
    {props.video.badge ? <HStack spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}><Image systemName="sparkles" font="caption2" foregroundStyle={ACCENT} /><Text font="caption" fontWeight="semibold" lineLimit={1}>{props.video.badge}</Text></HStack> : undefined}
  </VStack>
  return <Button action={() => props.onOpen(props.video)} buttonStyle="plain" frame={{ maxWidth: "infinity" }} contentShape="rect" accessibilityLabel={accessibility}>
    {props.layout === "cover"
      ? <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><MediaArtwork video={props.video} height={196} radius={14} />{details}</VStack>
      : <HStack spacing={12} alignment="center" padding={{ vertical: 11 }} frame={{ maxWidth: "infinity", minHeight: 86 }}><MediaArtwork video={props.video} width={MEDIA_ROW_WIDTH} height={MEDIA_ROW_HEIGHT} radius={MEDIA_ROW_RADIUS} />{details}<Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" frame={{ width: ACCESSORY_ALIGNMENT_WIDTH, maxHeight: "infinity", alignment: "center" }} /></HStack>}
  </Button>
}

function DiscoveryContent(props: { popular: MissAVVideoItem[]; popularLoading: boolean; onOpen: (video: MissAVVideoItem) => void; onSelectCollection: (collection: MissAVCollection, title: string) => void }) {
  return <VStack spacing={SECTION_SPACING} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
    <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="title2" fontWeight="bold">热门推荐</Text>
      {props.popularLoading ? <ProgressView tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: 156 }} /> : props.popular.length ? <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={12} alignment="top">{props.popular.map(video => <MediaTile key={video.videoCode} video={video} onOpen={props.onOpen} />)}</LazyHStack></ScrollView> : <Text font="subheadline" foregroundStyle="secondaryLabel">热门推荐暂时不可用，你仍可浏览下方分类。</Text>}
    </VStack>
    <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="title2" fontWeight="bold">浏览分类</Text>
      <LazyVGrid columns={[{ size: { type: "flexible" }, spacing: 12 }, { size: { type: "flexible" }, spacing: 12 }]} spacing={12}>{discoveryCollections.map(item => <Button key={item.collection} action={() => props.onSelectCollection(item.collection, item.title)} buttonStyle="plain" contentShape="rect" accessibilityLabel={`${item.title}，${item.subtitle}`}>
        <HStack spacing={12} alignment="center" padding={14} frame={{ maxWidth: "infinity", minHeight: 92 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 16, style: "continuous" }}>
          <Image systemName={item.systemImage} font="title2" foregroundStyle={ACCENT} frame={{ width: 32 }} />
          <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text font="headline" fontWeight="semibold" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{item.title}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{item.subtitle}</Text>
          </VStack>
        </HStack>
      </Button>)}</LazyVGrid>
    </VStack>
  </VStack>
}

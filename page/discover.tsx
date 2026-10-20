import { Button, HStack, Image, LazyVGrid, Menu, ProgressView, ScrollView, ScrollViewReader, Spacer, Text, VStack, ZStack, useEffect, useObservable, useRef, useState, type ScrollViewProxy } from "scripting"
import { collectionOptionsForGroup, MISSAV_COLLECTION_GROUPS, MISSAV_COLLECTION_OPTIONS, MISSAV_FILTER_OPTIONS, MISSAV_SORT_OPTIONS, defaultMissAVCollectionSort as defaultCollectionSort, isMissAVDirectoryCollection, type MissAVCategoryItem, type MissAVCollection, type MissAVCollectionGroup, type MissAVFilter, type MissAVSort, type MissAVVideoItem } from "../client"
import { ACCENT, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING } from "../design"
import { DetailPage } from "./detail"
import { DetailPreparationStatus, useDetailNavigation } from "./detail-navigation"
import { MediaGridCard } from "./components/media_cards"
import { StateView } from "./components/state_view"
import { MissAVListingRequest } from "../listing-request"

const collections = MISSAV_COLLECTION_OPTIONS.map(item => ({ ...item }))
const filters = MISSAV_FILTER_OPTIONS.map(item => ({ ...item }))
const sorts = MISSAV_SORT_OPTIONS.map(item => ({ ...item }))

export function DiscoverPage(props: { initialCollection?: MissAVCollection; accessRevision?: number; onHistoryChanged: () => void; toolbar?: any }) {
  const initialCollection = props.initialCollection || "chinese-subtitle"
  const [group, setGroup] = useState<MissAVCollectionGroup>(() => MISSAV_COLLECTION_GROUPS.find(option => option.collections.includes(initialCollection))?.value || "subtitles")
  const [collection, setCollection] = useState<MissAVCollection>(initialCollection)
  const [categoryPath, setCategoryPath] = useState("")
  const [categoryTitle, setCategoryTitle] = useState("")
  const [categories, setCategories] = useState<MissAVCategoryItem[]>([])
  const [filter, setFilter] = useState<MissAVFilter>("")
  const [sort, setSort] = useState<MissAVSort>(defaultCollectionSort(initialCollection))
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<MissAVVideoItem[]>([])
  const [hasNext, setHasNext] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [failedPage, setFailedPage] = useState<number | null>(null)
  const detailNavigation = useDetailNavigation()
  const selected = detailNavigation.selected
  const detailPresented = detailNavigation.isPresented
  const firstLoad = useRef(false)
  const loadingMorePage = useRef<number | null>(null)
  const listingRequest = useRef(new MissAVListingRequest())
  const query = useRef<{ page: number; collection: MissAVCollection; filter: MissAVFilter; sort: MissAVSort; categoryPath: string }>({ page: 1, collection: initialCollection, filter: "", sort: defaultCollectionSort(initialCollection), categoryPath: "" })
  const scrollProxy = useRef<ScrollViewProxy | null>(null)

  async function load(next: { page?: number; collection?: MissAVCollection; filter?: MissAVFilter; sort?: MissAVSort; categoryPath?: string } = {}, forceRefresh = false) {
    const previousQuery = query.current
    const nextQuery = {
      page: next.page ?? previousQuery.page,
      collection: next.collection ?? previousQuery.collection,
      filter: next.filter ?? previousQuery.filter,
      sort: next.sort ?? previousQuery.sort,
      categoryPath: next.categoryPath ?? previousQuery.categoryPath,
    }
    const queryChanged = nextQuery.page !== previousQuery.page || nextQuery.collection !== previousQuery.collection || nextQuery.filter !== previousQuery.filter || nextQuery.sort !== previousQuery.sort || nextQuery.categoryPath !== previousQuery.categoryPath
    const sameCollection = nextQuery.collection === previousQuery.collection && nextQuery.filter === previousQuery.filter && nextQuery.sort === previousQuery.sort && nextQuery.categoryPath === previousQuery.categoryPath
    const appendPage = !forceRefresh && sameCollection && nextQuery.page > previousQuery.page && (items.length > 0 || categories.length > 0)
    if (appendPage && loadingMorePage.current === nextQuery.page) return
    if (appendPage) loadingMorePage.current = nextQuery.page
    query.current = nextQuery
    // Reflect the requested category immediately so a slow request doesn't
    // make a successful tap look like it was ignored.
    setPage(nextQuery.page); setCollection(nextQuery.collection); setFilter(nextQuery.filter); setSort(nextQuery.sort)
    setCategoryPath(nextQuery.categoryPath)
    if (queryChanged && !appendPage) { setItems([]); setCategories([]); setHasNext(true); setFailedPage(null) }
    setLoading(true); setError(null)
    await listingRequest.current.load(nextQuery, { forceRefresh, allowStale: true }, {
      loaded: result => {
        if (appendPage) {
          setItems(current => mergeUnique(current, result.items, item => item.videoCode))
          setCategories(current => mergeUnique(current, result.categories || [], item => item.path))
        } else {
          setItems(result.items); setCategories(result.categories || [])
        }
        setHasNext(result.hasNext); setPage(result.page); setFailedPage(null)
        setError(result.refreshError || null)
      },
      failed: reason => {
        if (appendPage) { query.current = previousQuery; setPage(previousQuery.page); setFailedPage(nextQuery.page) }
        setError(reason instanceof Error ? reason.message : String(reason))
      },
      settled: () => {
        loadingMorePage.current = null
        setLoading(false)
      },
    })
  }
  function loadNextPageIfNeeded() {
    if (!hasNext || loading || error || failedPage !== null || (!items.length && !categories.length)) return
    void load({ page: page + 1 })
  }
  function loadOnce() { if (firstLoad.current) return; firstLoad.current = true; void load() }
  function selectCollection(value: MissAVCollection) {
    setCategoryTitle("")
    void load({ page: 1, collection: value, categoryPath: "", filter: "", sort: defaultCollectionSort(value) })
  }
  function open(video: MissAVVideoItem) { void detailNavigation.open(video) }
  useEffect(() => () => listingRequest.current.cancel(), [])
  useEffect(() => { if (props.accessRevision && firstLoad.current) void load() }, [props.accessRevision])
  useEffect(() => { if (items.length || categories.length) scrollProxy.current?.scrollTo("discover-results-top", "top") }, [collection, filter, sort, categoryPath])
  const subcollections = collectionOptionsForGroup(group)
  const directoryMode = isMissAVDirectoryCollection(collection) && !categoryPath
  const title = categoryTitle || collections.find(item => item.value === collection)?.title || "中文字幕"
  const filterTitle = filters.find(item => item.value === filter)?.title ?? "全部作品"
  const sortTitle = sorts.find(item => item.value === sort)?.title ?? "发行日期"

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} onDisappear={detailNavigation.cancel} overlay={<DetailPreparationStatus navigation={detailNavigation} />}>
    <PageBackground />
    <ScrollViewReader>{proxy => { scrollProxy.current = proxy; return <ScrollView navigationTitle="浏览" navigationBarTitleDisplayMode="inline" toolbar={props.toolbar} onAppear={loadOnce} refreshable={() => load({}, true)} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage key={`${selected.detail.watchUrl}:${selected.navigationID}`} video={selected.video} initialDetail={selected.detail} initialTrace={selected.trace} preparation={selected.preparation} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
      <VStack key="discover-results-top" spacing={16} alignment="leading" padding={{ top: 8, bottom: PAGE_BOTTOM_PADDING }}>
        <ScrollView axes="horizontal" scrollIndicator="hidden">
          <HStack spacing={9} padding={{ horizontal: PAGE_PADDING }}>
            {MISSAV_COLLECTION_GROUPS.map(item => <CategoryChip key={item.value} title={item.title} active={item.value === group} action={() => { setGroup(item.value); selectCollection(item.defaultCollection) }} />)}
          </HStack>
        </ScrollView>

        {subcollections.length > 1 ? <ScrollView axes="horizontal" scrollIndicator="hidden">
          <HStack spacing={9} padding={{ horizontal: PAGE_PADDING }}>
            {subcollections.map(item => <CategoryChip key={item.value} title={item.title} active={item.value === collection} action={() => selectCollection(item.value)} />)}
          </HStack>
        </ScrollView> : undefined}

        <VStack spacing={14} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          {categoryPath ? <Button title={`返回${collections.find(item => item.value === collection)?.title || "分类"}`} systemImage="chevron.left" action={() => selectCollection(collection)} /> : undefined}
          {!directoryMode ? <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
            <Menu label={<OptionChip title={filterTitle} systemImage="line.3.horizontal.decrease" />}>{filters.map(item => <Button key={item.value || "all"} title={item.title} systemImage={item.value === filter ? "checkmark" : item.systemImage} action={() => { void load({ page: 1, filter: item.value }) }} />)}</Menu>
            <Menu label={<OptionChip title={sortTitle} systemImage="arrow.up.arrow.down" />}>{sorts.map(item => <Button key={item.value} title={item.title} systemImage={item.value === sort ? "checkmark" : item.systemImage} action={() => { void load({ page: 1, sort: item.value }) }} />)}</Menu>
            <Spacer />
            {loading && items.length ? <ProgressView progressViewStyle="circular" tint={ACCENT} /> : undefined}
          </HStack> : undefined}

          {directoryMode ? <DirectoryContent categories={categories} loading={loading} error={error} onRetry={() => { void load({}, true) }} onLoadMore={loadNextPageIfNeeded} onSelect={item => { setCategoryTitle(item.title); void load({ page: 1, categoryPath: item.path, filter: "", sort: "released_at" }) }} /> : loading && items.length === 0 ? <ProgressView tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: 360 }} /> : error && items.length === 0 ? <StateView title="加载失败" description={error} kind="error" action={() => { void load({}, true) }} /> : items.length === 0 ? <StateView title="暂无内容" description="当前栏目或筛选条件下暂无内容。" kind="empty" action={() => { void load({ page: 1, collection, filter: "", sort: defaultCollectionSort(collection) }, true) }} actionTitle="重置筛选" /> : <>
            <HStack spacing={12} alignment="center" frame={{ maxWidth: "infinity" }}>
              <Text font="title2" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{title}</Text>
              <Text font="subheadline" foregroundStyle="tertiaryLabel" frame={{ alignment: "trailing" }}>{`本页 ${items.length} 部`}</Text>
            </HStack>
            <LazyVGrid columns={[{ size: { type: "adaptive", min: 154, max: 220 }, spacing: 14 }]} spacing={20}>{items.map((video, index) => index === items.length - 1 ? <VStack key={`discover-load-more-${video.videoCode}`} onAppear={loadNextPageIfNeeded}><MediaGridCard video={video} onOpen={open} /></VStack> : <MediaGridCard key={video.videoCode} video={video} onOpen={open} />)}</LazyVGrid>
          </>}

          {error && (items.length || categories.length) ? <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity" }}>{failedPage !== null ? "加载更多失败" : error}</Text>
            <Button title="重试" systemImage="arrow.clockwise" tint={ACCENT} action={() => { void load({ page: failedPage ?? page }, failedPage === null) }} />
          </HStack> : undefined}
          {loading && (items.length || categories.length) ? <HStack spacing={8} frame={{ maxWidth: "infinity" }}><ProgressView progressViewStyle="circular" tint={ACCENT} /><Text font="footnote" foregroundStyle="secondaryLabel">正在加载更多…</Text></HStack> : undefined}
          {!loading && !error && !hasNext && (items.length || categories.length) ? <Text font="footnote" foregroundStyle="tertiaryLabel" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">已经到底了</Text> : undefined}
        </VStack>
      </VStack>
    </ScrollView>}}</ScrollViewReader>
  </ZStack>
}

function DirectoryContent(props: { categories: MissAVCategoryItem[]; loading: boolean; error: string | null; onRetry: () => void; onLoadMore: () => void; onSelect: (item: MissAVCategoryItem) => void }) {
  if (props.loading && !props.categories.length) return <ProgressView tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: 360 }} />
  if (props.error && !props.categories.length) return <StateView title="分类加载失败" description={props.error} kind="error" action={props.onRetry} />
  if (!props.categories.length) return <StateView title="暂无分类" description="网页暂未返回可选择的分类。" kind="empty" action={props.onRetry} actionTitle="重试" />
  return <LazyVGrid columns={[{ size: { type: "adaptive", min: 154, max: 240 }, spacing: 12 }]} spacing={12}>
    {props.categories.map((item, index) => index === props.categories.length - 1 ? <VStack key={`directory-load-more-${item.path}`} onAppear={props.onLoadMore}><DirectoryCategory item={item} onSelect={props.onSelect} /></VStack> : <DirectoryCategory key={item.path} item={item} onSelect={props.onSelect} />)}
  </LazyVGrid>
}

function DirectoryCategory(props: { item: MissAVCategoryItem; onSelect: (item: MissAVCategoryItem) => void }) {
  const item = props.item
  return <Button action={() => props.onSelect(item)} buttonStyle="plain" contentShape="rect">
      <HStack spacing={10} padding={12} frame={{ maxWidth: "infinity", minHeight: 64, alignment: "leading" }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 12 }}>
        {item.coverUrl ? <Image imageUrl={item.coverUrl} resizable aspectRatio={{ value: 1, contentMode: "fill" }} frame={{ width: 44, height: 44 }} clipped /> : <Image systemName="folder" foregroundStyle={ACCENT} />}
        <Text font="subheadline" lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>{item.title}</Text>
        <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" />
      </HStack>
    </Button>
}

function mergeUnique<T>(current: T[], incoming: T[], keyOf: (item: T) => string) {
  const seen = new Set(current.map(keyOf))
  return [...current, ...incoming.filter(item => { const key = keyOf(item); if (seen.has(key)) return false; seen.add(key); return true })]
}

function CategoryChip(props: { title: string; active: boolean; action: () => void }) {
  return <Button action={props.action} buttonStyle="plain" frame={{ minHeight: 44 }} contentShape="rect" accessibilityLabel={`${props.title}${props.active ? "，已选择" : ""}`}>
    <HStack spacing={6} padding={{ horizontal: 15, vertical: 8 }} fixedSize={{ horizontal: true, vertical: false }} background={props.active ? ACCENT : "secondarySystemBackground"} clipShape="capsule">
      {props.active ? <Image systemName="checkmark" font="caption2" foregroundStyle="white" /> : undefined}
      <Text font="subheadline" fontWeight={props.active ? "bold" : "medium"} foregroundStyle={props.active ? "white" : "label"} lineLimit={1} fixedSize={{ horizontal: true, vertical: false }}>{props.title}</Text>
    </HStack>
  </Button>
}

function OptionChip(props: { title: string; systemImage: string }) {
  return <HStack spacing={6} padding={{ horizontal: 11, vertical: 7 }} fixedSize={{ horizontal: true, vertical: false }} background="secondarySystemBackground" clipShape="capsule">
    <Image systemName={props.systemImage} font="caption" foregroundStyle="secondaryLabel" />
    <Text font="footnote" fontWeight="semibold" lineLimit={1} fixedSize={{ horizontal: true, vertical: false }}>{props.title}</Text>
    <Image systemName="chevron.down" font="caption2" foregroundStyle="tertiaryLabel" />
  </HStack>
}


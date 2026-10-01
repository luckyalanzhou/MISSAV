import { Button, HStack, Image, LazyVGrid, Menu, ProgressView, ScrollView, ScrollViewReader, Spacer, Text, VStack, ZStack, useEffect, useObservable, useRef, useState, type ScrollViewProxy } from "scripting"
import { collectionOptionsForGroup, MISSAV_COLLECTION_GROUPS, MISSAV_COLLECTION_OPTIONS, MISSAV_FILTER_OPTIONS, MISSAV_SORT_OPTIONS, defaultMissAVCollectionSort as defaultCollectionSort, isMissAVDirectoryCollection, missavClient, type MissAVCategoryItem, type MissAVCollection, type MissAVCollectionGroup, type MissAVFilter, type MissAVSort, type MissAVVideoItem } from "../client"
import { ACCENT, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING } from "../design"
import { DetailPage } from "./detail"
import { MediaGridCard } from "./components/media_cards"
import { StateView } from "./components/state_view"

const collections = MISSAV_COLLECTION_OPTIONS.map(item => ({ ...item }))
const filters = MISSAV_FILTER_OPTIONS.map(item => ({ ...item }))
const sorts = MISSAV_SORT_OPTIONS.map(item => ({ ...item }))

export function DiscoverPage(props: { onFavouriteChanged: () => void; onHistoryChanged: () => void; toolbar?: any }) {
  const [group, setGroup] = useState<MissAVCollectionGroup>("subtitles")
  const [collection, setCollection] = useState<MissAVCollection>("chinese-subtitle")
  const [categoryPath, setCategoryPath] = useState("")
  const [categoryTitle, setCategoryTitle] = useState("")
  const [categories, setCategories] = useState<MissAVCategoryItem[]>([])
  const [filter, setFilter] = useState<MissAVFilter>("")
  const [sort, setSort] = useState<MissAVSort>(defaultCollectionSort("chinese-subtitle"))
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<MissAVVideoItem[]>([])
  const [hasNext, setHasNext] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<MissAVVideoItem | null>(null)
  const detailPresented = useObservable(false)
  const firstLoad = useRef(false)
  const generation = useRef(0)
  const query = useRef<{ page: number; collection: MissAVCollection; filter: MissAVFilter; sort: MissAVSort; categoryPath: string }>({ page: 1, collection: "chinese-subtitle", filter: "", sort: defaultCollectionSort("chinese-subtitle"), categoryPath: "" })
  const scrollProxy = useRef<ScrollViewProxy | null>(null)

  async function load(next: { page?: number; collection?: MissAVCollection; filter?: MissAVFilter; sort?: MissAVSort; categoryPath?: string } = {}, forceRefresh = false) {
    const gen = ++generation.current
    const previousQuery = query.current
    const nextQuery = {
      page: next.page ?? previousQuery.page,
      collection: next.collection ?? previousQuery.collection,
      filter: next.filter ?? previousQuery.filter,
      sort: next.sort ?? previousQuery.sort,
      categoryPath: next.categoryPath ?? previousQuery.categoryPath,
    }
    const queryChanged = nextQuery.page !== previousQuery.page || nextQuery.collection !== previousQuery.collection || nextQuery.filter !== previousQuery.filter || nextQuery.sort !== previousQuery.sort || nextQuery.categoryPath !== previousQuery.categoryPath
    query.current = nextQuery
    // Reflect the requested category immediately so a slow request doesn't
    // make a successful tap look like it was ignored.
    setPage(nextQuery.page); setCollection(nextQuery.collection); setFilter(nextQuery.filter); setSort(nextQuery.sort)
    setCategoryPath(nextQuery.categoryPath)
    if (queryChanged) { setItems([]); setCategories([]); setHasNext(true) }
    setLoading(true); setError(null)
    try {
      const result = await missavClient.searchVideoPage(nextQuery, { forceRefresh })
      if (gen !== generation.current) return
      setItems(result.items); setCategories(result.categories || []); setHasNext(result.hasNext); setPage(result.page)
    } catch (reason) { if (gen === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (gen === generation.current) setLoading(false) }
  }
  function loadOnce() { if (firstLoad.current) return; firstLoad.current = true; void load() }
  function selectCollection(value: MissAVCollection) {
    setCategoryTitle("")
    void load({ page: 1, collection: value, categoryPath: "", filter: "", sort: defaultCollectionSort(value) })
  }
  function open(video: MissAVVideoItem) { setSelected(video); detailPresented.setValue(true) }
  useEffect(() => { if (items.length || categories.length) scrollProxy.current?.scrollTo("discover-results-top", "top") }, [page, collection, filter, sort, categoryPath])
  const subcollections = collectionOptionsForGroup(group)
  const directoryMode = isMissAVDirectoryCollection(collection) && !categoryPath
  const title = categoryTitle || collections.find(item => item.value === collection)?.title || "中文字幕"
  const filterTitle = filters.find(item => item.value === filter)?.title ?? "全部作品"
  const sortTitle = sorts.find(item => item.value === sort)?.title ?? "发行日期"
  const hero = page === 1 ? items[0] : undefined
  const recommendations = hero ? items.slice(1) : items

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <ScrollViewReader>{proxy => { scrollProxy.current = proxy; return <ScrollView navigationTitle="浏览" navigationBarTitleDisplayMode="inline" toolbar={props.toolbar} onAppear={loadOnce} refreshable={() => load({}, true)} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage video={selected} onFavouriteChanged={props.onFavouriteChanged} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
      <VStack key="discover-results-top" spacing={SECTION_SPACING} alignment="leading" padding={{ top: 8, bottom: PAGE_BOTTOM_PADDING }}>
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

          {directoryMode ? <DirectoryContent categories={categories} loading={loading} error={error} onRetry={() => { void load({}, true) }} onSelect={item => { setCategoryTitle(item.title); void load({ page: 1, categoryPath: item.path, filter: "", sort: "released_at" }) }} /> : loading && items.length === 0 ? <ProgressView tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: 360 }} /> : error && items.length === 0 ? <StateView title="加载失败" description={error} kind="error" action={() => { void load({}, true) }} /> : items.length === 0 ? <StateView title="暂无内容" description="当前栏目或筛选条件下暂无内容。" kind="empty" action={() => { void load({ page: 1, collection, filter: "", sort: defaultCollectionSort(collection) }, true) }} actionTitle="重置筛选" /> : <>
            {hero ? <DiscoverHero video={hero} eyebrow="本栏精选" onOpen={open} /> : undefined}
            <HStack spacing={12} alignment="center" frame={{ maxWidth: "infinity" }}>
              <Text font="title2" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{page === 1 ? "更多作品" : title}</Text>
              <Text font="subheadline" foregroundStyle="tertiaryLabel" frame={{ alignment: "trailing" }}>{`${items.length} 部作品`}</Text>
            </HStack>
            {recommendations.length ? <LazyVGrid columns={[{ size: { type: "adaptive", min: 154, max: 220 }, spacing: 14 }]} spacing={20}>{recommendations.map(video => <MediaGridCard key={video.videoCode} video={video} onOpen={open} />)}</LazyVGrid> : undefined}
          </>}

          {error && items.length ? <StateView title="刷新失败" description="正在显示上次结果。" kind="error" action={() => { void load({}, true) }} actionTitle="重试" /> : undefined}
          {items.length || categories.length ? <HStack spacing={10} frame={{ maxWidth: "infinity" }}><Button title="上一页" systemImage="chevron.left" disabled={page <= 1 || loading} action={() => { void load({ page: page - 1 }) }} /><Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">{`第 ${page} 页`}</Text><Button title="下一页" systemImage="chevron.right" tint={ACCENT} disabled={!hasNext || loading} action={() => { void load({ page: page + 1 }) }} /></HStack> : undefined}
        </VStack>
      </VStack>
    </ScrollView>}}</ScrollViewReader>
  </ZStack>
}

function DirectoryContent(props: { categories: MissAVCategoryItem[]; loading: boolean; error: string | null; onRetry: () => void; onSelect: (item: MissAVCategoryItem) => void }) {
  if (props.loading && !props.categories.length) return <ProgressView tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: 360 }} />
  if (props.error && !props.categories.length) return <StateView title="分类加载失败" description={props.error} kind="error" action={props.onRetry} />
  if (!props.categories.length) return <StateView title="暂无分类" description="网页暂未返回可选择的分类。" kind="empty" action={props.onRetry} actionTitle="重试" />
  return <LazyVGrid columns={[{ size: { type: "adaptive", min: 154, max: 240 }, spacing: 12 }]} spacing={12}>
    {props.categories.map(item => <Button key={item.path} action={() => props.onSelect(item)} buttonStyle="plain" contentShape="rect">
      <HStack spacing={10} padding={12} frame={{ maxWidth: "infinity", minHeight: 64, alignment: "leading" }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 12 }}>
        {item.coverUrl ? <Image imageUrl={item.coverUrl} resizable aspectRatio={{ value: 1, contentMode: "fill" }} frame={{ width: 44, height: 44 }} clipped /> : <Image systemName="folder" foregroundStyle={ACCENT} />}
        <Text font="subheadline" lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>{item.title}</Text>
        <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" />
      </HStack>
    </Button>)}
  </LazyVGrid>
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

function DiscoverHero(props: { video: MissAVVideoItem; eyebrow: string; onOpen: (video: MissAVVideoItem) => void }) {
  const metadata = [props.video.videoCode.toUpperCase(), props.video.duration].filter(Boolean).join(" · ")
  return <Button action={() => props.onOpen(props.video)} buttonStyle="plain" frame={{ maxWidth: "infinity" }} contentShape="rect" accessibilityLabel={[props.eyebrow, props.video.title, metadata].filter(Boolean).join("，")}>
    <ZStack alignment="bottomLeading" frame={{ maxWidth: "infinity", height: 220 }} background="tertiarySystemFill" clipShape={{ type: "rect", cornerRadius: 18, style: "continuous" }}>
      {props.video.coverUrl ? <Image imageUrl={props.video.coverUrl} resizable aspectRatio={{ value: 16 / 9, contentMode: "fill" }} frame={{ maxWidth: "infinity", height: 220 }} clipped /> : <Image systemName="play.rectangle" font="largeTitle" foregroundStyle="tertiaryLabel" />}
      <VStack spacing={6} alignment="leading" padding={{ horizontal: 18, vertical: 16 }} frame={{ maxWidth: "infinity", alignment: "leading" }} background="rgba(0,0,0,0.68)">
        <Text font="caption" fontWeight="bold" foregroundStyle="white">{props.eyebrow}</Text>
        <Text font="title3" fontWeight="bold" foregroundStyle="white" lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.video.title}</Text>
        <HStack spacing={7}><Image systemName="play.fill" font="caption2" foregroundStyle="white" /><Text font="subheadline" foregroundStyle="white" lineLimit={1}>{metadata}</Text></HStack>
      </VStack>
    </ZStack>
  </Button>
}


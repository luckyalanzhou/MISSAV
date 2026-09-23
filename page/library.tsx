import { Button, HStack, Image, Menu, Picker, ScrollView, Text, VStack, ZStack, useEffect, useObservable, useRef, useState } from "scripting"
import type { MissAVVideoItem } from "../client"
import { loadMissAVSavedVideos } from "../account"
import { PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING } from "../design"
import {
  clearMissAVBrowseHistory,
  clearMissAVHistory,
  loadMissAVBrowseHistory,
  loadMissAVFavourites,
  loadMissAVHistory,
  type MissAVBrowseRecord,
  type MissAVFavouriteRecord,
  type MissAVPlaybackRecord,
} from "../storage"
import { DetailPage } from "./detail"
import { DestructiveMenu } from "./components/destructive_menu"
import { StateView } from "./components/state_view"
import { VideoRowList } from "./components/video_row"

type LibraryGroup = "saved" | "history"
type LibrarySegment = "account" | "favourites" | "playback" | "browse"
type LibraryData = {
  favourites: MissAVFavouriteRecord[]
  playback: MissAVPlaybackRecord[]
  browse: MissAVBrowseRecord[]
  account: MissAVVideoItem[]
}

const emptyData: LibraryData = { favourites: [], playback: [], browse: [], account: [] }

const segmentMetadata: Record<LibrarySegment, { title: string; subtitle: string; emptyTitle: string; emptyDescription: string; emptyIcon: string }> = {
  account: {
    title: "网站收藏",
    subtitle: "当前网站账号中的收藏。",
    emptyTitle: "还没有网站收藏",
    emptyDescription: "在网站中收藏作品后，刷新这里查看。",
    emptyIcon: "person.crop.circle.badge.bookmark",
  },
  favourites: {
    title: "收藏",
    subtitle: "保存在本机的收藏，可随时打开查看。",
    emptyTitle: "还没有收藏",
    emptyDescription: "在详情页加入收藏后，会直接出现在这里。",
    emptyIcon: "heart.slash",
  },
  playback: {
    title: "播放记录",
    subtitle: "最近播放过的内容，可随时继续观看。",
    emptyTitle: "还没有播放记录",
    emptyDescription: "开始播放后，最近观看的视频会出现在这里。",
    emptyIcon: "clock",
  },
  browse: {
    title: "浏览记录",
    subtitle: "打开过详情的内容，只保存在本机。",
    emptyTitle: "还没有浏览记录",
    emptyDescription: "打开视频详情后，会直接出现在这里。",
    emptyIcon: "eye",
  },
}

export function LibraryPage(props: { favouritesRevision: number; historyRevision: number; accountRevision: number; onFavouriteChanged: () => void; onHistoryChanged: () => void; onDiscover: () => void; toolbar?: any }) {
  const [group, setGroup] = useState<LibraryGroup>("saved")
  const [segment, setSegment] = useState<LibrarySegment>("favourites")
  const [data, setData] = useState<LibraryData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [accountLoading, setAccountLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clearError, setClearError] = useState<string | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [accountPage, setAccountPage] = useState(1)
  const [accountHasNext, setAccountHasNext] = useState(false)
  const [clearing, setClearing] = useState<"playback" | "browse" | null>(null)
  const [selected, setSelected] = useState<MissAVVideoItem | null>(null)
  const detailPresented = useObservable(false)
  const generation = useRef(0)

  async function load() {
    const current = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const [favourites, playback, browse] = await Promise.all([loadMissAVFavourites(), loadMissAVHistory(), loadMissAVBrowseHistory()])
      if (current === generation.current) setData(previous => ({ ...previous, favourites, playback, browse }))
    } catch (reason) {
      if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }

  async function loadAccount() {
    if (accountLoading) return
    setAccountLoading(true)
    setAccountError(null)
    try {
      const result = await loadMissAVSavedVideos()
      setData(current => ({ ...current, account: result.items }))
      setAccountPage(result.page)
      setAccountHasNext(result.hasNext)
    } catch (reason) {
      setAccountError(reason instanceof Error ? reason.message : "网站收藏暂时无法加载。")
    } finally { setAccountLoading(false) }
  }

  async function refresh() { await Promise.all([load(), ...(segment === "account" ? [loadAccount()] : [])]) }

  useEffect(() => { void load() }, [props.favouritesRevision, props.historyRevision])
  useEffect(() => {
    setData(current => ({ ...current, account: [] }))
    setAccountError(null)
    setAccountPage(1)
    setAccountHasNext(false)
    if (segment === "account") void loadAccount()
  }, [props.accountRevision])
  useEffect(() => { if (segment === "account" && !data.account.length && !accountError) void loadAccount() }, [segment])
  function changeGroup(value: string | number) {
    const next: LibraryGroup = value === "history" ? "history" : "saved"
    setGroup(next)
    setSegment(next === "history" ? "playback" : "favourites")
  }

  async function loadMoreAccount() {
    if (accountLoading || !accountHasNext) return
    setAccountLoading(true)
    setAccountError(null)
    try {
      const result = await loadMissAVSavedVideos(accountPage + 1)
      setData(current => ({ ...current, account: [...current.account, ...result.items] }))
      setAccountPage(result.page)
      setAccountHasNext(result.hasNext)
    } catch (reason) {
      setAccountError(reason instanceof Error ? reason.message : "网站收藏暂时无法加载。")
    } finally { setAccountLoading(false) }
  }

  function open(video: MissAVVideoItem) {
    setSelected(video)
    detailPresented.setValue(true)
  }

  async function clearPlayback() {
    if (clearing) return
    setClearing("playback"); setClearError(null)
    try {
      await clearMissAVHistory()
      setData(current => ({ ...current, playback: [] }))
      props.onHistoryChanged()
    } catch {
      setClearError("无法清除播放记录，请稍后重试。")
    } finally { setClearing(null) }
  }

  async function clearBrowse() {
    if (clearing) return
    setClearing("browse"); setClearError(null)
    try {
      await clearMissAVBrowseHistory()
      setData(current => ({ ...current, browse: [] }))
      props.onHistoryChanged()
    } catch {
      setClearError("无法清除浏览记录，请稍后重试。")
    } finally { setClearing(null) }
  }

  const metadata = segmentMetadata[segment]
  const items = segment === "account" ? data.account : segment === "favourites" ? data.favourites.map(item => item.video) : segment === "playback" ? data.playback.map(item => item.video) : data.browse.map(item => item.video)
  const statuses = segment === "playback"
    ? new Map(data.playback.map(item => [item.videoCode, `上次播放 ${item.qualityLabel}`]))
    : segment === "browse"
      ? new Map(data.browse.map(item => [item.videoCode, item.viewCount > 1 ? `浏览 ${item.viewCount} 次` : "最近浏览"]))
      : undefined
  const statusSystemImage = segment === "playback" ? "play.circle" : segment === "browse" ? "eye" : segment === "account" ? "person.crop.circle.badge.checkmark" : undefined

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <ScrollView
      navigationTitle="资料库"
      navigationBarTitleDisplayMode="inline"
      toolbar={props.toolbar}
      refreshable={refresh}
      navigationDestination={{
        isPresented: detailPresented,
        content: selected ? <DetailPage video={selected} onFavouriteChanged={props.onFavouriteChanged} onHistoryChanged={props.onHistoryChanged} /> : <VStack />,
      }}
    >
      <VStack spacing={SECTION_SPACING} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
        <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Picker title="资料库内容" pickerStyle="segmented" value={group} onChanged={changeGroup} frame={{ maxWidth: "infinity" }}>
            <Text tag="saved">收藏</Text>
            <Text tag="history">历史</Text>
          </Picker>
          <Menu label={<HStack spacing={10} alignment="center" padding={{ horizontal: 12, vertical: 8 }} frame={{ maxWidth: "infinity", minHeight: 44 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}><Image systemName={group === "saved" ? "bookmark" : "clock"} foregroundStyle="secondaryLabel" /><Text font="subheadline" foregroundStyle="secondaryLabel">{group === "saved" ? "收藏来源" : "历史类型"}</Text><Text font="subheadline" fontWeight="semibold" frame={{ maxWidth: "infinity", alignment: "trailing" }}>{segmentMetadata[segment].title}</Text><Image systemName="chevron.up.chevron.down" font="caption2" foregroundStyle="tertiaryLabel" /></HStack>}>
            {group === "saved" ? <><Button title="本机收藏" systemImage={segment === "favourites" ? "checkmark" : "heart"} action={() => setSegment("favourites")} /><Button title="网站收藏" systemImage={segment === "account" ? "checkmark" : "bookmark"} action={() => setSegment("account")} /></> : <><Button title="播放记录" systemImage={segment === "playback" ? "checkmark" : "play.circle"} action={() => setSegment("playback")} /><Button title="浏览记录" systemImage={segment === "browse" ? "checkmark" : "eye"} action={() => setSegment("browse")} /></>}
          </Menu>
        </VStack>

        <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font="title3" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{metadata.title}</Text>
          <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{metadata.subtitle}</Text>
          <Text font="footnote" foregroundStyle="secondaryLabel" contentTransition="numericText" frame={{ maxWidth: "infinity", alignment: "leading" }}>{segment === "account" ? `${items.length} 部作品 · 来自网站账号` : `${items.length} 部作品 · 仅保存在本机`}</Text>
        </VStack>

        {(segment === "account" ? accountLoading : loading) && !items.length
          ? <StateView title={segment === "account" ? "正在加载网站收藏" : "正在加载资料库"} loading presentation="section" />
          : segment === "account" && accountError
            ? <StateView title="网站收藏暂时不可用" description={accountError} kind="error" action={() => { void loadAccount() }} actionTitle="重试" />
            : segment !== "account" && error
              ? <StateView title="资料库加载失败" description={error} kind="error" action={() => { void load() }} presentation="section" />
              : items.length
                ? <VideoRowList items={items} status={video => statuses?.get(video.videoCode)} statusSystemImage={statusSystemImage} onOpen={open} />
                : <StateView title={metadata.emptyTitle} description={metadata.emptyDescription} systemImage={metadata.emptyIcon} action={props.onDiscover} actionTitle="浏览视频" />}

        {segment === "account" && data.account.length && accountHasNext ? <Button title={accountLoading ? "正在加载网站收藏" : "加载更多网站收藏"} systemImage={accountLoading ? "arrow.clockwise" : "ellipsis.circle"} disabled={accountLoading} action={() => { void loadMoreAccount() }} frame={{ maxWidth: "infinity", minHeight: 44 }} /> : undefined}
        {segment === "playback" && data.playback.length ? <DestructiveMenu title="清空播放记录" confirmationTitle="确认清空播放记录" description="删除全部本机播放记录，不会影响收藏。" action={clearPlayback} busy={clearing === "playback"} /> : undefined}
        {segment === "browse" && data.browse.length ? <DestructiveMenu title="清空浏览记录" confirmationTitle="确认清空浏览记录" description="删除全部本机浏览记录，不会影响收藏和播放记录。" action={clearBrowse} busy={clearing === "browse"} /> : undefined}

        {clearError ? <StateView title="清除失败" description={clearError} kind="error" presentation="row" /> : undefined}
        <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">网站收藏来自当前网站账号；本机收藏、浏览记录和播放记录不会上传。</Text>
      </VStack>
    </ScrollView>
  </ZStack>
}

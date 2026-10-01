import { Button, Divider, EnvironmentValuesReader, HStack, Image, LazyVStack, Navigation, NavigationStack, ProgressView, ScrollView, ScrollViewReader, Text, TextField, VStack, ZStack, useEffect, useObservable, useRef, useState, type DynamicTypeSize, type ScrollViewProxy } from "scripting"
import { missavClient, type MissAVVideoDetail, type MissAVVideoItem, type MissAVVideoSource } from "../client"
import { ACCENT, Badge, MEDIA_HERO_RADIUS, PAGE_BOTTOM_PADDING, PAGE_PADDING, PRIMARY_ACTION_HEIGHT, PageBackground, SECONDARY_ACTION_HEIGHT, SECTION_SPACING, SectionHeading } from "../design"
import { chooseAndPresentMissAVPlayer } from "../player"
import { getMissAVAccountSnapshot, getMissAVWebsiteSavedState, setMissAVWebsiteSaved } from "../account"
import { isMissAVFavourite, rememberMissAVDetail, toggleMissAVFavourite } from "../storage"
import { hasMissAVSubtitle, isMissAVSubtitleEnabled, saveMissAVSubtitle, setMissAVSubtitleEnabled } from "../subtitles"
import { downloadJavSubSubtitleFile, searchJavSubSubtitleFiles, type JavSubSubtitleFile } from "../javsub"
import { downloadSubtitleCatFile, searchSubtitleCatFiles, type SubtitleCatSubtitleFile } from "../subtitlecat"
import { MediaArtwork } from "./components/media_cards"
import { StateView } from "./components/state_view"
import { VideoRowList } from "./components/video_row"
import { MISSAV_SUBTITLE_PREVIEW } from "../subtitles"

export function DetailPage(props: { video: MissAVVideoItem; onFavouriteChanged: () => void; onHistoryChanged: () => void }) {
  const [detail, setDetail] = useState<MissAVVideoDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [openingSource, setOpeningSource] = useState<string | null>(null)
  const [subtitleAvailable, setSubtitleAvailable] = useState(false)
  const [subtitleEnabled, setSubtitleEnabled] = useState(true)
  const [subtitleBusy, setSubtitleBusy] = useState(false)
  const [favourite, setFavourite] = useState<boolean | null>(null)
  const [favouriteError, setFavouriteError] = useState<string | null>(null)
  const [websiteSaved, setWebsiteSaved] = useState<boolean | null>(null)
  const [websiteSavedError, setWebsiteSavedError] = useState<string | null>(null)
  const [changingFavourite, setChangingFavourite] = useState<"local" | "website" | null>(null)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const tagSearchPresented = useObservable(false)
  const generation = useRef(0)
  const favouriteGeneration = useRef(0)
  const subtitleGeneration = useRef(0)

  async function load() {
    const current = ++generation.current
    setLoading(true); setDetailError(null)
    try {
      const next = await missavClient.getVideo(props.video)
      if (current !== generation.current) return
      setDetail(next)
      try { await rememberMissAVDetail(props.video, next); if (current === generation.current) props.onHistoryChanged() }
      catch (reason) { console.error("保存浏览记录失败:", reason) }
    } catch (reason) {
      if (current === generation.current) setDetailError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (current === generation.current) setLoading(false) }
  }

  useEffect(() => {
    setDetail(null); setOpeningSource(null); void load()
    setSubtitleAvailable(false)
    setSubtitleEnabled(true)
    const subtitleRequest = ++subtitleGeneration.current
    void hasMissAVSubtitle(props.video.videoCode).then(available => {
      if (subtitleRequest !== subtitleGeneration.current) return
      setSubtitleAvailable(available)
      setSubtitleEnabled(isMissAVSubtitleEnabled(props.video.videoCode))
    }).catch(reason => console.error("读取字幕状态失败:", reason))
    const current = ++favouriteGeneration.current
    setFavourite(null)
    setFavouriteError(null)
    void isMissAVFavourite(props.video.videoCode).then(value => { if (current === favouriteGeneration.current) setFavourite(value) }).catch(() => { if (current === favouriteGeneration.current) setFavouriteError("本机收藏状态读取失败。") })
    setWebsiteSaved(null)
    const account = getMissAVAccountSnapshot()
    if (account.state !== "signedIn") {
      setWebsiteSavedError(account.state === "expired" ? "网站账号已失效，请在设置中重新登录。" : "登录网站账号后，即可使用网站收藏。")
    } else {
      setWebsiteSavedError(null)
      void getMissAVWebsiteSavedState(props.video.detailPath).then(value => { if (current === favouriteGeneration.current) setWebsiteSaved(value.saved) }).catch(reason => { if (current === favouriteGeneration.current) setWebsiteSavedError(reason instanceof Error ? reason.message : "网站收藏状态读取失败。") })
    }
  }, [props.video.videoCode])

  async function play(source: MissAVVideoSource, subtitlePreview = false) {
    if (!detail || openingSource) return
    setOpeningSource(source.url)
    try {
      const result = await chooseAndPresentMissAVPlayer(props.video, source, subtitlePreview ? { subtitles: MISSAV_SUBTITLE_PREVIEW, preview: true } : undefined)
      if (result.opened && !subtitlePreview) props.onHistoryChanged()
    }
    catch (reason) { await Dialog.alert({ title: "播放失败", message: reason instanceof Error ? reason.message : String(reason) }) }
    finally { setOpeningSource(null) }
  }

  async function importSubtitleFile() {
    if (subtitleBusy) return
    setSubtitleBusy(true)
    let pickedFile = false
    let importedCount: number | null = null
    let importError: string | null = null
    try {
      const paths = await DocumentPicker.pickFiles()
      if (!paths?.length) return
      pickedFile = true
      const content = await FileManager.readAsString(paths[0])
      importedCount = await saveMissAVSubtitle(props.video.videoCode, content)
      setMissAVSubtitleEnabled(props.video.videoCode, true)
      setSubtitleAvailable(true)
      setSubtitleEnabled(true)
    } catch (reason) {
      importError = reason instanceof Error ? reason.message : String(reason)
    } finally {
      if (pickedFile) {
        try { DocumentPicker.stopAcessingSecurityScopedResources() }
        catch (reason) { console.error("释放字幕文件权限失败:", reason) }
      }
      setSubtitleBusy(false)
    }
    if (importError) await Dialog.alert({ title: "字幕导入失败", message: importError })
    else if (importedCount !== null) await Dialog.alert({ title: "字幕已导入", message: `已为 ${code} 保存 ${importedCount} 条字幕；播放时将按视频时间显示。` })
  }

  function toggleSubtitle() {
    const next = !subtitleEnabled
    try {
      setMissAVSubtitleEnabled(props.video.videoCode, next)
      setSubtitleEnabled(next)
    } catch (reason) {
      void Dialog.alert({ title: "字幕设置保存失败", message: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  async function searchJavSub() {
    if (subtitleBusy) return
    setSubtitleBusy(true)
    let importedCount: number | null = null
    try {
      await Navigation.present({
        element: <JavSubSubtitleSearchPage videoCode={code} onImported={count => {
          importedCount = count
          setMissAVSubtitleEnabled(props.video.videoCode, true)
          setSubtitleAvailable(true)
          setSubtitleEnabled(true)
        }} />,
        modalPresentationStyle: "overFullScreen",
      })
    } catch (reason) {
      await Dialog.alert({ title: "字幕搜索失败", message: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setSubtitleBusy(false)
    }
    if (importedCount !== null) await Dialog.alert({ title: "字幕已导入", message: `已为 ${code} 保存 ${importedCount} 条字幕；播放时将按视频时间显示。` })
  }

  async function changeFavourite() {
    if (changingFavourite || favourite === null) return
    setChangingFavourite("local")
    try { const next = await toggleMissAVFavourite(props.video); setFavourite(next); props.onFavouriteChanged() }
    catch (reason) { await Dialog.alert({ title: "本机收藏操作失败", message: reason instanceof Error ? reason.message : String(reason) }) }
    finally { setChangingFavourite(null) }
  }

  async function changeWebsiteSaved() {
    if (changingFavourite || websiteSaved === null) return
    setChangingFavourite("website")
    try { const result = await setMissAVWebsiteSaved(props.video.detailPath, !websiteSaved); setWebsiteSaved(result.saved); props.onFavouriteChanged() }
    catch (reason) { await Dialog.alert({ title: "网站收藏操作失败", message: reason instanceof Error ? reason.message : String(reason) }) }
    finally { setChangingFavourite(null) }
  }

  const resolved = detail ?? { ...props.video, videoCode: props.video.videoCode, genres: [], sources: [] }
  const primarySource = detail?.sources[0]
  const code = props.video.videoCode.toUpperCase()
  const secondaryMetadata = [detail?.releaseDate, detail?.duration || props.video.duration, detail?.maker].filter(Boolean).join(" · ")
  function searchTag(tag: string) { setSelectedTag(tag); tagSearchPresented.setValue(true) }

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollView navigationTitle="详情" navigationBarTitleDisplayMode="inline" refreshable={load} navigationDestination={{ isPresented: tagSearchPresented, content: selectedTag ? <TagSearchPage tag={selectedTag} onFavouriteChanged={props.onFavouriteChanged} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}>
    <VStack spacing={SECTION_SPACING} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
      <MediaArtwork video={{ ...props.video, coverUrl: detail?.coverUrl || props.video.coverUrl }} height={204} radius={MEDIA_HERO_RADIUS} />

      <VStack spacing={6} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="caption" fontWeight="bold" foregroundStyle={ACCENT} frame={{ maxWidth: "infinity", alignment: "leading" }}>{code}</Text>
        <Text font="title2" fontWeight="bold" lineLimit={4} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{detail?.title || resolved.title}</Text>
        {detail?.actress ? <Text font="headline" fontWeight="semibold" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{detail.actress}</Text> : undefined}
        {secondaryMetadata ? <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{secondaryMetadata}</Text> : undefined}
      </VStack>

      <VStack spacing={10} frame={{ maxWidth: "infinity" }}>
        {primarySource ? <Button action={() => { void play(primarySource) }} disabled={Boolean(openingSource)} buttonStyle="borderedProminent" controlSize="large" tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: PRIMARY_ACTION_HEIGHT }} accessibilityLabel={openingSource === primarySource.url ? `正在打开 ${primarySource.label}` : `播放 ${primarySource.label}`}><HStack spacing={8}>{openingSource === primarySource.url ? <ProgressView progressViewStyle="circular" tint="white" /> : <Image systemName="play.fill" />}<Text font="headline" fontWeight="bold">{openingSource === primarySource.url ? "正在打开" : `播放 ${primarySource.label}`}</Text></HStack></Button> : loading ? <StateView title="正在获取播放信息" loading presentation="row" /> : undefined}
        {primarySource ? <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
          <Button action={() => { void searchJavSub() }} disabled={subtitleBusy || Boolean(openingSource)} buttonStyle="bordered" frame={{ maxWidth: "infinity", minHeight: SECONDARY_ACTION_HEIGHT }} accessibilityLabel={`搜索并导入 ${code} 字幕`}><HStack spacing={7}><Image systemName="magnifyingglass" /><Text>{subtitleBusy ? "正在搜索…" : "搜索字幕"}</Text></HStack></Button>
          <Button action={() => { void importSubtitleFile() }} disabled={subtitleBusy || Boolean(openingSource)} buttonStyle="bordered" frame={{ maxWidth: "infinity", minHeight: SECONDARY_ACTION_HEIGHT }} accessibilityLabel="从文件导入 SRT 或 WebVTT 字幕"><HStack spacing={7}><Image systemName="captions.bubble" /><Text>{subtitleBusy ? "请稍候" : subtitleAvailable ? "替换字幕" : "导入字幕"}</Text></HStack></Button>
        </HStack> : undefined}
        {subtitleAvailable ? <Button action={toggleSubtitle} buttonStyle="plain" frame={{ maxWidth: "infinity", alignment: "leading" }} accessibilityLabel={subtitleEnabled ? "关闭本作品外挂字幕" : "开启本作品外挂字幕"}><HStack spacing={6}><Image systemName={subtitleEnabled ? "captions.bubble.fill" : "captions.bubble"} foregroundStyle={subtitleEnabled ? ACCENT : "secondaryLabel"} /><Text font="caption" foregroundStyle={subtitleEnabled ? ACCENT : "secondaryLabel"}>{subtitleEnabled ? "已关联字幕，播放时按进度显示（轻点关闭）" : "已关联字幕，当前关闭（轻点开启）"}</Text></HStack></Button> : <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">先按番号搜索并下载字幕，再导入 .srt 或 .vtt 文件；播放器会按播放进度显示字幕。</Text>}
        {primarySource ? <Button title="本地字幕叠层测试" systemImage="captions.bubble" buttonStyle="bordered" disabled={Boolean(openingSource)} action={() => { void play(primarySource, true) }} /> : undefined}
        <EnvironmentValuesReader keys={["horizontalSizeClass", "dynamicTypeSize"]}>{environment => {
          const vertical = environment.horizontalSizeClass === "compact" || isAccessibilityTypeSize(environment.dynamicTypeSize)
          const local = <FavouriteButton kind="local" value={favourite} error={favouriteError} changing={changingFavourite} action={() => { void changeFavourite() }} />
          const website = <FavouriteButton kind="website" value={websiteSaved} error={websiteSavedError} changing={changingFavourite} action={() => { void changeWebsiteSaved() }} />
          return vertical ? <VStack spacing={10} frame={{ maxWidth: "infinity" }}>{local}{website}</VStack> : <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity" }}>{local}{website}</HStack>
        }}</EnvironmentValuesReader>
        {favouriteError ? <Text font="caption" foregroundStyle="systemRed" lineLimit={4} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{`本机收藏：${favouriteError}`}</Text> : undefined}
        {websiteSavedError ? <Text font="caption" foregroundStyle="systemRed" lineLimit={4} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{`网站收藏：${websiteSavedError}`}</Text> : undefined}
        {!favouriteError && !websiteSavedError ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={4} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{websiteSaved === null ? "正在读取收藏状态。" : "网站收藏将同步至当前网站账号；本机收藏仅保存在此设备。"}</Text> : undefined}
      </VStack>

      {detailError && !detail ? <StateView title="详情加载失败" description={detailError} kind="error" action={() => { void load() }} /> : undefined}
      {detailError && detail ? <StateView title="刷新失败" description="正在显示上次加载的详情。" kind="error" action={() => { void load() }} presentation="row" /> : undefined}

      <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}>
        <SectionHeading title="作品信息" />
        <Text font="body" foregroundStyle="label" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{resolved.title}</Text>
      </VStack>

      {detail && detail.genres.length ? <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}><SectionHeading title="作品标签" subtitle="选择标签，查看相关作品" /><ScrollView axes="horizontal" scrollIndicator="hidden" frame={{ maxWidth: "infinity" }}><HStack spacing={8}><Badge title={code} active systemImage="number" />{detail.genres.map(genre => <TagButton key={genre} title={genre} action={() => searchTag(genre)} />)}</HStack></ScrollView>{detail.maker ? <Text font="footnote" foregroundStyle="secondaryLabel">{`制作：${detail.maker}`}</Text> : undefined}</VStack> : undefined}

      {detail && detail.sources.length > 1 ? <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}><SectionHeading title="其他清晰度" subtitle="选择其他可用画质" /><VStack spacing={0} frame={{ maxWidth: "infinity" }}>{detail.sources.slice(1).map((source, index) => <VStack key={`${source.label}-${source.url}`} spacing={0} frame={{ maxWidth: "infinity" }}>{index ? <Divider /> : undefined}<SourceRow source={source} openingSource={openingSource} action={() => { void play(source) }} /></VStack>)}</VStack></VStack> : !loading && detail && !detail.sources.length ? <StateView title="暂无可用播放源" description="请下拉刷新后重试。" kind="empty" systemImage="play.slash" action={() => { void load() }} actionTitle="重新加载" /> : undefined}
    </VStack>
  </ScrollView></ZStack>
}

function JavSubSubtitleSearchPage(props: { videoCode: string; onImported: (count: number) => void }) {
  const dismiss = Navigation.useDismiss()
  const [query, setQuery] = useState(props.videoCode)
  const [title, setTitle] = useState("")
  const [totalCount, setTotalCount] = useState(0)
  const [files, setFiles] = useState<Array<JavSubSubtitleFile | SubtitleCatSubtitleFile>>([])
  const [cookieHeader, setCookieHeader] = useState("")
  const [sourceStatus, setSourceStatus] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const controllerRef = useRef<WebViewController | null>(null)

  async function search(value = query) {
    const code = value.trim()
    if (!code || loading || downloadingId) return
    controllerRef.current?.dispose()
    const controller = new WebViewController()
    controllerRef.current = controller
    setQuery(code)
    setLoading(true)
    setError(null)
    setFiles([])
    setCookieHeader("")
    setSourceStatus([])
    setTitle("")
    setTotalCount(0)
    setHasSearched(false)
    try {
      const mergedFiles: Array<JavSubSubtitleFile | SubtitleCatSubtitleFile> = []
      const statuses: string[] = []
      let totalResultCount = 0
      let successfulSources = 0

      try {
        const result = await searchJavSubSubtitleFiles(controller, code)
        if (controllerRef.current !== controller) return
        mergedFiles.push(...result.files)
        setCookieHeader(result.cookieHeader)
        totalResultCount += result.totalCount
        statuses.push(`JavSub.ai：${result.files.length} 个文件`)
        successfulSources += 1
      } catch (reason) {
        statuses.push(`失败 · JavSub.ai：${reason instanceof Error ? reason.message : String(reason)}`)
      }

      if (controllerRef.current !== controller) return
      try {
        const result = await searchSubtitleCatFiles(controller, code)
        if (controllerRef.current !== controller) return
        mergedFiles.push(...result.files)
        totalResultCount += result.files.length
        statuses.push(`Subtitle Cat：${result.files.length} 个文件，${result.searchResultCount} 个匹配条目${result.failedDetailCount ? `，${result.failedDetailCount} 个详情页未能读取` : ""}`)
        successfulSources += 1
      } catch (reason) {
        statuses.push(`失败 · Subtitle Cat：${reason instanceof Error ? reason.message : String(reason)}`)
      }

      if (controllerRef.current !== controller) return
      mergedFiles.sort((left, right) => subtitleLanguagePriority(left.language) - subtitleLanguagePriority(right.language))
      setTitle(code)
      setTotalCount(totalResultCount)
      setFiles(mergedFiles)
      setSourceStatus(statuses)
      setHasSearched(true)
      if (!successfulSources) setError("两个字幕来源当前都无法访问；请稍后重试。")
    } catch (reason) {
      if (controllerRef.current === controller) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (controllerRef.current === controller) {
        controller.dispose()
        controllerRef.current = null
        setLoading(false)
      }
    }
  }

  async function download(file: JavSubSubtitleFile | SubtitleCatSubtitleFile) {
    if (!file.isFree || file.isDemo || downloadingId) return
    const fileKey = `${file.source}:${file.id}`
    setDownloadingId(fileKey)
    setError(null)
    try {
      const content = file.source === "JavSub.ai"
        ? await downloadJavSubSubtitleFile(file, cookieHeader)
        : await downloadSubtitleCatFile(file)
      const count = await saveMissAVSubtitle(props.videoCode, content)
      props.onImported(count)
      dismiss()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setDownloadingId(null) }
  }

  useEffect(() => {
    void search(props.videoCode)
    return () => {
      controllerRef.current?.dispose()
      controllerRef.current = null
    }
  }, [])

  const hasImportable = files.some(file => file.isFree && !file.isDemo)
  return <NavigationStack><ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="systemBackground">
    <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <HStack spacing={10} padding={{ horizontal: PAGE_PADDING, vertical: 8 }} frame={{ maxWidth: "infinity", minHeight: 52 }}>
        <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font="headline" fontWeight="bold">按番号搜索字幕</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">简体中文、繁体中文优先</Text>
        </VStack>
        <Button action={() => { controllerRef.current?.dispose(); controllerRef.current = null; dismiss() }} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="关闭字幕搜索"><Image systemName="xmark" foregroundStyle="secondaryLabel" /></Button>
      </HStack>
      <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <VStack spacing={14} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
          <HStack spacing={8} padding={{ horizontal: 12 }} frame={{ maxWidth: "infinity", minHeight: 50 }} background="tertiarySystemFill" clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}>
            <TextField title="番号" prompt="例如 SSIS-655" value={query} onChanged={setQuery} onSubmit={() => { void search() }} autocorrectionDisabled frame={{ maxWidth: "infinity" }} />
            <Button action={() => { void search() }} disabled={loading || Boolean(downloadingId) || !query.trim()} buttonStyle="borderedProminent" tint={ACCENT} accessibilityLabel="搜索字幕">
              {loading ? <ProgressView progressViewStyle="circular" tint="white" /> : <Image systemName="magnifyingglass" />}
            </Button>
          </HStack>
          <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">聚合 JavSub.ai 与 Subtitle Cat 的公开字幕结果。只导入可直接下载的完整免费 SRT；预览条目不能导入。</Text>
          {error ? <VStack spacing={8} alignment="leading" padding={12} frame={{ maxWidth: "infinity", alignment: "leading" }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}>
            <Text font="subheadline" foregroundStyle="systemRed" multilineTextAlignment="leading">{error}</Text>
            <Button title="重试搜索" systemImage="arrow.clockwise" disabled={loading} action={() => { void search() }} />
          </VStack> : undefined}
          {loading && !hasSearched ? <HStack spacing={10} frame={{ maxWidth: "infinity", minHeight: 100 }}><ProgressView tint={ACCENT} /><Text font="subheadline" foregroundStyle="secondaryLabel">正在按番号搜索…</Text></HStack> : undefined}
          {hasSearched ? <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity" }}>
            <Text font="headline" fontWeight="semibold">{title || `番号 ${query}`}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{`共找到 ${files.length} 个可下载字幕文件；简体中文和繁体中文置顶。${totalCount > files.length ? ` 来源共报告 ${totalCount} 个字幕条目。` : ""}`}</Text>
            {sourceStatus.map((status, index) => <Text key={`subtitle-source-${index}`} font="caption" foregroundStyle={status.startsWith("失败") ? "systemRed" : "secondaryLabel"} multilineTextAlignment="leading">{status}</Text>)}
            {files.length ? <LazyVStack spacing={0} frame={{ maxWidth: "infinity" }}>{files.map((file, index) => <VStack key={`${file.source}-${file.id}`} spacing={0} frame={{ maxWidth: "infinity" }}>
              {index ? <Divider /> : undefined}
              <VStack spacing={7} alignment="leading" padding={{ vertical: 12 }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
                  <Text font="subheadline" fontWeight="semibold" frame={{ maxWidth: "infinity", alignment: "leading" }}>{file.language}</Text>
                  <Text font="caption" foregroundStyle="secondaryLabel">{file.source}</Text>
                  <Text font="caption" foregroundStyle={file.isFree ? "systemGreen" : "secondaryLabel"}>{file.isFree ? "完整 · 免费" : "预览"}</Text>
                </HStack>
                {file.details ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={4} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{file.details}</Text> : undefined}
                <Button action={() => { void download(file) }} disabled={!file.isFree || file.isDemo || Boolean(downloadingId)} buttonStyle={file.isFree ? "borderedProminent" : "bordered"} tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: 42 }} accessibilityLabel={file.isFree ? `下载并导入${file.source}的${file.language}字幕` : `${file.language}字幕仅供预览，无法导入`}>
                  <HStack spacing={7}>{downloadingId === `${file.source}:${file.id}` ? <ProgressView progressViewStyle="circular" tint="white" /> : <Image systemName={file.isFree ? "square.and.arrow.down" : "eye"} />}
                    <Text>{downloadingId === `${file.source}:${file.id}` ? "正在下载并导入…" : file.isFree ? "下载并导入" : "仅预览，不能导入"}</Text>
                  </HStack>
                </Button>
              </VStack>
            </VStack>)}</LazyVStack> : <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">{totalCount ? "网站有字幕条目，但没有识别到可列出的下载文件。" : "没有找到这个番号的字幕文件。可以修改番号后重新搜索。"}</Text>}
            {!hasImportable && files.length ? <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">当前结果没有可直接导入的免费完整字幕；预览文件不包含完整对白，付费文件不会被绕过。</Text> : undefined}
          </VStack> : undefined}
          {!loading && !hasSearched && !error ? <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">将自动搜索当前作品番号；也可以编辑番号后搜索其他字幕。</Text> : undefined}
        </VStack>
      </ScrollView>
    </VStack>
  </ZStack></NavigationStack>
}

function subtitleLanguagePriority(language: string): number {
  if (language === "简体中文") return 0
  if (language === "繁体中文") return 1
  return 2
}

function isAccessibilityTypeSize(size: DynamicTypeSize) {
  return size.startsWith("accessibility")
}

function FavouriteButton(props: { kind: "local" | "website"; value: boolean | null; error: string | null; changing: "local" | "website" | null; action: () => void }) {
  const local = props.kind === "local"
  const noun = local ? "本机收藏" : "网站收藏"
  const icon = local ? (props.value ? "heart.fill" : "heart") : (props.value ? "bookmark.fill" : "bookmark")
  const title = props.error ? `${noun}不可用` : props.value === null ? `正在读取${noun}` : props.value ? `已加入${noun}` : `加入${noun}`
  const accessibility = props.error ? `${noun}不可用` : props.value === null ? `正在读取${noun}状态` : props.value ? `已加入${noun}，轻点取消` : `未加入${noun}，轻点加入`
  return <Button action={props.action} disabled={Boolean(props.changing) || props.value === null || Boolean(props.error)} buttonStyle="bordered" tint={props.value ? "systemRed" : ACCENT} frame={{ maxWidth: "infinity", minHeight: SECONDARY_ACTION_HEIGHT }} accessibilityLabel={accessibility}>
    <HStack spacing={7}>{props.changing === props.kind ? <ProgressView progressViewStyle="circular" tint={ACCENT} /> : <Image systemName={icon} />}<Text font="subheadline" fontWeight="semibold" lineLimit={2} multilineTextAlignment="center">{title}</Text></HStack>
  </Button>
}

function TagButton(props: { title: string; action: () => void }) {
  return <Button action={props.action} buttonStyle="plain" frame={{ minHeight: 44 }} contentShape="rect" accessibilityLabel={`搜索标签 ${props.title}`}><HStack spacing={5} padding={{ horizontal: 10, vertical: 7 }} background="tertiarySystemFill" clipShape={{ type: "rect", cornerRadius: 9, style: "continuous" }}><Image systemName="magnifyingglass" font="caption2" foregroundStyle={ACCENT} /><Text font="caption" fontWeight="semibold" lineLimit={1}>{props.title}</Text></HStack></Button>
}

function TagSearchPage(props: { tag: string; onFavouriteChanged: () => void; onHistoryChanged: () => void }) {
  const [items, setItems] = useState<MissAVVideoItem[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resultsRevision, setResultsRevision] = useState(0)
  const [selected, setSelected] = useState<MissAVVideoItem | null>(null)
  const detailPresented = useObservable(false)
  const generation = useRef(0)
  const scrollProxy = useRef<ScrollViewProxy | null>(null)
  async function load(nextPage = 1) {
    const current = ++generation.current
    setLoading(true); setError(null)
    try { const result = await missavClient.searchVideoPage({ query: props.tag, page: nextPage, sort: "released_at", filter: "" }); if (current !== generation.current) return; setItems(result.items); setPage(result.page); setHasNext(result.hasNext); setResultsRevision(value => value + 1) }
    catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === generation.current) setLoading(false) }
  }
  useEffect(() => { void load(1) }, [props.tag])
  useEffect(() => { if (resultsRevision) scrollProxy.current?.scrollTo("tag-results-top", "top") }, [resultsRevision])
  function open(video: MissAVVideoItem) { setSelected(video); detailPresented.setValue(true) }
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollViewReader>{proxy => { scrollProxy.current = proxy; return <ScrollView navigationTitle={props.tag} navigationBarTitleDisplayMode="inline" refreshable={() => load(page)} navigationDestination={{ isPresented: detailPresented, content: selected ? <DetailPage video={selected} onFavouriteChanged={props.onFavouriteChanged} onHistoryChanged={props.onHistoryChanged} /> : <VStack /> }}><VStack key="tag-results-top" spacing={18} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}><VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><HStack spacing={7}><Image systemName="tag.fill" foregroundStyle={ACCENT} /><Text font="title2" fontWeight="bold">{props.tag}</Text></HStack><Text font="footnote" foregroundStyle="secondaryLabel">{`相关作品 · 第 ${page} 页 · ${items.length} 个结果`}</Text></VStack>{loading && !items.length ? <StateView title="正在搜索标签" loading presentation="section" /> : error && !items.length ? <StateView title="标签搜索失败" description={error} kind="error" action={() => { void load(page) }} /> : !items.length ? <StateView title="暂无相关作品" description="未找到带有此标签的作品。" systemImage="tag.slash" /> : <VideoRowList items={items} status={() => `标签 · ${props.tag}`} statusSystemImage="tag" onOpen={open} />}{error && items.length ? <StateView title="刷新失败" description="正在显示上次成功的结果。" kind="error" action={() => { void load(page) }} presentation="row" /> : undefined}{items.length ? <HStack spacing={10} frame={{ maxWidth: "infinity" }}><Button title="上一页" systemImage="chevron.left" disabled={page <= 1 || loading} action={() => { void load(page - 1) }} /><Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">{`第 ${page} 页`}</Text><Button title="下一页" systemImage="chevron.right" tint={ACCENT} disabled={!hasNext || loading} action={() => { void load(page + 1) }} /></HStack> : undefined}</VStack></ScrollView>}}</ScrollViewReader></ZStack>
}

function SourceRow(props: { source: MissAVVideoSource; openingSource: string | null; action: () => void }) {
  const opening = props.openingSource === props.source.url
  return <Button action={props.action} disabled={Boolean(props.openingSource)} buttonStyle="plain" frame={{ maxWidth: "infinity" }} contentShape="rect" accessibilityLabel={opening ? `正在打开 ${props.source.label}` : props.openingSource ? `${props.source.label}，正在打开其他清晰度` : `播放 ${props.source.label}`}><HStack spacing={12} padding={{ vertical: 10 }} frame={{ maxWidth: "infinity", minHeight: 58 }}>{opening ? <ProgressView progressViewStyle="circular" tint={ACCENT} frame={{ width: 30 }} /> : <Image systemName="play.circle" font="title2" foregroundStyle={ACCENT} frame={{ width: 30 }} />}<VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">{opening ? "正在打开" : props.source.label}</Text><Text font="caption" foregroundStyle="secondaryLabel">使用系统播放器</Text></VStack><Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" /></HStack></Button>
}

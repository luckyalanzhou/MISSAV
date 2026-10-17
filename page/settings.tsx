import { Button, Dialog, HStack, Image, List, Pasteboard, Picker, ProgressView, Section, Text, VStack, useState } from "scripting"
import { getMissAVAccessDiagnostics, type MissAVAccessDiagnostic } from "../access-diagnostics"
import { openMissAVSiteVerification } from "../site-verification"
import { ACCENT } from "../design"
import { getMissAVBaseURL, getMissAVLandingURL, MISSAV_DOMAIN_OPTIONS, setMissAVBaseURL, type MissAVBaseURL } from "../domain"

type VerificationState = "checking" | "accessible" | "incomplete" | "blocked" | "unavailable" | "load-error"

export function SettingsPage(props: { onDomainChanged: () => void; onAccessVerified?: () => void }) {
  const [domain, setDomain] = useState<MissAVBaseURL>(() => getMissAVBaseURL())
  const initialVerification = latestVerification(new URL(domain).hostname)
  const [accessBusy, setAccessBusy] = useState(false)
  const [accessMessage, setAccessMessage] = useState<string | null>(null)
  const [verificationState, setVerificationState] = useState<VerificationState>(initialVerification?.state === "accessible" || initialVerification?.state === "incomplete" || initialVerification?.state === "blocked" || initialVerification?.state === "unavailable" || initialVerification?.state === "load-error" ? initialVerification.state : "unavailable")
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(initialVerification?.at ?? null)
  const [lastCheckMs, setLastCheckMs] = useState<number | null>(initialVerification?.elapsedMs ?? null)
  const operationBusy = accessBusy

  function changeDomain(value: string) {
    if (operationBusy) return
    const next = value as MissAVBaseURL
    if (next === domain || !MISSAV_DOMAIN_OPTIONS.some(option => option.value === next)) return
    setMissAVBaseURL(next)
    setDomain(next)
    setAccessMessage(null)
    setVerificationState("unavailable")
    setLastCheckedAt(null)
    setLastCheckMs(null)
    props.onDomainChanged()
  }

  async function verifySiteAccess() {
    if (operationBusy) return
    setAccessBusy(true)
    setVerificationState("checking")
    setAccessMessage(null)
    const started = Date.now()
    try {
      const result = await openMissAVSiteVerification()
      setVerificationState(result.status)
      setLastCheckedAt(Date.now())
      setLastCheckMs(Date.now() - started)
      setAccessMessage(result.status === "accessible"
        ? result.challengeCompleted
          ? `Cloudflare 验证完成；测试栏目“${result.probe.title}”已可访问，正在刷新首页和浏览页。`
          : `测试栏目“${result.probe.title}”已可访问，无需完成 Cloudflare 验证。正在刷新首页和浏览页。`
        : result.status === "blocked"
          ? `测试栏目“${result.probe.title}”被站点拒绝访问，不等同于待完成的验证。请检查网络或切换域名后重试。`
          : result.status === "incomplete"
            ? `测试栏目“${result.probe.title}”仍显示 Cloudflare 验证。请在弹出的页面完成验证，页面确认载入作品后会自动关闭。`
            : `测试栏目“${result.probe.title}”未返回可识别的作品列表。请检查网络或切换域名后重试。`)
      if (result.status === "accessible") props.onAccessVerified?.()
    } catch (reason) {
      setVerificationState("load-error")
      setLastCheckedAt(Date.now())
      setLastCheckMs(Date.now() - started)
      setAccessMessage(reason instanceof Error ? reason.message : "访问线路验证窗口当前无法打开。")
    } finally { setAccessBusy(false) }
  }

  async function copyDiagnostics() {
    const entries = getMissAVAccessDiagnostics().slice(-20)
    if (!entries.length) {
      await Dialog.alert({ title: "暂无线路诊断", message: "先点击“验证访问线路”检查当前站点，再复制诊断信息。" })
      return
    }
    const report = ["MISSAV 线路诊断（最近 20 条以内）", ...entries.map(formatDiagnostic)].join("\n")
    try {
      // Diagnostics are plain text; use the dedicated text API for reliable
      // clipboard writes across Scripting runtime versions.
      await Pasteboard.setString(report)
      await Dialog.alert({ title: "诊断已复制", message: "已复制脱敏的线路状态、栏目和耗时；不包含 Cookie、账号信息或页面内容。" })
    } catch (reason) {
      await Dialog.alert({ title: "复制诊断失败", message: reason instanceof Error ? reason.message : "请稍后重试。" })
    }
  }

  const verificationLabel = verificationState === "checking" ? "正在检查当前线路…"
    : verificationState === "accessible" ? "测试栏目可访问"
      : verificationState === "incomplete" ? "仍需要完成 Cloudflare 验证"
        : verificationState === "blocked" ? "站点拒绝了本次请求"
          : verificationState === "load-error" ? "线路检查遇到错误"
            : lastCheckedAt ? "未能确认测试栏目可访问" : "尚未检查当前线路"
  const verificationIcon = verificationState === "checking" ? undefined
    : verificationState === "accessible" ? "checkmark.circle.fill"
      : lastCheckedAt ? "exclamationmark.triangle.fill" : "questionmark.circle"
  const verificationColor = verificationState === "accessible" ? ACCENT : "secondaryLabel"

  return <List listStyle="insetGroup" navigationTitle="设置" navigationBarTitleDisplayMode="large">
    <Section header={<Text>访问站点</Text>} footer={<Text>线路检查只确认本次测试栏目是否可访问，不代表所有栏目都已通过验证。其他栏目提示验证时，可先完成检查；仍无法访问可切换域名，设置将应用于浏览、搜索、详情和播放。</Text>}>
      <Picker title="站点域名" value={domain} onChanged={changeDomain} disabled={operationBusy}>
        {MISSAV_DOMAIN_OPTIONS.map(option => <Text key={option.value} tag={option.value}>{option.title}</Text>)}
      </Picker>
      <Button title="在 Safari 中打开" systemImage="safari" tint={ACCENT} disabled={operationBusy} action={() => { void Safari.openURL(getMissAVLandingURL(domain)) }} />
      <Button title={accessBusy ? "正在验证访问线路" : "验证访问线路"} systemImage="checkmark.shield" disabled={operationBusy} tint={ACCENT} action={() => { void verifySiteAccess() }} />
      <VStack spacing={6} alignment="leading" padding={{ vertical: 7 }}>
        <HStack spacing={8}>
          {accessBusy ? <ProgressView progressViewStyle="circular" /> : verificationIcon ? <Image systemName={verificationIcon} foregroundStyle={verificationColor} /> : undefined}
          <Text font="subheadline" fontWeight="semibold" foregroundStyle={verificationColor}>{verificationLabel}</Text>
        </HStack>
        {lastCheckedAt ? <Text font="footnote" foregroundStyle="secondaryLabel">{`本次运行最近检查：${new Date(lastCheckedAt).toLocaleString()}${lastCheckMs !== null ? ` · ${(lastCheckMs / 1000).toFixed(1)} 秒` : ""}`}</Text> : undefined}
        {accessMessage ? <Text font="footnote" foregroundStyle="secondaryLabel">{accessMessage}</Text> : undefined}
      </VStack>
      <Button title="复制线路诊断" systemImage="doc.on.doc" action={() => { void copyDiagnostics() }} />
    </Section>

    <Section header={<Text>本机数据</Text>} footer={<Text>浏览记录、播放记录和下载字幕仅保存在本机。清除浏览或播放记录请前往资料库；字幕文件夹目前由脚本自动管理。</Text>}>
      <InfoRow icon="iphone" title="浏览与播放记录" detail="仅保存在本机，不会上传" />
      <InfoRow icon="captions.bubble" title="下载字幕" detail="本机文稿目录 / MISSAV Subtitles；更新脚本后保留" />
      <InfoRow icon="arrow.triangle.2.circlepath" title="播放信息" detail="每次打开播放器前获取当前可用画质" />
    </Section>

    <Section header={<Text>关于</Text>}>
      <HStack spacing={12} frame={{ minHeight: 54 }}><Image systemName="play.rectangle.fill" foregroundStyle={ACCENT} frame={{ width: 28 }} /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">MISSAV</Text><Text font="subheadline" foregroundStyle="secondaryLabel">版本 1.0.0</Text></VStack></HStack>
    </Section>
  </List>
}

function latestVerification(host: string): MissAVAccessDiagnostic | undefined {
  return [...getMissAVAccessDiagnostics()].reverse().find(entry => entry.event === "verification" && entry.host === host && entry.state !== "started")
}

function formatDiagnostic(entry: MissAVAccessDiagnostic): string {
  const time = new Date(entry.at).toLocaleString()
  const duration = entry.elapsedMs !== undefined ? ` · ${(entry.elapsedMs / 1000).toFixed(1)} 秒` : ""
  const extra = [entry.phase, entry.detailStage, entry.cookieState ? `Cookie:${entry.cookieState}` : "", entry.challengeObserved ? "观察到验证页" : ""].filter(Boolean).join(" · ")
  return `${time} · ${entry.event} · ${entry.host}/${entry.route} · ${entry.state}${duration}${extra ? ` · ${extra}` : ""}`
}

function InfoRow(props: { icon: string; title: string; detail: string }) {
  return <HStack spacing={12} frame={{ minHeight: 54 }}>
    <Image systemName={props.icon} foregroundStyle="secondaryLabel" frame={{ width: 28 }} />
    <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="body" fontWeight="semibold">{props.title}</Text>
      <Text font="subheadline" foregroundStyle="secondaryLabel">{props.detail}</Text>
    </VStack>
  </HStack>
}

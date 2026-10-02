# Cloudflare 访问识别与验证

## 第一阶段实现

- 正常作品页面引用 `/cdn-cgi/challenge-platform/` 或 Turnstile 脚本，不再仅凭资源地址判定为验证拦截。结合实际挑战标题、拦截容器、验证提示和正文内容判断。
- 明确区分正常页面、验证挑战和 Cloudflare 拒绝访问页面。拒绝访问不会打开人机验证窗口或宣称验证成功。
- 自动检测页在同一个 WebView 内最多观察 10 次，间隔 300 毫秒；明确的人工验证提示直接交给设置页处理，不反复导航。整个加载仍受原有超时上限控制。
- 每次一起读取 `window.location.href` 与 HTML。要求同源、同语言、同栏目，保留页码、排序、筛选条件；允许站点更新 `dm数字` 路由前缀以及附加挑战参数。异域、错语言、错栏目或错筛选的页面不能验证成功。
- JavaScript 读取有单次超时保护；加载超时后，迟到的回调不能发起新的读取。
- 首页、浏览、详情等内容请求不会自行弹出验证窗口；互动验证仍只在设置页。
- 没有更改持久化 Cookie 保存、验证后的多栏目探测、缓存清空或刷新机制；这些属于后续阶段。

## 第二阶段实现

- 线路验证优先检查最近失败的完整请求，保留栏目、分类、排序、筛选和页码，而不是只检查首页。
- 验证与普通内容请求共用调度闸门。开始验证时取消旧任务、释放其 WebView；新请求等待验证结束。无论验证成功、失败或取消，闸门都在 finally 中释放。
- 同一列表请求的多个页面共用任务；其中一个页面取消不会中断其他页面仍需要的任务。最后一个使用者取消时释放控制器，迟到回调不能读取内容或写缓存。
- 只有实际 URL 匹配且已解析出作品或目录的验证结果才能进入缓存。验证结束时延长这些缓存的短期有效期，首页与浏览复用结果，不立即重新请求已检查栏目。
- 验证刷新不再重建整个主页面，保留浏览页当前栏目与筛选；切换域名仍按原逻辑重新载入。设置中的成功提示仅表示已检查栏目可访问，不保证其他 URL 永远无需验证。
- 取消只管理本脚本的工作与控制器生命周期；Scripting 未公开 WebView stopLoading 接口，因此不声称能直接停止 WebKit 底层的每个网络连接。

`tests/request-coordination-regression.mjs` 检查共享请求所有权、取消与迟到回调、验证排队及异常释放、完整 URL 缓存核对、失败栏目优先和刷新保留当前选择。

## 第三阶段实现

- Cookie 恢复按实际请求 URL 检查域名、路径边界和有效期。优先使用默认持久化 WebView 中已有的 `cf_clearance`，不以旧 Keychain 备份覆盖新会话。
- 同域名的恢复操作排队，每个操作重新检查共享 Cookie 容器。写入检查 `setCookie` 返回值，并用 `getCookies(url)` 读回确认；只有实际适用的 clearance 才视为会话可用。辅助 Cookie、备份条数、返回 false、读回失败都不能冒充恢复成功。
- 过期、损坏、错误域名或不含 clearance 的备份，仅清理对应的 Cloudflare Keychain 备份键；不删除 WebView 中的 Cookie，也不清理账号登录数据。暂时写入失败或网站重新挑战，不足以证明备份失效，不据此删除会话。
- Cookie 原生桥接每次调用最多等待 2 秒。取消或超时后不会主动重试未知结果的写入；无法撤销已经提交给 WebKit 的原生调用，但迟到返回不能触发后续读写。
- 控制台异常记录使用 `MISSAV access diagnostic` 标记；只记录固定状态、域名、脱敏路由、计数、耗时和有效期秒数，不记录 Cookie 值、账号/密码、搜索词、URL 查询参数、页面 HTML 或原始异常。
- 诊断只保留本次运行最近 60 条的内存记录，不新增磁盘诊断文件。`getMissAVAccessDiagnostics()` 返回副本，`clearMissAVAccessDiagnostics()` 清空内存。正常请求不刷控制台，异常时输出可用于排查的脱敏摘要。
- `cookieState=live/restored` 且 `state=challenge` 只能证明当前请求仍被挑战，不能直接证明 IP 变化或网络切换。脚本没有额外查询公网 IP，也不能决定 Cloudflare 的策略。

`tests/cookie-restoration-regression.mjs` 检查返回 false/抛错、读回缺失/失败、仅辅助 Cookie、备份清理隔离、域名/路径/过期匹配、并发恢复、取消/超时以及日志脱敏与容量边界。

## 回归验证

`tests/cloudflare-page-state-regression.mjs` 使用真实生产解析/加载模块和模拟的原生桥接，检查后台脚本误判、真实挑战与拒绝访问、短暂检测自动结束、读取次数上限、实际 URL 核对和超时后的迟到回调。

`tests/site-page-loading-regression.mjs` 另外检查正常 JSD 页面能进入作品列表且无需弹窗、拒绝访问的错误分类、弹窗关闭后异域页面不能验证成功，以及原有中文路由、Cookie、账号与分类加载行为。

以上是本机回归检查，不代表 iPhone 上的实际 Cloudflare 策略或 WebKit 回调行为已经验证。

## iPhone 验收

1. 在网络与域名不变的情况下打开首页、浏览与详情；能正常显示内容时不应仅因后台检测脚本提示验证。
2. 短暂自动检测后进入作品页时，不需要重复点击验证或重试。
3. 真正出现人工验证时，内容页提示前往设置；设置弹窗确认目标栏目已载入作品后自动关闭。
4. 跳往别的语言、栏目或域名不能被当作目标栏目验证成功。
5. 网站拒绝访问与网络/页面内容加载失败，应显示各自的错误，不混同为待完成人机验证。
6. 浏览页选择分类、排序或页码后完成设置验证，返回时应保持原选择；验证已载入的相同列表在短期缓存内不应立即再次请求。
7. 快速切换栏目，旧请求不能覆盖新结果；打开验证时不应有旧页面请求继续抢写缓存。关闭或失败后普通请求仍可继续。
8. 保持网络不变重新运行脚本，有有效共享 clearance 时不应回写旧备份；遇到问题查看 Scripting 控制台中的 `MISSAV access diagnostic`，确认 Cookie 恢复状态与页面拦截状态分别记录。真实策略是否减少挑战次数仍需设备观察。

官方资料：[Cloudflare JavaScript Detections](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/)、[Challenge response header](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/)、[Scripting WebViewController](https://scriptingapp.github.io/zh/guide/Device%20Capabilities/WebViewController)。`cf-mitigated: challenge` 是 HTTP 响应头；当前 WebViewController 文档未提供主页面响应头读取接口，因此此处并未伪造或把 HTML meta 当作该信号。

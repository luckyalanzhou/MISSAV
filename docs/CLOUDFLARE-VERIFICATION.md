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

官方资料：[Cloudflare JavaScript Detections](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/)、[Challenge response header](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/)、[Scripting WebViewController](https://scriptingapp.github.io/zh/guide/Device%20Capabilities/WebViewController)。`cf-mitigated: challenge` 是 HTTP 响应头；当前 WebViewController 文档未提供主页面响应头读取接口，因此此处并未伪造或把 HTML meta 当作该信号。

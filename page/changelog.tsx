import { HStack, Image, List, Section, Text, VStack } from "scripting"
import { ACCENT } from "../design"

type Release = {
  version: string
  summary: string
  current?: boolean
  sections: Array<{ title: string; items: string[] }>
}

const releases: Release[] = [
  {
    version: "4.1.0",
    summary: "新增内置账号密码登录与访问线路验证",
    current: true,
    sections: [
      {
        title: "账号登录",
        items: [
          "设置页新增 MISSAV 注册邮箱与密码登录，可直接连接当前访问线路的站点账号。",
          "密码只用于本次登录请求，不会保存；登录成功后仅将站点会话保存在系统钥匙串中。",
          "登录成功后可在资料库读取网站收藏，并继续使用详情页的网站收藏操作。",
        ],
      },
      {
        title: "访问线路验证",
        items: [
          "新增验证访问线路入口，可先在网页中完成 Cloudflare 验证，再返回设置页登录账号。",
          "访问线路验证与账号登录分开处理，无需在验证网页中登录账号。",
          "保留账号状态验证、登录失效提示和退出站点账号操作。",
        ],
      },
      {
        title: "会话与资料库",
        items: [
          "站点会话按当前访问域名保存，不同访问线路分别管理账号状态。",
          "登录或退出后会刷新网站收藏状态，避免继续显示旧账号内容。",
          "网站收藏与本机收藏、播放记录和浏览记录继续分开管理。",
        ],
      },
    ],
  },
  {
    version: "4.0.0",
    summary: "内容界面、观看路径与资料管理体验全面升级",
    sections: [
      {
        title: "首页与内容浏览",
        items: [
          "首页改为继续观看优先的内容结构，并统一今日热门与最近更新货架。",
          "搜索结果支持列表与大封面两种显示方式，并可保留用户的显示偏好。",
          "浏览页仅在第一页显示精选主视觉，后续页面保持一致的内容网格。",
          "Home Tab 优先展示继续观看，并提供浏览、搜索、资料库和推荐入口。",
        ],
      },
      {
        title: "详情与资料库",
        items: [
          "详情页强化单一播放主操作，并以明确文案区分本机收藏与网站收藏状态。",
          "资料库改为收藏与历史两层结构，分别管理收藏来源和历史类型。",
          "统一媒体封面、标题、元数据、状态图标和尾部操作的对齐规则。",
        ],
      },
      {
        title: "显示与辅助功能",
        items: [
          "优化页面层级、内容间距、控件样式和浅色与深色模式下的可读性。",
          "完善长标题、窄屏、系统大文字、VoiceOver 和非颜色状态表达。",
          "统一数据归属说明、加载状态、空状态和错误恢复路径。",
        ],
      },
    ],
  },
  {
    version: "3.4.0",
    summary: "首页一致性、播放源可靠性与运行性能升级",
    sections: [
      {
        title: "首页与界面",
        items: [
          "最近播放改为与热门推荐、最近更新一致的横向内容货架，统一标题、副标题和内容轴线。",
          "首页远程推荐使用紧凑加载反馈，已有本机内容不再被大面积加载占位推离首屏。",
          "详情页收藏操作改为自适应全宽排列，改善窄屏和系统大文字下的可读性与点击空间。",
          "Scripting Home Tab 隐藏顶部滚动边缘效果，减少滚动和回弹时的横向模糊条。",
        ],
      },
      {
        title: "播放源可靠性",
        items: [
          "排除推荐预览、Magnet 下载地址、模板变量和无效媒体地址。",
          "只保留路径真实以 M3U8 或 MP4 结尾的播放资源，并按真实资源路径去重。",
          "每个固定清晰度与自动清晰度只保留一个入口，统一显示为自动清晰度。",
          "刷新播放地址时优先匹配同一资源路径；候选有歧义或媒体类型不同时不再任意切换。",
        ],
      },
      {
        title: "性能与稳定性",
        items: [
          "消除首页首次出现的重复本机资料库查询，并在数据库层限制首页收藏读取数量。",
          "网站收藏改为进入对应资料库分类后按需加载，避免本机记录变化触发无关 WebView。",
          "未登录网站账号时不再为详情页启动收藏状态 WebView。",
          "Home Tab 增加请求代次保护和热门内容短期缓存，避免重叠请求与旧结果覆盖。",
          "优化页面卡片解析，减少同一作品连续链接的重复扫描。",
        ],
      },
    ],
  },
  {
    version: "3.3.0",
    summary: "全局产品精修与发布质量升级",
    sections: [
      {
        title: "界面与浏览",
        items: [
          "完成首页、发现、搜索、资料库、详情、设置和播放器入口的全局产品审计。",
          "移除全部媒体封面上的播放小图标，提升封面与标题可读性。",
          "发现、搜索和标签结果在成功换页后自动回到顶部。",
          "优化长标题、长错误信息、窄屏和系统大文字下的内容布局。",
        ],
      },
      {
        title: "搜索与可靠性",
        items: [
          "修复新搜索标题与旧结果短暂混杂的问题。",
          "修复空搜索后旧请求仍可能回写结果的竞态。",
          "上一页、下一页、分类、筛选和排序切换统一更新浏览位置。",
        ],
      },
      {
        title: "详情与收藏",
        items: [
          "重新整理作品信息、播放、本机收藏和网站收藏的操作层级。",
          "收藏状态读取失败时不再错误显示为未收藏。",
          "完善收藏读取中、不可用、已收藏和播放中状态的辅助功能描述。",
          "详情页保留完整作品标题、标签搜索和其他清晰度入口。",
        ],
      },
      {
        title: "账号与播放",
        items: [
          "设置页登录和重新验证增加明确的失败反馈。",
          "保留单层系统播放器、画中画、旋转和播放前更新播放源。",
          "竖屏播放时保持顶部系统状态栏显示。",
          "网站账号会话继续按域名隔离保存在 Keychain，不保存账号密码。",
        ],
      },
    ],
  },
  {
    version: "3.2.0",
    summary: "网站账号与真实收藏同步",
    sections: [
      {
        title: "网站账号",
        items: [
          "新增脚本内网站登录窗口，账号密码不会保存在脚本内。",
          "使用 Keychain 按站点域名保存完整 Cookie 会话。",
          "支持账号重新验证、登录失效提示和本机退出。",
        ],
      },
      {
        title: "网站收藏",
        items: [
          "资料库新增网站收藏，与本机收藏、播放和浏览记录分开管理。",
          "详情页支持真实网站收藏加入与取消，并由服务器复核最终状态。",
          "修正已登录页面、空用户字段和网站验证状态的识别问题。",
        ],
      },
    ],
  },
  {
    version: "3.0.0",
    summary: "首页、发现、搜索与资料库全面升级",
    sections: [
      {
        title: "主要更新",
        items: [
          "新增首页、浏览、资料库和搜索四个主要入口。",
          "首页整合继续观看、推荐、收藏、热门内容和最近更新。",
          "搜索支持番号、女优、标题、标签和结果翻页。",
          "新增 Scripting Home Tab，并加入一次性访问门禁。",
          "统一媒体封面、列表、网格、加载、空状态和错误反馈。",
          "自动适配系统浅色与深色模式。",
        ],
      },
    ],
  },
  {
    version: "2.1.0",
    summary: "详情与媒体列表精修",
    sections: [
      {
        title: "主要更新",
        items: [
          "重排详情页作品信息、播放、收藏、标签与画质选项。",
          "统一纵向媒体列表、16:9 缩略图和整行分隔线。",
          "完善执行中状态、重复点击保护和失败反馈。",
          "改进资料库清空操作和浅深色视觉层级。",
        ],
      },
    ],
  },
  {
    version: "2.0.0",
    summary: "内容优先的媒体浏览界面",
    sections: [
      {
        title: "主要更新",
        items: [
          "建立内容优先的首页、浏览和资料库结构。",
          "采用系统语义背景与文字颜色，支持自动浅深色。",
          "长列表与横向货架使用懒加载容器。",
          "完善最小化、关闭和数据库异步预热生命周期。",
        ],
      },
    ],
  },
  {
    version: "1.1.0",
    summary: "域名切换、本机资料库与推荐",
    sections: [
      {
        title: "主要更新",
        items: [
          "支持可用站点域名切换。",
          "新增 SQLite 本机收藏、浏览历史和播放历史。",
          "新增基于本机行为的内容推荐。",
          "优化播放记录和资料库入口。",
        ],
      },
    ],
  },
]

export function ChangelogPage() {
  return <List listStyle="insetGroup" navigationTitle="更新日志" navigationBarTitleDisplayMode="large">
    <Section>
      <HStack spacing={12} frame={{ minHeight: 58 }}>
        <Image systemName="clock.arrow.trianglehead.counterclockwise.rotate.90" foregroundStyle={ACCENT} frame={{ width: 30 }} />
        <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font="headline" fontWeight="semibold">MISSAV 版本历史</Text>
          <Text font="subheadline" foregroundStyle="secondaryLabel">当前版本 4.1.0</Text>
        </VStack>
      </HStack>
    </Section>
    {releases.map(release => <Section key={release.version} header={<HStack spacing={7}><Text>{`版本 ${release.version}`}</Text>{release.current ? <Text font="caption2" fontWeight="bold" foregroundStyle={ACCENT}>当前版本</Text> : undefined}</HStack>} footer={<Text>{release.summary}</Text>}>
      {release.sections.map(group => <VStack key={`${release.version}-${group.title}`} spacing={10} alignment="leading" padding={{ vertical: 5 }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="body" fontWeight="semibold">{group.title}</Text>
        {group.items.map((item, index) => <HStack key={`${release.version}-${group.title}-${index}`} spacing={9} alignment="top" frame={{ maxWidth: "infinity", alignment: "topLeading" }}>
          <Image systemName="checkmark.circle.fill" font="caption" foregroundStyle={release.current ? ACCENT : "secondaryLabel"} frame={{ width: 17, alignment: "top" }} />
          <Text font="subheadline" foregroundStyle="label" frame={{ maxWidth: "infinity", alignment: "leading" }}>{item}</Text>
        </HStack>)}
      </VStack>)}
    </Section>)}
  </List>
}

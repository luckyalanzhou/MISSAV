// Real Chinese website routes; menu group headings are not request URLs.
export const MISSAV_COLLECTION_OPTIONS = [
  { value: "chinese-subtitle", title: "中文字幕", systemImage: "captions.bubble" },
  { value: "new", title: "最近更新", systemImage: "clock.arrow.circlepath" },
  { value: "release", title: "新作上市", systemImage: "sparkles" },
  { value: "uncensored-leak", title: "无码流出", systemImage: "lock.open" },
  { value: "actresses", title: "女优一览", systemImage: "person.2" },
  { value: "actresses/ranking", title: "女优排行", systemImage: "chart.bar" },
  { value: "genres", title: "类型", systemImage: "tag" },
  { value: "makers", title: "发行商", systemImage: "building.2" },
  { value: "genres/VR", title: "VR", systemImage: "viewfinder" },
  { value: "today-hot", title: "今日热门", systemImage: "flame" },
  { value: "weekly-hot", title: "本周热门", systemImage: "chart.line.uptrend.xyaxis" },
  { value: "monthly-hot", title: "本月热门", systemImage: "calendar" },
  { value: "siro", title: "SIRO", systemImage: "person" },
  { value: "luxu", title: "LUXU", systemImage: "person" },
  { value: "gana", title: "GANA", systemImage: "person" },
  { value: "maan", title: "PRESTIGE PREMIUM", systemImage: "person" },
  { value: "scute", title: "S-CUTE", systemImage: "person" },
  { value: "ara", title: "ARA", systemImage: "person" },
  { value: "fc2", title: "FC2", systemImage: "play.rectangle" },
  { value: "heyzo", title: "HEYZO", systemImage: "play.rectangle" },
  { value: "tokyohot", title: "东京热", systemImage: "play.rectangle" },
  { value: "1pondo", title: "一本道", systemImage: "play.rectangle" },
  { value: "caribbeancom", title: "Caribbeancom", systemImage: "play.rectangle" },
  { value: "caribbeancompr", title: "Caribbeancompr", systemImage: "play.rectangle" },
  { value: "10musume", title: "10musume", systemImage: "play.rectangle" },
  { value: "pacopacomama", title: "pacopacomama", systemImage: "play.rectangle" },
  { value: "gachinco", title: "Gachinco", systemImage: "play.rectangle" },
  { value: "xxxav", title: "XXX-AV", systemImage: "play.rectangle" },
  { value: "marriedslash", title: "人妻斩", systemImage: "play.rectangle" },
  { value: "naughty4610", title: "顽皮 4610", systemImage: "play.rectangle" },
  { value: "naughty0930", title: "顽皮 0930", systemImage: "play.rectangle" },
  { value: "madou", title: "麻豆传媒", systemImage: "film" },
  { value: "twav", title: "TWAV", systemImage: "film" },
  { value: "furuke", title: "Furuke", systemImage: "film" },
  { value: "klive", title: "韩国直播", systemImage: "play.rectangle" },
  { value: "clive", title: "中国直播", systemImage: "play.rectangle" },
] as const

export type MissAVCollection = typeof MISSAV_COLLECTION_OPTIONS[number]["value"]
export type MissAVSort = "released_at" | "published_at" | "today_views" | "weekly_views" | "monthly_views" | "views" | "saved"
export type MissAVFilter = "" | "individual" | "multiple" | "chinese-subtitle"
export type MissAVCollectionGroup = "subtitles" | "japanese" | "amateur" | "uncensored" | "asian"
export type MissAVDirectoryCollection = "actresses" | "actresses/ranking" | "genres" | "makers"

export const MISSAV_COLLECTION_GROUPS: ReadonlyArray<{
  value: MissAVCollectionGroup; title: string; defaultCollection: MissAVCollection; collections: readonly MissAVCollection[]
}> = [
  { value: "subtitles", title: "中文字幕", defaultCollection: "chinese-subtitle", collections: ["chinese-subtitle"] },
  { value: "japanese", title: "日本 AV", defaultCollection: "new", collections: ["new", "release", "uncensored-leak", "actresses", "actresses/ranking", "genres", "makers", "genres/VR", "today-hot", "weekly-hot", "monthly-hot"] },
  { value: "amateur", title: "素人", defaultCollection: "siro", collections: ["siro", "luxu", "gana", "maan", "scute", "ara"] },
  { value: "uncensored", title: "无码影片", defaultCollection: "uncensored-leak", collections: ["uncensored-leak", "fc2", "heyzo", "tokyohot", "1pondo", "caribbeancom", "caribbeancompr", "10musume", "pacopacomama", "gachinco", "xxxav", "marriedslash", "naughty4610", "naughty0930"] },
  { value: "asian", title: "亚洲 AV", defaultCollection: "madou", collections: ["madou", "twav", "furuke", "klive", "clive"] },
]

export function collectionOptionsForGroup(group: MissAVCollectionGroup) {
  const values = MISSAV_COLLECTION_GROUPS.find(option => option.value === group)?.collections || []
  return values.map(value => MISSAV_COLLECTION_OPTIONS.find(option => option.value === value)!)
}

export function isMissAVDirectoryCollection(value: MissAVCollection): value is MissAVDirectoryCollection {
  return value === "actresses" || value === "actresses/ranking" || value === "genres" || value === "makers"
}

export function defaultMissAVCollectionSort(collection: MissAVCollection): MissAVSort {
  if (collection === "new") return "published_at"
  if (collection === "today-hot") return "today_views"
  if (collection === "weekly-hot") return "weekly_views"
  if (collection === "monthly-hot") return "monthly_views"
  return "released_at"
}

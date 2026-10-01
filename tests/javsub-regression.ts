import { Script } from "scripting"
import { parseJavSubSubtitleListing } from "../javsub"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const run = (): void => {
  const listing = parseJavSubSubtitleListing(JSON.stringify({
    title: "SSIS-655 &amp; subtitles",
    totalCount: 5,
    files: [
      { url: "https://javsub.ai/download/free/english-file/", details: "English · complete subtitles" },
      { url: "https://javsub.ai/download/demo/japanese-preview/", details: "Japanese · demo preview" },
      { url: "https://javsub.ai/download/free/traditional-file/", details: "Chinese (Traditional) · complete subtitles" },
      { url: "https://javsub.ai/download/free/simplified-file/", details: "Chinese (Simplified) · complete subtitles" },
      { url: "https://javsub.ai/download/free/english-file/", details: "duplicate English row" },
      { url: "https://evil.example/download/free/fake/", details: "Chinese (Simplified)" },
      { url: "https://javsub.ai/download/demo/final-preview/", details: "Chinese (Traditional) · preview" },
    ],
  }))

  assert(listing.title === "SSIS-655 & subtitles", "作品标题中的常见 HTML 实体应解码")
  assert(listing.files.length === 5, "应只保留 JavSub 官方域名的有效下载项并去重")
  assert(listing.files[0].language === "简体中文" && listing.files[1].language === "繁体中文", "简体中文和繁体中文必须排在结果最上方")
  assert(listing.files[0].isFree && !listing.files[0].isDemo, "完整免费文件应标记为可导入")
  assert(listing.files[1].isFree && !listing.files[1].isDemo, "繁体中文完整免费文件应标记为可导入")
  assert(listing.files[2].isDemo && !listing.files[2].isFree, "演示预览必须与完整免费文件区分")
  assert(listing.totalCount === 5, "作品页字幕条目总数应与站点公布的数量一致")

  Script.exit({ passed: 7, message: "JavSub subtitle listing regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }

// Only an access/signature failure justifies refreshing an already loaded source.
// Audio-session, codec and generic network errors require their own remedies.
export function isExpiredMissAVPlaybackError(message: string): boolean {
  if (/OSStatus|AVAudioSession|(?:error|错误)[\s:=-]*-50\b|unsupported|codec|不支持|格式/i.test(message)) return false
  return /(?:HTTP|status|状态码)[^\n]{0,40}\b(?:401|403|404|410)\b/i.test(message)
    || /\b(?:401|403|404|410)\b[^\n]{0,30}(?:HTTP|unauthorized|forbidden|gone)/i.test(message)
    || /(?:token|signature|signed.?url|access.?url)[^\n]{0,50}(?:expired|invalid)|(?:expired|invalid)[^\n]{0,50}(?:token|signature|signed.?url)|(?:播放地址|令牌|签名)[^\n]{0,20}(?:过期|失效)/i.test(message)
}

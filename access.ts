const ACCESS_KEY = "missav_access_ready_v1"
const ACCESS_TOKEN = [77, 73, 83, 83, 65, 86].map(value => String.fromCharCode(value)).join("")

export function isMissAVAccessReady(): boolean {
  return Storage.get<boolean>(ACCESS_KEY) === true
}

export function submitMissAVAccess(value: string): boolean {
  if (value !== ACCESS_TOKEN) return false
  Storage.set(ACCESS_KEY, true)
  return true
}

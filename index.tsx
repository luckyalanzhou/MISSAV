import { Navigation, Script } from "scripting"
import { HomePage } from "./page"
import { getMissAVDatabase } from "./database"
import { installMissAVLifecycle } from "./lifecycle"
import { installMissAVListingCache } from "./listing-cache"
import { missavListingCacheDatabase } from "./listing-cache-db"
import { removeLegacyMissAVAccountData } from "./removed-account-migration"

async function main() {
  let removeLifecycleListeners: (() => void) | undefined
  let exited = false
  const exit = () => {
    if (exited) return
    exited = true
    try {
      removeLifecycleListeners?.()
    } catch (error) {
      console.error(error)
    } finally {
      // End this script instance, including its native views and pending work.
      // This is not used by the separate minimize or player-close controls.
      Script.exit()
    }
  }
  try {
    Script.enableMinimize()
    removeLifecycleListeners = installMissAVLifecycle(Script)
    installMissAVListingCache(missavListingCacheDatabase)
    try { removeLegacyMissAVAccountData() } catch { console.error("清理旧会话备份失败，下次启动重试。") }
    void getMissAVDatabase().catch(error => console.error(error))
    await Navigation.present({
      element: <HomePage onClose={exit} />,
      modalPresentationStyle: "overFullScreen",
    })
  } catch (error) {
    console.error(error)
  } finally {
    exit()
  }
}

main()

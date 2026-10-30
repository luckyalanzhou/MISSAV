import { Navigation, Script } from "scripting"
import { HomePage } from "./src/ui/pages"
import { installMissAVLifecycle } from "./src/app/lifecycle"
import { initializeMissAVRuntime } from "./src/app/runtime"

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
    initializeMissAVRuntime()
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

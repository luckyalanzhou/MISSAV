import { Navigation, Script } from "scripting"
import { HomePage } from "./page"
import { getMissAVDatabase } from "./database"
import { installMissAVLifecycle } from "./lifecycle"

async function main() {
  Script.enableMinimize()
  const removeLifecycleListeners = installMissAVLifecycle(Script)
  void getMissAVDatabase().catch(error => console.error(error))
  try {
    await Navigation.present({
      element: <HomePage />,
      modalPresentationStyle: "overFullScreen",
    })
    removeLifecycleListeners()
    Script.exit()
  } catch (error) {
    removeLifecycleListeners()
    console.error(error)
    console.present().then(Script.exit)
  }
}

main()

import { Navigation, Script } from "scripting"
import { HomePage } from "./page"
import { getMissAVDatabase } from "./database"

async function main() {
  Script.enableMinimize()
  const removeResumeListener = Script.onResume(() => {})
  void getMissAVDatabase().catch(error => console.error(error))
  try {
    await Navigation.present({
      element: <HomePage />,
      modalPresentationStyle: "overFullScreen",
    })
    removeResumeListener()
    Script.exit()
  } catch (error) {
    removeResumeListener()
    console.error(error)
    console.present().then(Script.exit)
  }
}

main()

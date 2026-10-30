// A native promise may never settle. Bound the caller's wait without accepting
// late results; owners of cancellable native resources also release them.
export async function withMissAVDeadline<T>(request: Promise<T>, timeoutMs: number, message: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(message))
        try { onTimeout?.() } catch { /* Cleanup must not replace the timeout. */ }
      }, timeoutMs)
    })])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}

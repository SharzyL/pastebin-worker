import { useEffect, useState } from "react"
import { verifyName } from "../../shared/verify.js"

export type NameAvailability =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available" }
  | { status: "taken" }
  | { status: "error"; message: string }

const DEBOUNCE_MS = 400

export function useNameAvailability(name: string, deployUrl: string, enabled: boolean): NameAvailability {
  const [state, setState] = useState<NameAvailability>({ status: "idle" })

  useEffect(() => {
    if (!enabled || !verifyName(name)[0]) {
      setState({ status: "idle" })
      return
    }

    // Reset to idle while debouncing so a stale ✓/✗ doesn't linger as the user types.
    setState({ status: "idle" })

    const controller = new AbortController()
    const timer = setTimeout(() => {
      setState({ status: "checking" })
      void fetch(`${deployUrl}/m/~${encodeURIComponent(name)}`, {
        method: "HEAD",
        signal: controller.signal,
      })
        .then((resp) => {
          if (controller.signal.aborted) return
          if (resp.status === 404) setState({ status: "available" })
          else if (resp.status === 200) setState({ status: "taken" })
          else setState({ status: "error", message: `Unexpected status ${resp.status}` })
        })
        .catch((e: Error) => {
          if (e.name === "AbortError") return
          setState({ status: "error", message: e.message })
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [name, deployUrl, enabled])

  return state
}

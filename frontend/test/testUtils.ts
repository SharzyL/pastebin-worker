import { vi } from "vitest"

export function stubBrowerFunctions() {
  vi.spyOn(window, "matchMedia").mockImplementation((_query: string): MediaQueryList => {
    return {
      matches: false,
      addListener(_callback: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null) {},
      addEventListener(_name: string, _listener: EventListenerOrEventListenerObject) {},
      removeEventListener(_name: string, _listener: EventListenerOrEventListenerObject) {},
    } as MediaQueryList
  })

  class ResizeObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserver)
}

export function unStubBrowerFunctions() {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
}

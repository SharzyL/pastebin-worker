import { vi } from "vitest"

export function stubBrowerFunctions() {
  vi.spyOn(window, "matchMedia").mockImplementation((_query: string): MediaQueryList => {
    return {
      matches: false,
      addListener(_callback: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null) {
        // Mock implementation
      },
      addEventListener(_name: string, _listener: EventListenerOrEventListenerObject) {
        // Mock implementation
      },
      removeEventListener(_name: string, _listener: EventListenerOrEventListenerObject) {
        // Mock implementation
      },
    } as MediaQueryList
  })

  class ResizeObserver {
    observe() {
      // Mock implementation
    }
    unobserve() {
      // Mock implementation
    }
    disconnect() {
      // Mock implementation
    }
  }
  vi.stubGlobal("ResizeObserver", ResizeObserver)
}

export function unStubBrowerFunctions() {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
}

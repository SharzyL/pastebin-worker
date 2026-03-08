export function mergeClasses<T extends Record<string, string | undefined>>(
  ...classes: (T | { [K in keyof T]?: string })[]
): T {
  const result = {} as T
  for (const cls of classes) {
    for (const key in cls) {
      const existing = result[key]
      const incoming = cls[key]
      result[key] = (existing && incoming ? `${existing} ${incoming}` : existing || incoming) as T[Extract<
        keyof T,
        string
      >]
    }
  }
  return result
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError("concurrency must be a positive integer")
  }

  const results = new Array<R>(items.length)
  let nextIndex = 0
  let failed = false

  const run = async () => {
    while (!failed) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      try {
        results[index] = await operation(items[index], index)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
}

export function mapIndicesWithConcurrency<R>(
  count: number,
  concurrency: number,
  operation: (index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("count must be a non-negative integer")
  return mapWithConcurrency(
    Array.from({ length: count }, (_, index) => index),
    concurrency,
    (_, index) => operation(index),
  )
}

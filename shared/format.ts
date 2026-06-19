export function itemNoun(count: number): "item" | "items" {
  return count === 1 ? "item" : "items"
}

export function itemCountLabel(count: number): string {
  return `${count} ${itemNoun(count)}`
}

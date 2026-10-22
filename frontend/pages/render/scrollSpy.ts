// Highlights the table-of-contents entry of the section being read on the
// markdown pages. `sectionOf` maps a URL fragment ("#...") to a heading id, so
// encrypted pages can keep the key in front of the section.
export function initScrollSpy(sectionOf: (hash: string) => string | undefined) {
  const links = new Map<string, HTMLAnchorElement>()
  document.querySelectorAll<HTMLAnchorElement>('.toc a[href^="#"]').forEach((a) => {
    const id = sectionOf(a.getAttribute("href")!)
    if (id !== undefined) links.set(id, a)
  })
  if (!links.size) return

  const headings: HTMLElement[] = []
  links.forEach((_, id) => {
    const el = document.getElementById(id)
    if (el) headings.push(el)
  })
  if (!headings.length) return

  let active: HTMLAnchorElement | undefined
  let lockUntil = 0
  const setActive = (link: HTMLAnchorElement | undefined) => {
    if (link === active) return
    active?.classList.remove("active")
    link?.classList.add("active")
    active = link
  }
  const update = () => {
    if (Date.now() < lockUntil) return
    const threshold = 80
    let current: HTMLElement | undefined
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= threshold) current = h
      else break
    }
    setActive(links.get((current ?? headings[0]).id))
  }
  const setActiveByHash = () => {
    const id = sectionOf(location.hash)
    const link = id === undefined ? undefined : links.get(id)
    if (!link) return false
    setActive(link)
    lockUntil = Date.now() + 800
    return true
  }
  let ticking = false
  const onScroll = () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      ticking = false
      update()
    })
  }
  window.addEventListener("scroll", onScroll, { passive: true })
  window.addEventListener("resize", onScroll, { passive: true })
  window.addEventListener("hashchange", setActiveByHash)
  if (!setActiveByHash()) update()
}

// The fragment of a plain page is the heading id itself
export function plainSectionOf(hash: string): string | undefined {
  return hash.length > 1 ? decodeURIComponent(hash.slice(1)) : undefined
}

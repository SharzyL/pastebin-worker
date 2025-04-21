import { makeMarkdown } from "./markdown.js"

import indexHtml from "../../frontend/index.html"
import styleCss from "../../frontend/style.css"
import indexJsIn from "../../frontend/index.js.in"
import tosMd from "../../frontend/tos.md"
import apiMd from "../../doc/api.md"

function indexPage(env: Env): string{
  return indexHtml
    .replace("{{CSS}}", styleCss)
    .replace("{{INDEX_JS}}", indexJsIn)
    .replaceAll("{{BASE_URL}}", env.BASE_URL)
    .replaceAll("{{REPO}}", env.REPO)
    .replaceAll("{{FAVICON}}", env.FAVICON)
}

export function getStaticPage(path: string, env: Env): string | null {
  if (path === "/" || path === "/index" || path === "/index.html") {
    return indexPage(env)
  } else if (path === "/tos" || path === "/tos.html") {
    const tosMdRenderred = tosMd
      .replaceAll("{{TOS_MAINTAINER}}", env.TOS_MAINTAINER)
      .replaceAll("{{TOS_MAIL}}", env.TOS_MAIL)
      .replaceAll("{{BASE_URL}}", env.BASE_URL)

    return makeMarkdown(tosMdRenderred)
  } else if (path === "/api" || path === "/api.html") {
    return makeMarkdown(apiMd)
  } else {
    return null
  }
}

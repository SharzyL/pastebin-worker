import { makeMarkdown } from "./markdown.js"

import tosMd from "../../doc/tos.md"
import apiMd from "../../doc/api.md"

export function getDocPage(path: string, env: Env): string | null {
  if (path === "/tos" || path === "/tos.html") {
    const tosMdRenderred = tosMd
      .replaceAll("{{TOS_MAINTAINER}}", env.TOS_MAINTAINER)
      .replaceAll("{{TOS_MAIL}}", env.TOS_MAIL)
      .replaceAll("{{BASE_URL}}", env.DEPLOY_URL)

    return makeMarkdown(tosMdRenderred)
  } else if (path === "/api" || path === "/api.html") {
    return makeMarkdown(apiMd)
  } else {
    return null
  }
}

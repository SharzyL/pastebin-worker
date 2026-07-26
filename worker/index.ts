import { WorkerError } from "./common.js"
import { ParseError } from "../shared/parsers.js"

import { handleOptions, corsWrapResponse } from "./handlers/handleCors.js"
import { handlePostOrPut } from "./handlers/handleWrite.js"
import { handleGet } from "./handlers/handleRead.js"
import { handleDelete } from "./handlers/handleDelete.js"
import { cleanExpiredInR2 } from "./storage/storage.js"
import { P2PRoom, handleP2PCreate, handleP2PUpdate, handleP2PWebSocket } from "./p2p.js"
import { PasteReadCounter } from "./readCounter.js"

export { P2PRoom, PasteReadCounter }

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return await handleRequest(request, env, ctx)
  },

  // eslint-disable-next-line @typescript-eslint/require-await
  async scheduled(controller: ScheduledController, env, ctx) {
    ctx.waitUntil(cleanExpiredInR2(env, controller))
  },
} satisfies ExportedHandler<Env>

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    if (request.method === "OPTIONS") {
      return handleOptions(request)
    } else {
      const response = await handleNormalRequest(request, env, ctx)
      if (response.webSocket || response.status === 101) {
        return response
      }
      if (response.status !== 302 && response.status !== 404 && response.headers !== undefined) {
        // because Cloudflare do not allow modifying redirect headers
        response.headers.set("Access-Control-Allow-Origin", "*")
      }
      return response
    }
  } catch (e) {
    if (e instanceof ParseError) {
      return corsWrapResponse(new Response(`Error 400: ${e.message}\n`, { status: 400 }))
    } else if (e instanceof WorkerError) {
      return corsWrapResponse(
        new Response(`Error ${e.statusCode}: ${e.message}\n`, {
          status: e.statusCode,
          headers: e.statusCode === 401 ? { "Cache-Control": "private, no-store" } : undefined,
        }),
      )
    } else {
      const err = e as Error
      console.error(err.stack)
      return corsWrapResponse(new Response(`Error 500: ${err.message}\n`, { status: 500 }))
    }
  }
}

async function handleNormalRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Keep the normal paste hot path free from P2P URL parsing and async calls.
  if (request.url.includes("/p2p/")) {
    const p2pCreateResp = await handleP2PCreate(request, env)
    if (p2pCreateResp !== null) return p2pCreateResp

    const p2pUpdateResp = await handleP2PUpdate(request, env)
    if (p2pUpdateResp !== null) return p2pUpdateResp

    const p2pWsResp = await handleP2PWebSocket(request, env)
    if (p2pWsResp !== null) return p2pWsResp
  }

  // TODO: support HEAD method
  if (request.method === "POST") {
    return await handlePostOrPut(request, env, ctx, false)
  } else if (request.method === "GET") {
    return await handleGet(request, env, ctx, false)
  } else if (request.method === "HEAD") {
    return await handleGet(request, env, ctx, true)
  } else if (request.method === "DELETE") {
    return await handleDelete(request, env, ctx)
  } else if (request.method === "PUT") {
    return await handlePostOrPut(request, env, ctx, true)
  } else {
    return new Response(`method ${request.method} not allowed`, {
      status: 405,
      headers: {
        Allow: "GET, HEAD, PUT, POST, DELETE, OPTION",
      },
    })
  }
}

import { WorkerError } from "./common.js"

import { handleOptions, corsWrapResponse } from "./handlers/handleCors.js"
import { handlePostOrPut } from "./handlers/handleWrite.js"
import { handleGet } from "./handlers/handleRead.js"
import { handleDelete } from "./handlers/handleDelete.js"
import { cleanExpiredInR2 } from "./storage/storage.js"

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
      if (response.status !== 302 && response.status !== 404 && response.headers !== undefined) {
        // because Cloudflare do not allow modifying redirect headers
        response.headers.set("Access-Control-Allow-Origin", "*")
      }
      return response
    }
  } catch (e) {
    if (e instanceof WorkerError) {
      return corsWrapResponse(
        new Response(`Error ${e.statusCode}: ${e.message}\n`, {
          status: e.statusCode,
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

import { WorkerError, } from "./common.js"

import { handleOptions, corsWrapResponse } from "./handlers/handleCors.js"
import { handlePostOrPut } from "./handlers/handleWrite.js"
import { handleGet } from "./handlers/handleRead.js"
import { handleDelete } from "./handlers/handleDelete.js"

export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request, env, ctx)
  },
}

async function handleRequest(request, env, ctx) {
  try {
    if (request.method === "OPTIONS") {
      return handleOptions(request)
    } else {
      const response = await handleNormalRequest(request, env, ctx)
      if (response.status !== 302 && response.headers !== undefined) {  // because Cloudflare do not allow modifying redirect headers
        response.headers.set("Access-Control-Allow-Origin", "*")
      }
      return response
    }
  } catch (e) {
    if (e instanceof WorkerError) {
      return corsWrapResponse(new Response(`Error ${e.statusCode}: ${e.message}\n`, { status: e.statusCode }))
    } else {
      console.log(e.stack)
      return corsWrapResponse(new Response(`Error 500: ${e.message}\n`, { status: 500 }))
    }
  }
}

async function handleNormalRequest(request, env, ctx) {
  if (request.method === "POST") {
    return await handlePostOrPut(request, env, ctx, false)
  } else if (request.method === "GET") {
    return await handleGet(request, env, ctx)
  } else if (request.method === "DELETE") {
    return await handleDelete(request, env, ctx)
  } else if (request.method === "PUT") {
    return await handlePostOrPut(request, env, ctx, true)
  } else {
    throw new WorkerError(405, "method not allowed")
  }
}

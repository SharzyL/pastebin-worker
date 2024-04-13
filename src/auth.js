import { WorkerError } from "./common.js"
import { Buffer } from 'node:buffer'

// Encoding function
export function encodeBasicAuth(username, password) {
  const credentials = `${username}:${password}`
  const encodedCredentials = Buffer.from(credentials).toString("base64")
  return `Basic ${encodedCredentials}`
}

// Decoding function
export function decodeBasicAuth(encodedString) {
  const [scheme, encodedCredentials] = encodedString.split(" ")
  if (scheme !== "Basic") {
    throw new WorkerError(400, "Invalid authentication scheme")
  }
  const credentials = Buffer.from(encodedCredentials, "base64").toString("utf-8")
  const [username, password] = credentials.split(":")
  return { username, password }
}

// return true if auth passes or is not required,
// return auth page if auth is required
// throw WorkerError if auth failed
export function verifyAuth(request, env) {
  // pass auth if 'BASIC_AUTH' is not present
  if (!env.BASIC_AUTH) return null

  const passwdMap = new Map(Object.entries(env.BASIC_AUTH))

  // pass auth if 'BASIC_AUTH' is empty
  if (passwdMap.size === 0) return null

  if (request.headers.has("Authorization")) {
    const { username, password } = decodeBasicAuth(request.headers.get("Authorization"))
    if (passwdMap.get(username) === undefined) {
      throw new WorkerError(401, "user not found for basic auth")
    } else if (passwdMap.get(username) !== password) {
      throw new WorkerError(401, "incorrect passwd for basic auth")
    } else {
      return null
    }
  } else {
    return new Response("HTTP basic auth is required", {
      status: 401,
      headers: {
        // Prompts the user for credentials.
        "WWW-Authenticate": "Basic charset=\"UTF-8\"",
      },
    })
  }
}

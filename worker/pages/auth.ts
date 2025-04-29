import { atob_utf8, btoa_utf8, WorkerError } from "../common.js"

// Encoding function
export function encodeBasicAuth(username: string, password: string): string {
  const credentials = `${username}:${password}`
  return `Basic ${btoa_utf8(credentials)}`
}

// Decoding function
export function decodeBasicAuth(encodedString: string): {
  username: string
  password: string
} {
  const [scheme, encodedCredentials] = encodedString.split(" ")
  if (scheme !== "Basic") {
    throw new WorkerError(400, "Invalid authentication scheme")
  }
  const credentials = atob_utf8(encodedCredentials)
  const [username, password] = credentials.split(":", 2)
  return { username, password }
}

// return null if auth passes or is not required,
// return auth page if auth is required
// throw WorkerError if auth failed
// TODO: only allow hashed passwd
export function verifyAuth(request: Request, env: Env): Response | null {
  // pass auth if 'BASIC_AUTH' is not present
  const basic_auth = env.BASIC_AUTH as { [username: string]: string }
  const auth_entries = Object.entries(basic_auth)

  const passwdMap: Map<string, string> = new Map(auth_entries)

  // pass auth if 'BASIC_AUTH' is empty
  if (passwdMap.size === 0) return null

  if (request.headers.has("Authorization")) {
    const { username, password } = decodeBasicAuth(request.headers.get("Authorization")!)
    if (!passwdMap.has(username) || passwdMap.get(username) !== password) {
      throw new WorkerError(401, "incorrect passwd for basic auth")
    } else {
      return null
    }
  } else {
    return new Response("HTTP basic auth is required", {
      status: 401,
      headers: {
        // Prompts the user for credentials.
        "WWW-Authenticate": 'Basic charset="UTF-8"',
      },
    })
  }
}

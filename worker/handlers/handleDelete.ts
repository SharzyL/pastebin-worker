import { WorkerError } from "../common.js"
import { deletePaste, getPasteMetadata } from "../storage/storage.js"
import { parsePath } from "../../shared/parsers.js"

export async function handleDelete(request: Request, env: Env, _: ExecutionContext) {
  const url = new URL(request.url)
  const { name, password } = parsePath(url.pathname)
  const metadata = await getPasteMetadata(env, name)
  if (metadata === null) {
    throw new WorkerError(404, `paste of name '${name}' not found`)
  } else {
    if (password !== metadata.passwd) {
      throw new WorkerError(403, `incorrect password for paste '${name}`)
    } else {
      await deletePaste(env, name, metadata)
      return new Response("the paste will be deleted in seconds")
    }
  }
}

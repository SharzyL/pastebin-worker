import { decode, WorkerError } from "./common.js"

const contentDispositionPrefix = "Content-Disposition:"

// TODO: migrate to native interface

export type FormDataDisposition = {
  name: string
  dispositionType: string
  filename?: string
}

export type FormDataPart = {
  disposition: FormDataDisposition
  headers: Map<string, string>
  content: Uint8Array
}

export function parseFormdata(uint8Array: Uint8Array, boundary: string): Map<string, FormDataPart> {
  boundary = "--" + boundary
  function readLine(idx: number): number {
    // return the index before the next '\r\n' occurs after idx
    for (let i = idx; i < uint8Array.length - 1; i++) {
      if (uint8Array[i] === 0x0d) {
        i++
        if (uint8Array[i] === 0x0a) {
          return i - 1
        }
      }
    }
    return uint8Array.length
  }

  function parseContentDisposition(line: Uint8Array): FormDataDisposition {
    // get disposition type
    let dispositionTypeStartIdx = contentDispositionPrefix.length + 1
    while (dispositionTypeStartIdx < line.length) {
      if (line[dispositionTypeStartIdx] !== " ".charCodeAt(0)) {
        break
      }
      dispositionTypeStartIdx++
    }
    let dispositionTypeEndIdx = dispositionTypeStartIdx
    while (dispositionTypeEndIdx < line.length) {
      if (line[dispositionTypeEndIdx + 1] === ";".charCodeAt(0)) {
        break
      }
      dispositionTypeEndIdx++
    }
    const dispositionType = decode(line.slice(dispositionTypeStartIdx, dispositionTypeEndIdx + 1))

    let name: string | undefined, filename: string | undefined

    for (const dispositionField of decode(line.slice(dispositionTypeEndIdx + 2)).split(";")) {
      if (dispositionField.match(/^\s*$/)) continue
      const match = dispositionField.match(/\b(\w+)="(.+?)"/)
      if (!match) {
        throw new WorkerError(400, `Failed to parse formdata ContentDisposition field: '${dispositionField}'`)
      } else {
        const [_, k, v] = match
        if (k == "name") {
          name = v
        } else if (k == "filename") {
          filename = v
        } else if (k == "filename*") {
          filename = decodeURIComponent(v)
        }
      }
    }
    if (name === undefined) {
      throw new WorkerError(400, "Failed to parse formdata: no `name` field")
    }
    return { name, dispositionType, filename }
  }

  function isContentDisposition(line: Uint8Array): boolean {
    for (let i = 0; i < contentDispositionPrefix.length; i++) {
      if (line[i] !== contentDispositionPrefix.charCodeAt(i)) return false
    }
    return true
  }

  function parseHeader(line: Uint8Array): [string, string] {
    let curIdx = 0

    while (curIdx < line.length) {
      if (curIdx === line.length - 1) {
        throw new WorkerError(400, "Failed to parse formdata header")
      }
      if (line[curIdx + 1] != ":".charCodeAt(0)) {
        curIdx++
      } else {
        break
      }
    }
    const key = decode(line.slice(0, curIdx + 1))

    curIdx++ // now curIdx points to the next char after ':'
    while (curIdx < line.length) {
      if (line[curIdx] === " ".charCodeAt(0)) {
        curIdx++
      } else {
        break
      }
    }

    const value = decode(line.slice(curIdx))
    return [key, value]
  }

  enum LineType {
    NORMAL,
    BOUNDARY,
    END,
  }
  function getLineType(line: Uint8Array): LineType {
    if (line.length === 0) return LineType.NORMAL
    if (line.length === boundary.length) {
      for (let i = 0; i < boundary.length; i++) {
        if (line[i] !== boundary.charCodeAt(i)) return LineType.NORMAL
      }
      return LineType.BOUNDARY
    } else if (line.length === boundary.length + 2) {
      for (let i = 0; i < boundary.length; i++) {
        if (line[i] !== boundary.charCodeAt(i)) return LineType.NORMAL
      }
      if (line[boundary.length] === 0x2d && line[boundary.length + 1] === 0x2d) {
        return LineType.END
      }
    }
    return LineType.NORMAL
  }

  enum DecoderState {
    WANT_HEADER,
    WANT_BODY,
  }
  // state:
  // 0: expecting a header
  // 1: expecting body or boundary
  let state = DecoderState.WANT_HEADER
  const parts: Map<string, FormDataPart> = new Map()
  let lineStart = readLine(0) + 2

  let bodyStartIdx = 0
  let curDisposition: FormDataDisposition | undefined = undefined
  const curHeaders: Map<string, string> = new Map()

  while (true) {
    const lineEnd = readLine(lineStart)
    const line = uint8Array.subarray(lineStart, lineEnd)

    // start reading the body
    if (state === DecoderState.WANT_HEADER) {
      if (line.length === 0) {
        // encounter end of headers
        state = DecoderState.WANT_BODY
        bodyStartIdx = lineEnd + 2
      } else if (isContentDisposition(line)) {
        curDisposition = parseContentDisposition(line)
      } else {
        const [key, value] = parseHeader(line)
        curHeaders.set(key, value)
      }
    } else {
      const lineType = getLineType(line)
      if (lineType !== LineType.NORMAL) {
        // current line is boundary or EOF
        const content = uint8Array.subarray(bodyStartIdx, lineStart - 2)
        parts.set(curDisposition!.name, {
          disposition: curDisposition!,
          headers: curHeaders,
          content: content,
        })
        state = DecoderState.WANT_HEADER
      }
      if (lineType === LineType.END || lineEnd === uint8Array.length) break
    }
    lineStart = lineEnd + 2
  }

  return parts
}

export function getBoundary(contentType: string): string {
  return contentType.split("=")[1]
}

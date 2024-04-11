const contentDispositionPrefix = 'Content-Disposition: form-data'

// TODO: migrate to native interface

export function parseFormdata(uint8Array, boundary) {
  // return an array of {fields: {...: ...}, content: Int8Array}

  boundary = '--' + boundary
  function readLine(idx) {
    // return the index before the next '\r\n' occurs after idx
    for (let i = idx; i < uint8Array.length - 1; i++) {
      if (uint8Array[i] === 0x0D) {
        i ++
        if (uint8Array[i] === 0x0A) {
          return i - 1
        }
      }
    }
    return uint8Array.length
  }

  function parseFields(line) {
    let fields = {}
    for (const match of decoder.decode(line).matchAll(/\b(\w+)="(.+?)"/g)) {
      fields[match[1]] = match[2]
    }
    return fields
  }

  function isContentDisposition(line) {
    for (let i = 0; i < contentDispositionPrefix.length; i++) {
      if (line[i] !== contentDispositionPrefix.charCodeAt(i)) return false
    }
    return true
  }

  function getLineType(line) {
    // type: 0 (normal), 1 (boundary), 2 (end)
    if (line.length === 0) return 0
    if (line.length === boundary.length) {
      for (let i = 0; i < boundary.length; i++) {
        if (line[i] !== boundary.charCodeAt(i)) return 0
      }
      return 1
    } else if (line.length === boundary.length + 2) {
      for (let i = 0; i < boundary.length; i++) {
        if (line[i] !== boundary.charCodeAt(i)) return 0
      }
      if (line[boundary.length] === 0x2D && line[boundary.length + 1] === 0x2D) {
        return 2
      }
    }
    return 0
  }

  let decoder = new TextDecoder()

  // status:
  // 0: expecting a header
  // 1: expecting body
  let status = 0
  let parts = new Map()
  let lineStart = readLine(0) + 2
  if (isNaN(lineStart)) return parts
  let bodyStartIdx = 0
  let currentPart = {fields: {}, content: null}

  while (true) {
    const lineEnd = readLine(lineStart);
    const line = uint8Array.subarray(lineStart, lineEnd)

    // start reading the body
    if (status === 0) {
      if (line.length === 0) {  // encounter end of headers
        status = 1
        bodyStartIdx = lineEnd + 2
      } else if (isContentDisposition(line)) {
        currentPart.fields = parseFields(line)
      }
    } else {
      const lineType = getLineType(line)
      if (lineType !== 0) {  // current line is boundary or EOF
        currentPart.content = uint8Array.subarray(bodyStartIdx, lineStart - 2)
        parts.set(currentPart.fields.name, currentPart)
        currentPart = {fields: {}, content: null}
        status = 0
      }
      if (lineType === 2 || lineEnd === uint8Array.length) break
    }
    lineStart = lineEnd + 2
  }

  return parts
}

export function getBoundary(contentType) {
  return contentType.split('=')[1]
}

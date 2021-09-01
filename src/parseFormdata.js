export function parseFormdata(uint8Array, boundary) {
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

  function parseName(line) {
    const captured = /name="(.+?)"/.exec(decoder.decode(line))
    return captured ? captured[1] : null
  }

  function getLineType(line) {
    // type: 0 (normal), 1 (boundary), 2 (end)
    if (line.length > 0)
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
  let currentName = null

  while (true) {
    const lineEnd = readLine(lineStart);
    const line = uint8Array.subarray(lineStart, lineEnd)

    // start reading the body
    if (status === 0) {
      if (line.length === 0) {
        status = 1
        bodyStartIdx = lineEnd + 2
      } else {
        currentName = parseName(line) || currentName
      }
    } else {
      const lineType = getLineType(line)
      if (lineType > 0) {
        if (currentName !== null)
          parts.set(currentName, uint8Array.subarray(bodyStartIdx, lineStart - 2))
        currentName = null
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

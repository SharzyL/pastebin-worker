export function parseFormdata(/** @type {Uint8Array} */ uint8Array) {
  const parts = [...parseMimeMultipart(uint8Array)]
  let form = new Map()
  for (const part of parts) {
    let name = undefined
    for (const header of part.headers) {
      if (header.name === "Content-Disposition") {
        for (const value of header.values) {
          const nameMatches = /^name="(.*)"$/.exec(value)
          if (nameMatches !== null) {
            name = nameMatches[1]
          }
        }
      }
    }
    if (name === undefined) {
      throw Error("cannot find names in formdata")
    }
    const data = uint8Array.slice(part.index, part.index + part.length)
    form.set(name, data)
  }
  return form
}

// https://github.com/TomasHubelbauer/mime-multipart
function* parseMimeMultipart(/** @type {Uint8Array} */ uint8Array) {
  const textDecoder = new TextDecoder();
  /** @typedef {{ name: string; values: string[]; }} Header */
  /** @typedef {{ type: 'boundary'; boundary: string; }} Boundary */
  /** @typedef {{ type: 'header-name'; boundary: string; name: string; headers: Header[]; }} HeaderName */
  /** @typedef {{ type: 'header-value'; boundary: string; name: string; value: string; values: string[]; headers: Header[]; }} HeaderValue */
  /** @typedef {{ type: 'content'; boundary: string; headers: Headers[]; index: number; length: number; }} Content */
  /** @type {Boundary | HeaderName | HeaderValue | Content} */
  let state = { type: 'boundary', boundary: '' };
  let index = 0;
  let line = 0;
  let column = 0;
  for (; index < uint8Array.byteLength; index++) {
    const character = textDecoder.decode(uint8Array.slice(index, index + 1));
    if (character === '\n') {
      line++;
      column = 0;
    }

    column++;

    switch (state.type) {
      case 'boundary': {
        // Check Windows newlines
        if (character === '\r') {
          if (textDecoder.decode(uint8Array.slice(index + 1, index + 2)) !== '\n') {
            throw new Error(`At ${index} (${line}:${column}): found an incomplete Windows newline.`);
          }

          break;
        }

        if (character === '\n') {
          state = { type: 'header-name', boundary: state.boundary, name: '', value: '', headers: [] };
          break;
        }

        state.boundary += character;
        break;
      }
      case 'header-name': {
        // Check Windows newlines
        if (character === '\r') {
          if (textDecoder.decode(uint8Array.slice(index + 1, index + 2)) !== '\n') {
            throw new Error(`At ${index} (${line}:${column}): found an incomplete Windows newline.`);
          }

          break;
        }

        if (character === '\n') {
          if (state.name === '') {
            state = { type: 'content', boundary: state.boundary, headers: state.headers, index: index + 1, length: 0 };
            break;
          }
          else {
            throw new Error(`At ${index} (${line}:${column}): a newline in a header name '${state.name}' is not allowed.`);
          }
        }

        if (character === ':') {
          state = { type: 'header-value', boundary: state.boundary, name: state.name, value: '', values: [], headers: state.headers };
          break;
        }

        state.name += character;
        break;
      }
      case 'header-value': {
        // Check Windows newlines
        if (character === '\r') {
          if (textDecoder.decode(uint8Array.slice(index + 1, index + 2)) !== '\n') {
            throw new Error(`At ${index} (${line}:${column}): found an incomplete Windows newline.`);
          }

          break;
        }

        if (character === ';') {
          state.values.push(state.value);
          state.value = '';
          break;
        }

        if (character === ' ') {
          // Ignore white-space prior to the value content
          if (state.value === '') {
            break;
          }
        }

        if (character === '\n') {
          state.values.push(state.value);
          state = { type: 'header-name', boundary: state.boundary, name: '', value: '', headers: [{ name: state.name, values: state.values }, ...state.headers] };
          break;
        }

        state.value += character;
        break;
      }
      case 'content': {
        // If the newline is followed by the boundary, then the content ends
        if (character === '\n' || character === '\r' && textDecoder.decode(uint8Array.slice(index + 1, index + 2)) === '\n') {
          if (character === '\r') {
            index++;
          }

          const boundaryCheck = textDecoder.decode(uint8Array.slice(index + '\n'.length, index + '\n'.length + state.boundary.length));
          if (boundaryCheck === state.boundary) {
            const conclusionCheck = textDecoder.decode(uint8Array.slice(index + '\n'.length + state.boundary.length, index + '\n'.length + state.boundary.length + '--'.length));
            if (conclusionCheck === '--') {
              index += '\n'.length + state.boundary.length + '--'.length;
              yield { headers: state.headers, index: state.index, length: state.length };

              if (index !== uint8Array.byteLength) {
                const excess = uint8Array.slice(index);
                if (textDecoder.decode(excess) === '\n' || textDecoder.decode(excess) === '\r\n') {
                  return;
                }

                throw new Error(`At ${index} (${line}:${column}): content is present past the expected end of data ${uint8Array.byteLength}.`);
              }

              return;
            }
            else {
              yield { headers: state.headers, index: state.index, length: state.length };
              state = { type: 'boundary', boundary: '' };
              break;
            }
          }
        }

        state.length++;
        break;
      }
      default: {
        throw new Error(`At ${index} (${line}:${column}): invalid state ${JSON.stringify(state)}.`);
      }
    }
  }

  if (state.type !== 'content') {
    throw new Error(`At ${index} (${line}:${column}): expected content state, got ${JSON.stringify(state)}.`);
  }
}

import { DEFAULT_EDIT_FILENAME } from "./constants.js"

export function filenameForTitle(filename: string | undefined): string | undefined {
  return filename === DEFAULT_EDIT_FILENAME ? undefined : filename
}

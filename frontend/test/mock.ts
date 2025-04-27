import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { PasteResponse } from "../../src/shared.js"

export const mockedPasteUpload: PasteResponse = {
  url: "https://example.com/abcd",
  manageUrl: "https://example.com/abcd:aaaaaaaaaaaaaaaaaa",
  expireAt: "2025-05-01T00:00:00.000Z",
  expirationSeconds: 300,
}

export const mockedPasteContent = "something"

export const server = setupServer(
  http.post("/", () => {
    return HttpResponse.json(mockedPasteUpload)
  }),
  http.get("/abcd", () => {
    return HttpResponse.text(mockedPasteContent)
  }),
)

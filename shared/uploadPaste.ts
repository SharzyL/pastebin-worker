// we will move this file to a shared directory later

import { MPUCreateResponse, PasteResponse } from "./interfaces.js"
import type { EncryptionScheme } from "../frontend/utils/encryption.js"
import { parsePath } from "./parsers.js"

export class UploadError extends Error {
  public statusCode: number

  constructor(statusCode: number, msg: string) {
    super(msg)
    this.statusCode = statusCode
  }
}

export type UploadOptions = {
  content: File
  isUpdate: boolean

  // we allow it to be undefined for convenience
  isPrivate?: boolean

  password?: string
  name?: string

  highlightLanguage?: string
  encryptionScheme?: EncryptionScheme
  expire?: string
  manageUrl?: string
}

// note that apiUrl should be manageUrl when isUpload
export async function uploadNormal(
  apiUrl: string,
  {
    content,
    isUpdate,
    isPrivate,
    password,
    name,
    highlightLanguage,
    encryptionScheme,
    expire,
    manageUrl,
  }: UploadOptions,
): Promise<PasteResponse> {
  const fd = new FormData()

  // typescript cannot handle overload on union types
  fd.set("c", content)

  if (isUpdate && manageUrl === undefined) {
    throw TypeError("uploadMPU: no manageUrl specified in update")
  }

  if (expire !== undefined) fd.set("e", expire)
  if (password !== undefined) fd.set("s", password)
  if (!isUpdate && name !== undefined) fd.set("n", name)
  if (encryptionScheme !== undefined) fd.set("encryption-scheme", encryptionScheme)
  if (highlightLanguage !== undefined) fd.set("lang", highlightLanguage)
  if (isPrivate) fd.set("p", "1")

  const resp = isUpdate
    ? await fetch(manageUrl!, {
        method: "PUT",
        body: fd,
      })
    : await fetch(apiUrl, {
        method: "POST",
        body: fd,
      })

  if (!resp.ok) {
    throw new UploadError(resp.status, await resp.text())
  }

  return await resp.json()
}

export async function uploadMPU(
  apiUrl: string,
  chunkSize: number,
  {
    content,
    isUpdate,
    isPrivate,
    password,
    name,
    highlightLanguage,
    encryptionScheme,
    expire,
    manageUrl,
  }: UploadOptions,
  progressCallback?: (doneBytes: number, allBytes: number) => void,
) {
  const createReqUrl = isUpdate ? new URL(`${apiUrl}/mpu/create-update`) : new URL(`${apiUrl}/mpu/create`)
  if (!isUpdate) {
    if (name !== undefined) {
      createReqUrl.searchParams.set("n", name)
    }
    if (isPrivate) {
      createReqUrl.searchParams.set("p", "1")
    }
  } else {
    if (manageUrl === undefined) {
      throw TypeError("uploadMPU: no manageUrl specified in update")
    }
    const { name: nameFromUrl, password: passwordFromUrl } = parsePath(new URL(manageUrl).pathname)
    if (passwordFromUrl === undefined) {
      throw TypeError("uploadMPU: password not specified in manageUrl")
    }
    createReqUrl.searchParams.set("name", nameFromUrl)
    createReqUrl.searchParams.set("password", passwordFromUrl)
  }

  const createReqResp = await fetch(createReqUrl, { method: "POST" })
  if (!createReqResp.ok) {
    throw new UploadError(createReqResp.status, await createReqResp.text())
  }
  const createResp: MPUCreateResponse = await createReqResp.json()

  const numParts = Math.ceil(content.size / chunkSize)

  // TODO: parallelize
  const uploadedParts: R2UploadedPart[] = []
  let uploadedBytes = 0
  for (let i = 0; i < numParts; i++) {
    const resumeUrl = new URL(`${apiUrl}/mpu/resume`)
    resumeUrl.searchParams.set("key", createResp.key)
    resumeUrl.searchParams.set("uploadId", createResp.uploadId)
    resumeUrl.searchParams.set("partNumber", (i + 1).toString()) // because partNumber need to nonzero
    const chunk = content.slice(i * chunkSize, (i + 1) * chunkSize)
    const resumeReqResp = await fetch(resumeUrl, { method: "PUT", body: chunk })
    if (!resumeReqResp.ok) {
      throw new UploadError(resumeReqResp.status, await resumeReqResp.text())
    }
    const resumeResp: R2UploadedPart = await resumeReqResp.json()
    uploadedParts.push(resumeResp)
    uploadedBytes += chunk.size
    if (progressCallback) {
      progressCallback(uploadedBytes, content.size)
    }
  }

  const completeFormData = new FormData()
  const completeUrl = new URL(`${apiUrl}/mpu/complete`)
  completeUrl.searchParams.set("name", createResp.name)
  completeUrl.searchParams.set("key", createResp.key)
  completeUrl.searchParams.set("uploadId", createResp.uploadId)
  completeFormData.set("c", new File([JSON.stringify(uploadedParts)], content.name))
  if (expire !== undefined) {
    completeFormData.set("e", expire)
  }
  if (password !== undefined) {
    completeFormData.set("s", password)
  }
  if (highlightLanguage !== undefined) {
    completeFormData.set("lang", highlightLanguage)
  }
  if (encryptionScheme !== undefined) {
    completeFormData.set("encryption-scheme", encryptionScheme)
  }
  const completeReqResp = await fetch(completeUrl, {
    method: isUpdate ? "PUT" : "POST",
    body: completeFormData,
  })
  if (!completeReqResp.ok) {
    throw new UploadError(completeReqResp.status, await completeReqResp.text())
  }
  const completeResp: PasteResponse = await completeReqResp.json()
  return completeResp
}

// we will move this file to a shared directory later

import { MPUCreateResponse, PasteResponse } from "./interfaces.js"

export class UploadError extends Error {
  public statusCode: number
  constructor(statusCode: number, msg: string) {
    super(msg)
    this.statusCode = statusCode
  }
}

export async function uploadMPU(
  baseUrl: string,
  content: ArrayBuffer,
  isUpdate: boolean,
  chunkSize: number,
  options: {
    name?: string
    isPrivate?: boolean
    password?: string
    expire?: string
    encryptionScheme?: string
    progressCallback?: (doneBytes: number, allBytes: number) => void
  },
) {
  await fetch("https://shz.al")
  const createReqUrl = isUpdate ? new URL(`${baseUrl}/mpu/create-update`) : new URL(`${baseUrl}/mpu/create`)
  if (!isUpdate) {
    if (options.name !== undefined) {
      createReqUrl.searchParams.set("n", options.name)
    }
    if (options.isPrivate) {
      createReqUrl.searchParams.set("p", "1")
    }
  } else {
    if (options.name === undefined || options.password === undefined) {
      throw TypeError("uploadMPU: name or password not specified for update")
    }
    createReqUrl.searchParams.set("name", options.name)
    createReqUrl.searchParams.set("password", options.password)
  }

  const createReqResp = await fetch(createReqUrl, { method: "POST" })
  if (!createReqResp.ok) {
    throw new UploadError(createReqResp.status, await createReqResp.text())
  }
  const createResp: MPUCreateResponse = await createReqResp.json()

  const numParts = Math.ceil(content.byteLength / chunkSize)

  // TODO: parallelize
  const uploadedParts: R2UploadedPart[] = []
  let uploadedBytes = 0
  for (let i = 0; i < numParts; i++) {
    const resumeUrl = new URL(`${baseUrl}/mpu/resume`)
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
    uploadedBytes += chunk.byteLength
    if (options.progressCallback) {
      options.progressCallback(uploadedBytes, content.byteLength)
    }
  }

  const completeFormData = new FormData()
  const completeUrl = new URL(`${baseUrl}/mpu/complete`)
  completeUrl.searchParams.set("name", createResp.name)
  completeUrl.searchParams.set("key", createResp.key)
  completeUrl.searchParams.set("uploadId", createResp.uploadId)
  completeFormData.set("c", JSON.stringify(uploadedParts))
  if (options.expire !== undefined) {
    completeFormData.set("e", options.expire)
  }
  if (options.password !== undefined) {
    completeFormData.set("s", options.password)
  }
  if (options.encryptionScheme !== undefined) {
    completeFormData.set("encryption-scheme", options.encryptionScheme)
  }
  const completeReqResp = await fetch(completeUrl, { method: isUpdate ? "PUT" : "POST", body: completeFormData })
  if (!completeReqResp.ok) {
    throw new UploadError(completeReqResp.status, await completeReqResp.text())
  }
  const completeResp: PasteResponse = await completeReqResp.json()
  return completeResp
}

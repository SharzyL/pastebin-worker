import { expect, test } from "vitest"
import { areBlobsEqual, BASE_URL, createFormData, randomBlob, staticPages, workerFetchWithAuth } from "./testUtils.js"
import { encodeBasicAuth, decodeBasicAuth } from "../src/auth.js"

test("basic auth encode and decode", async () => {
  const userPasswdPairs = [
    ["user1", "passwd1"],
    ["あおい", "まなか"],
    ["1234#", "اهلا"],
  ]
  for (const [user, passwd] of userPasswdPairs) {
    const encoded = encodeBasicAuth(user, passwd)
    const decoded = decodeBasicAuth(encoded)
    expect(decoded.username).toStrictEqual(user)
    expect(decoded.password).toStrictEqual(passwd)
  }
})

test("basic auth", async () => {
  const usersKv = {
    "user1": "passwd1",
    "user2": "passwd2",
  }

  // access index
  for (const page of staticPages) {
    expect((await workerFetchWithAuth(usersKv, `${BASE_URL}/${page}`, {})).status).toStrictEqual(401)
  }
  expect((await workerFetchWithAuth(usersKv, BASE_URL, {
    headers: { "Authorization": encodeBasicAuth("user1", usersKv["user1"]) },
  })).status).toStrictEqual(200)

  // upload with no auth
  const blob1 = randomBlob(1024)
  const uploadResp = await workerFetchWithAuth(usersKv, BASE_URL, {
    method: "POST",
    body: createFormData({ c: blob1 }),
  })
  expect(uploadResp.status).toStrictEqual(401)

  // upload with true auth
  const uploadResp1 = await workerFetchWithAuth(usersKv, BASE_URL, {
    method: "POST",
    body: createFormData({ c: blob1 }),
    headers: { "Authorization": encodeBasicAuth("user2", usersKv["user2"]) },
  })
  expect(uploadResp1.status).toStrictEqual(200)

  // upload with wrong auth
  const uploadResp2 = await workerFetchWithAuth(usersKv, BASE_URL, {
    method: "POST",
    body: createFormData({ c: blob1 }),
    headers: { "Authorization": encodeBasicAuth("user1", "wrong-password") },
  })
  expect(uploadResp2.status).toStrictEqual(401)

  // revisit without auth
  const uploadJson = JSON.parse(await uploadResp1.text())
  const url = uploadJson["url"]
  const revisitResp = await workerFetchWithAuth(usersKv, url)
  expect(revisitResp.status).toStrictEqual(200)
  expect(areBlobsEqual(await revisitResp.blob(), blob1)).toBeTruthy()

  // update with no auth
  const blob2 = randomBlob(1024)
  const admin = uploadJson["admin"]
  const updateResp = await workerFetchWithAuth(usersKv, admin, {
    method: "PUT",
    body: createFormData({ c: blob2 }),
  })
  expect(updateResp.status).toStrictEqual(200)
  const revisitUpdatedResp = await workerFetchWithAuth(usersKv, url)
  expect(revisitUpdatedResp.status).toStrictEqual(200)
  expect(areBlobsEqual(await revisitUpdatedResp.blob(), blob2)).toBeTruthy()

  // delete with no auth
  const deleteResp = await workerFetchWithAuth(usersKv, admin, {
    method: "DELETE",
  })
  expect(deleteResp.status).toStrictEqual(200)
  expect((await workerFetchWithAuth(usersKv, url)).status).toStrictEqual(404)
})
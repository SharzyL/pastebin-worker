import {dateToUnix, genRandStr, params, WorkerError} from "../common.js";

export type PasteMetadata = {
    passwd: string,

    lastModifiedAtUnix: number,
    createdAtUnix: number,
    willExpireAtUnix: number,

    filename?: string,
}

export type PasteWithMetadata = {
    paste: ArrayBuffer,
    metadata: PasteMetadata
}

export async function getPaste(env: Env, short: string): Promise<PasteWithMetadata | null> {
    let item = await env.PB.getWithMetadata<PasteMetadata>(short, {type: "arrayBuffer"});

    if (item.value === null) {
        throw new WorkerError(404, `paste of name '${short}' not found`)
    } else if (item.metadata === null) {
        throw new WorkerError(500, `paste of name '${short}' has no metadata`)
    } else {
        if (item.metadata.willExpireAtUnix < new Date().getTime() / 1000) {
            throw new WorkerError(404, `paste of name '${short}' not found`)
        }
        return {paste: item.value, metadata: item.metadata}
    }
}

export async function updatePaste(
    env: Env,
    pasteName: string,
    content: ArrayBuffer,
    originalMetadata: PasteMetadata,
    options: {
        now: Date,
        expirationSeconds: number,
        passwd: string,
        filename?: string,
    }) {
    const putOptions: { metadata: PasteMetadata, expirationTtl: number } = {
        metadata: {
            filename: options.filename || originalMetadata.filename,
            passwd: options.passwd,

            lastModifiedAtUnix: dateToUnix(options.now),
            createdAtUnix: originalMetadata.createdAtUnix,
            willExpireAtUnix: dateToUnix(options.now) + options.expirationSeconds,
        },
        expirationTtl: options.expirationSeconds,
    }

    await env.PB.put(pasteName, content, putOptions)
}

export async function createPaste(
    env: Env,
    pasteName: string,
    content: ArrayBuffer,
    options: {
        expirationSeconds: number,
        now: Date,
        passwd: string,
        filename?: string,
    }) {
    const putOptions: { metadata: PasteMetadata, expirationTtl: number } = {
        metadata: {
            filename: options.filename,
            passwd: options.passwd,

            lastModifiedAtUnix: dateToUnix(options.now),
            createdAtUnix: dateToUnix(options.now),
            willExpireAtUnix: dateToUnix(options.now) + options.expirationSeconds,
        },
        expirationTtl: options.expirationSeconds,
    }

    await env.PB.put(pasteName, content, putOptions)
}

export async function pasteNameAvailable(env: Env, pasteName: string): Promise<boolean> {
    const item = await env.PB.getWithMetadata<PasteMetadata>(pasteName);
    if (item.value == null) {
        return true;
    } else if (item.metadata === null) {
        throw new WorkerError(500, `paste of name '${pasteName}' has no metadata`)
    } else {
        return item.metadata.willExpireAtUnix < new Date().getTime() / 1000
    }
}

export async function deletePaste(env: Env, pasteName: string): Promise<void> {
    await env.PB.delete(pasteName);
}

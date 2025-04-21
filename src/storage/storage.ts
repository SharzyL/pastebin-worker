import {dateToUnix, WorkerError} from "../common.js";

export type PasteMetadata = {
    schemaVersion: number,
    passwd: string,

    lastModifiedAtUnix: number,
    createdAtUnix: number,
    willExpireAtUnix: number,

    accessCounter: number,  // a counter representing how frequent it is accessed, to administration usage
    filename?: string,
}

export type PasteWithMetadata = {
    paste: ArrayBuffer,
    metadata: PasteMetadata
}

export async function getPaste(env: Env, short: string): Promise<PasteWithMetadata | null> {
    let item = await env.PB.getWithMetadata<PasteMetadata>(short, {type: "arrayBuffer"});

    if (item.value === null) {
        return null
    } else if (item.metadata === null) {
        throw new WorkerError(500, `paste of name '${short}' has no metadata`)
    } else {
        if (item.metadata.willExpireAtUnix < new Date().getTime() / 1000) {
            return null
        }

        // update counter with probability 1%
        if (Math.random() < 0.01) {
            item.metadata.accessCounter += 1
            try {
                env.PB.put(short, item.value, {
                    metadata: item.metadata,
                    expiration: item.metadata.willExpireAtUnix,
                })
            } catch (e) {
                // ignore rate limit message
                if (!(e as Error).message.includes( "KV PUT failed: 429 Too Many Requests")) {
                    throw e
                }
            }
        }

        return {paste: item.value, metadata: item.metadata}
    }
}

// we separate usage of getPasteMetadata and getPaste to make access metric more reliable
export async function getPasteMetadata(env: Env, short: string): Promise<PasteMetadata | null> {
    let item = await env.PB.getWithMetadata<PasteMetadata>(short, {type: "stream"});

    if (item.value === null) {
        return null
    } else if (item.metadata === null) {
        throw new WorkerError(500, `paste of name '${short}' has no metadata`)
    } else {
        if (item.metadata.willExpireAtUnix < new Date().getTime() / 1000) {
            return null
        }
        return item.metadata
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
    const expirationUnix = dateToUnix(options.now) + options.expirationSeconds
    const putOptions: KVNamespacePutOptions = {
        metadata: {
            schemaVersion: 0,
            filename: options.filename || originalMetadata.filename,
            passwd: options.passwd,

            lastModifiedAtUnix: dateToUnix(options.now),
            createdAtUnix: originalMetadata.createdAtUnix,
            willExpireAtUnix: expirationUnix,
            accessCounter: originalMetadata.accessCounter,
        },
        expiration: expirationUnix,
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
    const expirationUnix = dateToUnix(options.now) + options.expirationSeconds
    const putOptions: KVNamespacePutOptions = {
        metadata: {
            schemaVersion: 0,
            filename: options.filename,
            passwd: options.passwd,

            lastModifiedAtUnix: dateToUnix(options.now),
            createdAtUnix: dateToUnix(options.now),
            willExpireAtUnix: expirationUnix,
            accessCounter: 0,
        },
        expiration: expirationUnix,
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

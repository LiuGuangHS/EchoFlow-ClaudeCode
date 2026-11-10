import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { URL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NodeHttpExecutor } from 'builder-util/out/nodeHttpExecutor'
import { CancellationToken } from 'builder-util-runtime'
import { GenericDifferentialDownloader } from 'electron-updater/out/differentialDownloader/GenericDifferentialDownloader'
import { DifferentialHttpExecutor } from './differentialHttpExecutor'

type Reply = (request: IncomingMessage, response: ServerResponse) => void

const blockSize = 32
const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
}

function chunkMap(name: string, chunks: Buffer[]) {
  return {
    version: '2' as const,
    files: [{
      name,
      offset: 0,
      sizes: chunks.map(chunk => chunk.length),
      checksums: chunks.map(chunk => createHash('sha256').update(chunk).digest('hex')),
    }],
  }
}

function serve(reply: Reply) {
  const server = createServer(reply)
  server.listen(0, '127.0.0.1')
  return once(server, 'listening').then(() => {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('loopback server did not bind a TCP port')
    return {
      url: `http://127.0.0.1:${address.port}/release.bin`,
      close: () => new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
        server.closeAllConnections()
      }),
    }
  })
}

async function download(reply: Reply, options: { multipleRanges?: boolean } = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'echoflow-update-range-'))
  const oldChunks = [Buffer.alloc(blockSize, 1), Buffer.alloc(blockSize, 2), Buffer.alloc(blockSize, 3)]
  const newChunks = [oldChunks[0]!, Buffer.alloc(blockSize, 4), oldChunks[2]!]
  const oldPath = join(tempDir, 'old.bin')
  const newPath = join(tempDir, 'new.bin')
  const oldFile = Buffer.concat(oldChunks)
  const newFile = Buffer.concat(newChunks)
  writeFileSync(oldPath, oldFile)
  const server = await serve(reply)
  try {
    const downloader = new GenericDifferentialDownloader(
      { size: newFile.length, sha512: createHash('sha512').update(newFile).digest('base64') },
      new DifferentialHttpExecutor(new NodeHttpExecutor()),
      {
        oldFile: oldPath,
        newUrl: new URL(server.url),
        logger,
        newFile: newPath,
        requestHeaders: { Connection: 'close' },
        isUseMultipleRangeRequest: options.multipleRanges ?? false,
        cancellationToken: new CancellationToken(),
      },
    )
    await downloader.download(chunkMap('release.bin', oldChunks), chunkMap('release.bin', newChunks))
    return readFileSync(newPath)
  } finally {
    await server.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
}

describe('electron-updater differential Range contract', () => {
  it('downloads changed bytes through one valid Range response and verifies the assembled artifact', async () => {
    const requests: Array<{ method?: string, range?: string }> = []
    const bytes = await download((request, response) => {
      requests.push({ method: request.method, range: request.headers.range })
      const bytes = Buffer.alloc(blockSize, 4)
      const start = 32
      response.writeHead(206, {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${start + bytes.length - 1}/96`,
        'Content-Length': bytes.length,
      })
      response.end(bytes)
    })

    expect(requests).toEqual([{ method: 'GET', range: 'bytes=32-63' }])
    expect(bytes).toEqual(Buffer.concat([
      Buffer.alloc(blockSize, 1),
      Buffer.alloc(blockSize, 4),
      Buffer.alloc(blockSize, 3),
    ]))
  })

  it('rejects a 416 response', async () => {
    await expect(download((_request, response) => {
      response.writeHead(416, { 'Content-Range': 'bytes */96', 'Content-Length': 0 })
      response.end()
    })).rejects.toThrow()
  })

  it('rejects a wrong Content-Range before assembling the artifact', async () => {
    await expect(download((_request, response) => {
      const changed = Buffer.alloc(blockSize, 4)
      response.writeHead(206, {
        'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes 0-31/96',
        'Content-Length': changed.length,
      })
      response.end(changed)
    })).rejects.toThrow('Content-Range')
  })

  it('rejects a 206 response without Accept-Ranges before assembling the artifact', async () => {
    await expect(download((_request, response) => {
      const changed = Buffer.alloc(blockSize, 4)
      response.writeHead(206, { 'Content-Range': 'bytes 32-63/96', 'Content-Length': changed.length })
      response.end(changed)
    })).rejects.toThrow('Accept-Ranges')
  })

  it('rejects a full 200 response when it cannot produce the metadata fingerprint', async () => {
    await expect(download((_request, response) => {
      const fullFile = Buffer.concat([
        Buffer.alloc(blockSize, 1),
        Buffer.alloc(blockSize, 4),
        Buffer.alloc(blockSize, 3),
      ])
      response.writeHead(200, { 'Accept-Ranges': 'bytes', 'Content-Length': fullFile.length })
      response.end(fullFile)
    })).rejects.toThrow()
  })

  it('does not follow redirects with the Node transport used by this offline harness', async () => {
    const requests: string[] = []
    await expect(download((request, response) => {
      requests.push(String(request.url))
      response.writeHead(302, { Location: '/redirected.bin', 'Content-Length': 0 })
      response.end()
    })).rejects.toThrow()

    expect(requests).toEqual(['/release.bin'])
  })

  it('rejects an interrupted range response', async () => {
    await expect(download((_request, response) => {
      response.writeHead(206, {
        'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes 32-63/96',
        'Content-Length': blockSize,
      })
      response.write(Buffer.alloc(8, 4))
      response.destroy()
    })).rejects.toThrow()
  })

  it('rejects an invalid multipart content type from a proxy-like feed', async () => {
    const oldChunks = [0, 1, 2, 3, 4].map(value => Buffer.alloc(blockSize, value + 1))
    const newChunks = [oldChunks[0]!, Buffer.alloc(blockSize, 6), oldChunks[2]!, Buffer.alloc(blockSize, 8), oldChunks[4]!]
    const tempDir = mkdtempSync(join(tmpdir(), 'echoflow-update-multipart-'))
    const oldPath = join(tempDir, 'old.bin')
    const newPath = join(tempDir, 'new.bin')
    writeFileSync(oldPath, Buffer.concat(oldChunks))
    const server = await serve((_request, response) => {
      response.writeHead(206, {
        'Accept-Ranges': 'bytes',
        'Content-Type': 'application/octet-stream',
        'Content-Length': 0,
      })
      response.end()
    })
    try {
      const newFile = Buffer.concat(newChunks)
      const downloader = new GenericDifferentialDownloader(
        { size: newFile.length, sha512: createHash('sha512').update(newFile).digest('base64') },
        new DifferentialHttpExecutor(new NodeHttpExecutor()),
        {
          oldFile: oldPath,
          newUrl: new URL(server.url),
          logger,
          newFile: newPath,
          requestHeaders: { Connection: 'close' },
          isUseMultipleRangeRequest: true,
          cancellationToken: new CancellationToken(),
        },
      )
      await expect(downloader.download(
        chunkMap('release.bin', oldChunks),
        chunkMap('release.bin', newChunks),
      )).rejects.toThrow('multiple ranges')
    } finally {
      await server.close()
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

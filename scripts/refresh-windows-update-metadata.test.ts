import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, test } from 'bun:test'
import { parse } from 'yaml'
import { refreshWindowsUpdateMetadata } from './refresh-windows-update-metadata'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'cc-haha-signed-windows-metadata-'))
}

function writeBlockmap(installerPath: string, name = basename(installerPath)) {
  const installer = readFileSync(installerPath)
  const checksum = createHash('sha256').update(installer).digest('hex')
  writeFileSync(`${installerPath}.blockmap`, gzipSync(JSON.stringify({
    version: '2',
    files: [{ name, offset: 0, checksums: [checksum], sizes: [installer.length] }],
  })))
}

describe('signed Windows update metadata refresh', () => {
  test('replaces the unsigned installer checksum and size while preserving release metadata', async () => {
    const dir = tempDir()
    const installerName = 'Claude-Code-Haha-0.5.5-win-x64.exe'
    const installerPath = join(dir, installerName)
    const metadataPath = join(dir, 'latest.yml')
    const installer = Buffer.from('signed installer bytes')
    writeFileSync(installerPath, installer)
    writeBlockmap(installerPath, installerName)
    writeFileSync(metadataPath, `
version: 0.5.5
files:
  - url: ${installerName}
    sha512: unsigned-checksum
    sha2: stale-sha256
    size: 1
path: ${installerName}
sha512: unsigned-checksum
sha2: stale-sha256
releaseDate: '2026-08-23T00:00:00.000Z'
`.trimStart())

    const result = await refreshWindowsUpdateMetadata({ installerPath, metadataPath })
    const expectedSha512 = createHash('sha512').update(installer).digest('base64')
    const metadata = parse(readFileSync(metadataPath, 'utf8')) as {
      files: Array<{ sha512: string, sha2?: string, size: number }>
      sha512: string
      sha2?: string
      releaseDate: string
    }

    expect(result).toEqual({
      installerName,
      sha512: expectedSha512,
      size: installer.length,
    })
    expect(metadata.files[0]).toMatchObject({
      sha512: expectedSha512,
      size: installer.length,
    })
    expect(metadata.files[0].sha2).toBeUndefined()
    expect(metadata.sha512).toBe(expectedSha512)
    expect(metadata.sha2).toBeUndefined()
    expect(metadata.releaseDate).toBe('2026-08-23T00:00:00.000Z')
  })

  test('rejects metadata that does not point at the signed installer', async () => {
    const dir = tempDir()
    const installerPath = join(dir, 'Claude-Code-Haha-0.5.5-win-arm64.exe')
    const metadataPath = join(dir, 'latest.yml')
    writeFileSync(installerPath, 'signed')
    writeBlockmap(installerPath)
    writeFileSync(metadataPath, `
version: 0.5.5
files:
  - url: different-installer.exe
    sha512: old
path: different-installer.exe
sha512: old
`.trimStart())

    await expect(refreshWindowsUpdateMetadata({ installerPath, metadataPath }))
      .rejects.toThrow('Expected exactly one update file')
  })

  test('rejects metadata containing multiple files even when one matches', async () => {
    const dir = tempDir()
    const installerName = 'Claude-Code-Haha-0.5.5-win-x64.exe'
    const installerPath = join(dir, installerName)
    const metadataPath = join(dir, 'latest.yml')
    writeFileSync(installerPath, 'signed installer bytes')
    writeBlockmap(installerPath, installerName)
    const metadata = `
version: 0.5.5
files:
  - url: ${installerName}
    sha512: unsigned-checksum
    size: 1
  - url: another-installer.exe
    sha512: another-checksum
    size: 2
path: ${installerName}
sha512: unsigned-checksum
releaseDate: '2026-08-23T00:00:00.000Z'
`.trimStart()
    writeFileSync(metadataPath, metadata)

    await expect(refreshWindowsUpdateMetadata({ installerPath, metadataPath })).rejects.toThrow(
      'exactly one update file',
    )
    expect(readFileSync(metadataPath, 'utf8')).toBe(metadata)
  })

  test('rejects missing or malformed blockmaps without changing metadata', async () => {
    for (const blockmap of [null, Buffer.from('not gzip')]) {
      const dir = tempDir()
      const installerName = 'EchoFlow-Code-0.5.5-win-x64.exe'
      const installerPath = join(dir, installerName)
      const metadataPath = join(dir, 'latest.yml')
      const metadata = `version: 0.5.5\nfiles:\n  - url: ${installerName}\npath: ${installerName}\n`
      writeFileSync(installerPath, 'signed installer')
      writeFileSync(metadataPath, metadata)
      if (blockmap) writeFileSync(`${installerPath}.blockmap`, blockmap)

      await expect(refreshWindowsUpdateMetadata({ installerPath, metadataPath })).rejects.toThrow()
      expect(readFileSync(metadataPath, 'utf8')).toBe(metadata)
    }
  })

  test('rejects blockmaps not describing the final installer without changing metadata', async () => {
    for (const mismatch of ['wrong-name', 'wrong-size']) {
      const dir = tempDir()
      const installerName = 'EchoFlow-Code-0.5.5-win-x64.exe'
      const installerPath = join(dir, installerName)
      const metadataPath = join(dir, 'latest.yml')
      const metadata = `version: 0.5.5\nfiles:\n  - url: ${installerName}\npath: ${installerName}\n`
      writeFileSync(installerPath, 'signed installer')
      writeBlockmap(installerPath, mismatch === 'wrong-name' ? 'another-installer.exe' : installerName)
      if (mismatch === 'wrong-size') {
        const blockmap = JSON.parse(gunzipSync(readFileSync(`${installerPath}.blockmap`)).toString())
        blockmap.files[0].sizes[0] += 1
        writeFileSync(`${installerPath}.blockmap`, gzipSync(JSON.stringify(blockmap)))
      }
      writeFileSync(metadataPath, metadata)

      await expect(refreshWindowsUpdateMetadata({ installerPath, metadataPath })).rejects.toThrow()
      expect(readFileSync(metadataPath, 'utf8')).toBe(metadata)
    }
  })
})

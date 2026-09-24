import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installLatestLtsNode,
  isCompatibleNodeVersion,
  nodeRuntimeRoot,
  resolveManagedNode,
} from './nodeRuntime'

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
}

const tempDirs: string[] = []

function tempDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'echoflow-node-runtime-'))
  tempDirs.push(directory)
  return directory
}

function currentNodeAsset() {
  const target = process.platform === 'win32'
    ? process.arch === 'arm64' ? 'win-arm64' : 'win-x64'
    : process.platform === 'darwin'
      ? process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
      : process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  const executableRelativePath = process.platform === 'win32' ? 'node.exe' : 'bin/node'
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz'
  return { target, executableRelativePath, extension }
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Node runtime', () => {
  it('accepts only Node.js 22.19.0 or later', () => {
    expect(isCompatibleNodeVersion([22, 18, 9])).toBe(false)
    expect(isCompatibleNodeVersion([22, 19, 0])).toBe(true)
    expect(isCompatibleNodeVersion([24, 0, 0])).toBe(true)
  })

  it('resolves a compatible managed Node executable', async () => {
    const userDataPath = tempDir()
    const executable = path.join(
      nodeRuntimeRoot(userDataPath),
      'current',
      currentNodeAsset().executableRelativePath,
    )
    await fs.mkdir(path.dirname(executable), { recursive: true })
    await fs.writeFile(executable, '')

    const spawn = vi.fn(() => {
      const child = new FakeChild()
      queueMicrotask(() => {
        child.stdout.write('v22.19.0\n')
        child.stdout.end()
        child.emit('exit', 0, null)
      })
      return child
    })

    await expect(resolveManagedNode(userDataPath, {
      exists: existsSync,
      spawn: spawn as never,
    })).resolves.toBe(executable)
  })

  it('downloads and verifies the newest compatible LTS archive before promotion', async () => {
    const userDataPath = tempDir()
    const version = 'v22.20.0'
    const { target, executableRelativePath, extension } = currentNodeAsset()
    const archiveName = `node-${version}-${target}.${extension}`
    const archive = Buffer.from('fake node archive')
    const checksum = createHash('sha256').update(archive).digest('hex')
    const urls: string[] = []
    const fetch = vi.fn(async (url: string) => {
      urls.push(url)
      if (url.endsWith('/index.json')) {
        return new Response(JSON.stringify([
          {
            version: 'v20.20.0',
            lts: 'Iron',
            files: [`node-v20.20.0-${target}.${extension}`],
          },
          { version, lts: 'Jod', files: [target] },
        ]))
      }
      if (url.endsWith('/SHASUMS256.txt')) {
        return new Response(`${checksum}  ${archiveName}\n`)
      }
      return new Response(archive)
    })
    const spawn = vi.fn((command: string, args: string[]) => {
      const child = new FakeChild()
      queueMicrotask(async () => {
        if (command === 'tar') {
          const extractionRoot = args[3]!
          const executable = path.join(
            extractionRoot,
            `node-${version}-${target}`,
            executableRelativePath,
          )
          await fs.mkdir(path.dirname(executable), { recursive: true })
          await fs.writeFile(executable, '')
        } else {
          child.stdout.write(`${version}\n`)
          child.stdout.end()
        }
        child.emit('exit', 0, null)
      })
      return child
    })

    const executable = await installLatestLtsNode(userDataPath, {
      exists: existsSync,
      mkdir: fs.mkdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      rename: fs.rename,
      rm: fs.rm,
      fetch: fetch as never,
      spawn: spawn as never,
    })

    expect(executable).toBe(path.join(
      nodeRuntimeRoot(userDataPath),
      'current',
      executableRelativePath,
    ))
    expect(existsSync(executable)).toBe(true)
    expect(urls).toEqual([
      'https://nodejs.org/dist/index.json',
      `https://nodejs.org/dist/${version}/SHASUMS256.txt`,
      `https://nodejs.org/dist/${version}/${archiveName}`,
    ])
  })

  it('rejects an archive whose checksum does not match', async () => {
    const userDataPath = tempDir()
    const version = 'v22.20.0'
    const { target, extension } = currentNodeAsset()
    const archiveName = `node-${version}-${target}.${extension}`
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/index.json')) {
        return new Response(JSON.stringify([{ version, lts: 'Jod', files: [archiveName] }]))
      }
      if (url.endsWith('/SHASUMS256.txt')) {
        return new Response(`${'0'.repeat(64)}  ${archiveName}\n`)
      }
      return new Response('tampered archive')
    })

    await expect(installLatestLtsNode(userDataPath, {
      fetch: fetch as never,
    })).rejects.toThrow('checksum verification failed')
    expect(existsSync(path.join(nodeRuntimeRoot(userDataPath), 'current'))).toBe(false)
  })

  it('restores the previous managed runtime when promotion fails', async () => {
    const userDataPath = tempDir()
    const currentRoot = path.join(nodeRuntimeRoot(userDataPath), 'current')
    const oldExecutable = path.join(currentRoot, currentNodeAsset().executableRelativePath)
    await fs.mkdir(path.dirname(oldExecutable), { recursive: true })
    await fs.writeFile(oldExecutable, 'old runtime')

    const version = 'v22.20.0'
    const { target, executableRelativePath, extension } = currentNodeAsset()
    const archiveName = `node-${version}-${target}.${extension}`
    const archive = Buffer.from('fake node archive')
    const checksum = createHash('sha256').update(archive).digest('hex')
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/index.json')) {
        return new Response(JSON.stringify([{ version, lts: 'Jod', files: [archiveName] }]))
      }
      if (url.endsWith('/SHASUMS256.txt')) return new Response(`${checksum}  ${archiveName}\n`)
      return new Response(archive)
    })
    const spawn = vi.fn((command: string, args: string[]) => {
      const child = new FakeChild()
      queueMicrotask(async () => {
        if (command === 'tar') {
          const executable = path.join(args[3]!, `node-${version}-${target}`, executableRelativePath)
          await fs.mkdir(path.dirname(executable), { recursive: true })
          await fs.writeFile(executable, '')
        } else {
          child.stdout.write(`${version}\n`)
          child.stdout.end()
        }
        child.emit('exit', 0, null)
      })
      return child
    })
    const rename = vi.fn(async (source: string, destination: string) => {
      if (destination === currentRoot && source.includes('extract')) {
        throw new Error('promotion failed')
      }
      return fs.rename(source, destination)
    })

    await expect(installLatestLtsNode(userDataPath, {
      exists: existsSync,
      mkdir: fs.mkdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      rename: rename as never,
      rm: fs.rm,
      fetch: fetch as never,
      spawn: spawn as never,
    })).rejects.toThrow('promotion failed')
    await expect(fs.readFile(oldExecutable, 'utf8')).resolves.toBe('old runtime')
  })
})

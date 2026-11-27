import { readFileSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import { getEchoFlowConfigDir, getEchoFlowInternalDir } from './echoFlowConfigRoot'

export type StorageRelocations = {
  version: 1 | 2
  previousRoots: string[]
  mappings?: { from: string; to: string }[]
  [key: string]: unknown
}

export const MANAGED_ATTACHMENT_PREFIXES = [
  'uploads',
  'image-cache',
  'im-downloads',
  'cc-haha/generated-images',
  'echoflow-code/generated-images',
] as const

export function activeStorageRoot(): string {
  return getEchoFlowConfigDir()
}

export function readStorageRelocations(configDir = activeStorageRoot()): StorageRelocations {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(join(getEchoFlowInternalDir(configDir), 'storage-relocations.json'), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, previousRoots: [] }
    throw new Error('Cannot read storage relocation metadata', { cause: error })
  }
  return parseStorageRelocations(value)
}

export function parseStorageRelocations(value: unknown): StorageRelocations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid storage relocation metadata')
  }
  const record = value as Record<string, unknown>
  if ((record.version !== 1 && record.version !== 2) || !Array.isArray(record.previousRoots) ||
    !record.previousRoots.every(root => typeof root === 'string' && root.length > 0 &&
      !root.includes('\0') && (process.platform === 'win32' ? win32 : posix).isAbsolute(root))) {
    throw new Error('Unsupported or invalid storage relocation metadata')
  }
  if (record.version === 2 && (!Array.isArray(record.mappings) || !record.mappings.every(mapping =>
    mapping && typeof mapping.from === 'string' && !mapping.from.includes('\0') && (process.platform === 'win32' ? win32 : posix).isAbsolute(mapping.from) &&
    typeof mapping.to === 'string' && (mapping.to === '.' || (mapping.to.length > 0 && !mapping.to.includes('\0') && !posix.isAbsolute(mapping.to) && !win32.isAbsolute(mapping.to) && mapping.to.split(/[\\/]/).every((part: string) => !!part && part !== '.' && part !== '..')))))) {
    throw new Error('Unsupported or invalid storage relocation mappings')
  }
  return record as StorageRelocations
}

/** Resolve only app-owned attachment locations. Project files and transcript text stay unchanged. */
export function mapRelocatedAttachmentPath(
  inputPath: string,
  configDir: string,
  previousRoots: readonly string[],
  platform: string = process.platform,
): string {
  const paths = platform === 'win32' ? win32 : posix
  if (!paths.isAbsolute(inputPath) || inputPath.includes('\0')) return inputPath
  const normalized = paths.normalize(inputPath)
  for (const root of previousRoots) {
    const relativePath = paths.relative(paths.normalize(root), normalized)
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${paths.sep}`) || paths.isAbsolute(relativePath)) continue
    const comparable = relativePath.replaceAll('\\', '/')
    const matchingPath = platform === 'win32' ? comparable.toLowerCase() : comparable
    if (MANAGED_ATTACHMENT_PREFIXES.some(prefix => matchingPath.startsWith(`${prefix}/`))) {
      return paths.join(configDir, relativePath)
    }
  }
  return inputPath
}

export function resolveRelocatedAttachmentPath(inputPath: string, configDir = activeStorageRoot()): string {
  const metadata = readStorageRelocations(configDir)
  const paths = process.platform === 'win32' ? win32 : posix
  if (metadata.version === 2 && paths.isAbsolute(inputPath) && !inputPath.includes('\0')) {
    for (const mapping of [...metadata.mappings!].sort((a, b) => b.from.length - a.from.length)) {
      const child = paths.relative(mapping.from, paths.normalize(inputPath))
      if (!child || child === '..' || child.startsWith(`..${paths.sep}`) || paths.isAbsolute(child)) continue
      const destination = paths.join(mapping.to, child).replaceAll('\\', '/')
      if (MANAGED_ATTACHMENT_PREFIXES.some(prefix => destination.startsWith(`${prefix}/`))) return paths.join(configDir, mapping.to, child)
    }
  }
  return mapRelocatedAttachmentPath(inputPath, configDir, metadata.previousRoots)
}

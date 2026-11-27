import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { getEchoFlowConfigDir } from './echoFlowConfigRoot.js'
import { readStorageRelocations } from './storageRelocations.js'

function physicalPath(file: string): string {
  const missing: string[] = []
  let ancestor = file
  for (;;) {
    try {
      return join(realpathSync(ancestor), ...missing)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // A dangling link is not a missing directory and must never become writable.
      try {
        if (lstatSync(ancestor).isSymbolicLink()) throw new Error('Managed storage path contains a dangling symlink')
      } catch (linkError) {
        if ((linkError as NodeJS.ErrnoException).code !== 'ENOENT') throw linkError
      }
      const parent = dirname(ancestor)
      if (parent === ancestor) throw error
      missing.unshift(basename(ancestor))
      ancestor = parent
    }
  }
}

function isWithin(parent: string, child: string): boolean {
  const suffix = relative(parent, child)
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

/** Apply recorded moves without inspecting the candidate on disk. */
export function relocateManagedStoragePath(value: string, setting: string, root = getEchoFlowConfigDir()): string {
  if (!isAbsolute(value) || value.includes('\0')) {
    throw new Error(`${setting} must be an absolute path inside the selected storage root`)
  }
  let candidate = resolve(value)
  // cc-haha is the legacy namespace that can retire inside the selected root.
  if (!isWithin(root, candidate) || isWithin(join(root, 'cc-haha'), candidate)) {
    const metadata = readStorageRelocations(root)
    if (metadata.version === 2) {
      const matches = metadata.mappings!.filter(mapping => isWithin(mapping.from, candidate))
        .sort((a, b) => b.from.length - a.from.length)
      const mapping = matches[0]
      if (mapping) {
        const destinations = matches.filter(item => relative(item.from, mapping.from) === '')
          .map(item => resolve(root, item.to, relative(item.from, candidate)))
        if (destinations.some(destination => destination !== destinations[0])) {
          throw new Error('Conflicting storage relocation mappings')
        }
        // Only the migrated destination is inspected; retired roots are never reopened.
        candidate = destinations[0]!
      }
    }
  }
  return candidate
}

/** Product state overrides cannot create a second physical storage root. */
export function resolveManagedStoragePath(value: string, setting: string): string {
  const root = getEchoFlowConfigDir()
  const candidate = relocateManagedStoragePath(value, setting, root)
  const paths: Array<[string, string]> = [[root, candidate], [physicalPath(root), physicalPath(candidate)]]
  for (const [parent, child] of paths) {
    if (!isWithin(parent, child)) {
      throw new Error(`${setting} is outside the selected storage root; migrate it through storage migration before startup`)
    }
  }
  return candidate
}

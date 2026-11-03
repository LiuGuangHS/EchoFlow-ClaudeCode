import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { parseDocument } from 'yaml'

const workflowDir = '.github/workflows'
const files = readdirSync(workflowDir).filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))

describe('workflow YAML', () => {
  test('finds the workflow files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const name of files) {
    test(`${name} parses without errors or duplicate keys`, () => {
      const document = parseDocument(readFileSync(`${workflowDir}/${name}`, 'utf8'))

      expect(document.errors.map(error => error.message)).toEqual([])
    })
  }
})

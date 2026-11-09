import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { parse, parseDocument } from 'yaml'

const workflowDir = '.github/workflows'
const files = readdirSync(workflowDir).filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))

describe('workflow YAML', () => {
  test('docs deployment mirrors release metadata before uploading the site', () => {
    const workflow = parse(readFileSync(`${workflowDir}/deploy-docs.yml`, 'utf8'))
    expect(workflow.on.workflow_call.inputs.release_tag).toMatchObject({ type: 'string', required: false })
    expect(workflow.on).toHaveProperty('push')
    expect(workflow.on).toHaveProperty('workflow_dispatch')
    const steps = workflow.jobs.build.steps
    const build = steps.findIndex((step: { name: string }) => step.name === 'Build React site')
    const setup = steps.findIndex((step: { name: string }) => step.name === 'Setup Bun')
    const mirror = steps.findIndex((step: { name: string }) => step.name === 'Mirror update metadata and build download manifest')
    const upload = steps.findIndex((step: { name: string }) => step.name === 'Upload artifact')
    expect(build).toBeGreaterThanOrEqual(0)
    expect(setup).toBeGreaterThan(build)
    expect(mirror).toBeGreaterThan(setup)
    expect(upload).toBeGreaterThan(mirror)
    expect(steps[build].env.DOCS_BASE).toBe('/')
    expect(steps[setup].with['bun-version-file']).toBe('package.json')
    expect(steps[mirror].env).toEqual({ GH_TOKEN: '${{ github.token }}', RELEASE_TAG: "${{ inputs.release_tag || 'latest' }}" })
    expect(steps[mirror].run).toBe('bun run scripts/site-release-manifest.ts --release "$RELEASE_TAG" --out site/dist --repo "$GITHUB_REPOSITORY"')
    expect(steps[mirror]['continue-on-error']).toBeUndefined()
    expect(steps[mirror].if).toBeUndefined()
    expect(steps[upload].with.path).toBe('site/dist')
    expect(workflow.jobs.deploy.needs).toBe('build')
  })

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

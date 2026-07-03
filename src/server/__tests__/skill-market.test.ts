import { afterEach, describe, expect, it, mock } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  handleSkillMarketApi,
  resetSkillMarketServiceFactoryForTests,
  setSkillMarketServiceFactoryForTests,
} from '../api/skill-market.js'
import { normalizeClawHubList, normalizeClawHubScan } from '../services/skillMarket/clawhubAdapter.js'
import { analyzeSkillRisk } from '../services/skillMarket/risk.js'
import { createSkillMarketService } from '../services/skillMarket/service.js'
import { normalizeSkillHubDetail, normalizeSkillHubList } from '../services/skillMarket/skillhubAdapter.js'
import {
  CLAWHUB_SCAN_RESPONSE,
  CLAWHUB_TOP_SKILLS_RESPONSE,
  SKILLHUB_DETAIL_RESPONSE,
  SKILLHUB_TOP_SKILLS_RESPONSE,
} from './fixtures/skill-market.js'

describe('skill market fixtures', () => {
  it('keeps representative ClawHub fixture shape stable', () => {
    expect(CLAWHUB_TOP_SKILLS_RESPONSE.items[0]).toMatchObject({
      slug: 'skill-vetter',
      displayName: 'Skill Vetter',
      stats: expect.objectContaining({ downloads: expect.any(Number) }),
    })
  })

  it('keeps representative SkillHub fixture shape stable', () => {
    expect(SKILLHUB_TOP_SKILLS_RESPONSE.data.skills[0]).toMatchObject({
      slug: 'skill-vetter',
      source: 'clawhub',
      labels: expect.objectContaining({ requires_api_key: 'false' }),
    })
  })
})

describe('skill market source normalization', () => {
  it('normalizes ClawHub catalog items as primary clean candidates', () => {
    const result = normalizeClawHubList(CLAWHUB_TOP_SKILLS_RESPONSE)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      source: 'clawhub',
      sourceMode: 'primary',
      slug: 'skill-vetter',
      displayName: 'Skill Vetter',
      canonicalUrl: 'https://clawhub.ai/skill-vetter',
      trustState: 'clean',
      installed: false,
      requiresApiKey: false,
    })
  })

  it('normalizes ClawHub scan responses into trust metadata', () => {
    expect(normalizeClawHubScan(CLAWHUB_SCAN_RESPONSE)).toEqual({
      trustState: 'clean',
      trustSummary: 'No dangerous patterns detected.',
      packageSha256: 'a'.repeat(64),
    })
  })

  it('keeps malicious ClawHub scan responses blocked even with warnings', () => {
    expect(normalizeClawHubScan({ status: 'malicious', hasWarnings: true })).toMatchObject({
      trustState: 'blocked',
    })
  })

  it('uses malicious ClawHub scanner summaries for malicious scans', () => {
    expect(normalizeClawHubScan({
      status: 'malicious',
      scanners: {
        metadata: { status: 'clean', summary: 'No dangerous patterns detected.' },
        staticAnalysis: { status: 'malicious', summary: 'Credential exfiltration detected.' },
      },
    })).toMatchObject({
      trustState: 'blocked',
      trustSummary: 'Credential exfiltration detected.',
    })
  })

  it('prioritizes malicious ClawHub scanner results over clean top-level status', () => {
    expect(normalizeClawHubScan({
      status: 'clean',
      scanners: {
        metadata: { status: 'clean', summary: 'No dangerous patterns detected.' },
        staticAnalysis: { status: 'malicious', summary: 'Credential exfiltration detected.' },
      },
    })).toMatchObject({
      trustState: 'blocked',
      trustSummary: 'Credential exfiltration detected.',
    })
  })

  it('does not use clean ClawHub scanner summaries for blocked scans', () => {
    expect(normalizeClawHubScan({
      status: 'malicious',
      scanners: {
        metadata: { status: 'clean', summary: 'No dangerous patterns detected.' },
      },
    })).toEqual({
      trustState: 'blocked',
      trustSummary: undefined,
      packageSha256: undefined,
    })
  })

  it('does not use clean ClawHub scanner summaries for warning scans', () => {
    expect(normalizeClawHubScan({
      status: 'suspicious',
      scanners: {
        metadata: { status: 'clean', summary: 'No dangerous patterns detected.' },
      },
    })).toEqual({
      trustState: 'warning',
      trustSummary: undefined,
      packageSha256: undefined,
    })
  })

  it('prioritizes warning ClawHub scanner results over clean top-level status', () => {
    expect(normalizeClawHubScan({
      status: 'clean',
      scanners: {
        metadata: { status: 'clean', summary: 'No dangerous patterns detected.' },
        staticAnalysis: { status: 'warning', summary: 'Reads shell profile files.' },
      },
    })).toMatchObject({
      trustState: 'warning',
      trustSummary: 'Reads shell profile files.',
    })
  })

  it('maps ClawHub top-level warning status to warning trust state', () => {
    expect(normalizeClawHubScan({
      status: 'warning',
      scanners: {
        staticAnalysis: { status: 'warning', summary: 'Reads shell profile files.' },
      },
    })).toMatchObject({
      trustState: 'warning',
      trustSummary: 'Reads shell profile files.',
    })
  })

  it('does not use clean ClawHub scanner summaries for unknown scans', () => {
    expect(normalizeClawHubScan({
      status: 'unknown',
      scanners: {
        metadata: { status: 'clean', summary: 'No dangerous patterns detected.' },
      },
    })).toEqual({
      trustState: 'unknown',
      trustSummary: undefined,
      packageSha256: undefined,
    })
  })

  it('does not use unscored ClawHub scanner summaries for unknown scans', () => {
    expect(normalizeClawHubScan({
      status: 'unknown',
      scanners: {
        metadata: { summary: 'No dangerous patterns detected.' },
      },
    })).toEqual({
      trustState: 'unknown',
      trustSummary: undefined,
      packageSha256: undefined,
    })
  })

  it('normalizes SkillHub list items as fallback candidates with Chinese summary', () => {
    const result = normalizeSkillHubList(SKILLHUB_TOP_SKILLS_RESPONSE)

    expect(result.items[0]).toMatchObject({
      source: 'skillhub',
      sourceMode: 'fallback',
      slug: 'skill-vetter',
      summaryZh: 'AI智能体技能安全预审工具。',
      canonicalUrl: 'https://clawhub.ai/spclaudehome/skill-vetter',
      license: 'Apache-2.0',
      tags: ['GitHub', 'Permission'],
      trustState: 'unknown',
      requiresApiKey: false,
    })
  })

  it('normalizes verified SkillHub list items as signed', () => {
    const result = normalizeSkillHubList({
      code: 0,
      data: {
        skills: [
          {
            slug: 'verified-skill',
            name: 'Verified Skill',
            upstream_url: 'https://github.com/example/verified-skill',
            verified: true,
          },
        ],
      },
    })

    expect(result.items[0]).toMatchObject({
      slug: 'verified-skill',
      canonicalUrl: 'https://github.com/example/verified-skill',
      upstreamUrl: 'https://github.com/example/verified-skill',
      trustState: 'signed',
    })
  })

  it('falls back when SkillHub external URLs are invalid', () => {
    const list = normalizeSkillHubList({
      code: 0,
      data: {
        skills: [
          {
            slug: 'unsafe/slug',
            name: 'Unsafe URL Skill',
            upstream_url: 'http://evil.test/unsafe/slug',
          },
        ],
      },
    })

    expect(list.items[0]).toMatchObject({
      canonicalUrl: 'https://skillhub.cn/skills/unsafe%2Fslug',
      upstreamUrl: 'https://skillhub.cn/skills/unsafe%2Fslug',
    })

    const detail = normalizeSkillHubDetail({
      securityReports: {
        keen: { status: 'benign', statusText: 'safe' },
      },
      skill: {
        slug: 'unsafe/slug',
        displayName: 'Unsafe URL Skill',
        sourceUrl: 'https://evil.test/unsafe/slug',
      },
    })

    expect(detail).toMatchObject({
      canonicalUrl: 'https://skillhub.cn/skills/unsafe%2Fslug',
      trustState: 'benign',
    })
  })

  it('rejects SkillHub external URLs with userinfo', () => {
    const list = normalizeSkillHubList({
      code: 0,
      data: {
        skills: [
          {
            slug: 'skill-vetter',
            name: 'Skill Vetter',
            upstream_url: 'https://evil.test@github.com/path',
          },
        ],
      },
    })

    expect(list.items[0]).toMatchObject({
      canonicalUrl: 'https://skillhub.cn/skills/skill-vetter',
      upstreamUrl: 'https://skillhub.cn/skills/skill-vetter',
    })

    const detail = normalizeSkillHubDetail({
      skill: {
        slug: 'skill-vetter',
        displayName: 'Skill Vetter',
        sourceUrl: 'https://user:password@github.com/path',
      },
    })

    expect(detail).toMatchObject({
      canonicalUrl: 'https://skillhub.cn/skills/skill-vetter',
    })
  })

  it('normalizes SkillHub detail security reports', () => {
    const detail = normalizeSkillHubDetail(SKILLHUB_DETAIL_RESPONSE)

    expect(detail).toMatchObject({
      source: 'skillhub',
      sourceMode: 'fallback',
      slug: 'skill-vetter',
      version: '1.0.1',
      license: 'Apache-2.0',
      tags: ['GitHub', 'Permission'],
      trustState: 'benign',
      trustSummary: '安全，无风险',
      installEligibility: { status: 'installable' },
    })
  })

  it('falls back to SkillHub skill version when latestVersion is missing', () => {
    const detail = normalizeSkillHubDetail({
      securityReports: {
        keen: { status: 'benign', statusText: 'safe' },
      },
      skill: {
        slug: 'legacy-version-skill',
        displayName: 'Legacy Version Skill',
        version: '0.9.0',
      },
    })

    expect(detail.version).toBe('0.9.0')
  })

  it('blocks SkillHub details with warning security reports', () => {
    for (const status of ['warning', 'suspicious']) {
      const detail = normalizeSkillHubDetail({
        securityReports: {
          staticAnalysis: { status, statusText: 'Potentially risky tool use.' },
        },
        skill: {
          slug: `${status}-skill`,
          displayName: `${status} Skill`,
        },
      })

      expect(detail.trustState).toBe('warning')
      expect(detail.trustSummary).toBe('Potentially risky tool use.')
      expect(detail.installEligibility).toEqual({
        status: 'blocked',
        reason: 'SkillHub security report returned warnings.',
      })
    }
  })

  it('blocks SkillHub details when security reports are missing', () => {
    const detail = normalizeSkillHubDetail({
      skill: {
        slug: 'unreviewed-skill',
        displayName: 'Unreviewed Skill',
      },
    })

    expect(detail.trustState).toBe('unknown')
    expect(detail.installEligibility.status).toBe('blocked')
    expect(detail.installEligibility.reason).toMatch(/security report is missing or inconclusive/i)
  })

  it('blocks SkillHub details when security reports are mixed or inconclusive', () => {
    const detail = normalizeSkillHubDetail({
      securityReports: {
        community: { status: 'benign', statusText: 'safe' },
        staticAnalysis: { status: 'pending-review', statusText: 'Scanner still reviewing.' },
      },
      skill: {
        slug: 'mixed-report-skill',
        displayName: 'Mixed Report Skill',
      },
    })

    expect(detail.trustState).toBe('unknown')
    expect(detail.trustSummary).toBeUndefined()
    expect(detail.installEligibility.status).toBe('blocked')
    expect(detail.installEligibility.reason).toMatch(/security report is missing or inconclusive/i)
  })

  it('does not use unscored SkillHub report summaries for unknown details', () => {
    const detail = normalizeSkillHubDetail({
      securityReports: {
        community: { status: 'benign', statusText: 'safe' },
        staticAnalysis: { statusText: 'No issues detected.' },
      },
      skill: {
        slug: 'unscored-report-skill',
        displayName: 'Unscored Report Skill',
      },
    })

    expect(detail.trustState).toBe('unknown')
    expect(detail.trustSummary).toBeUndefined()
    expect(detail.installEligibility.status).toBe('blocked')
    expect(detail.installEligibility.reason).toMatch(/security report is missing or inconclusive/i)
  })

  it('uses malicious SkillHub report summaries for blocked details', () => {
    const detail = normalizeSkillHubDetail({
      securityReports: {
        community: { status: 'benign', statusText: 'safe' },
        staticAnalysis: { status: 'malicious', statusText: 'Credential exfiltration detected.' },
      },
      skill: {
        slug: 'skill-vetter',
        displayName: 'Skill Vetter',
      },
    })

    expect(detail).toMatchObject({
      trustState: 'blocked',
      trustSummary: 'Credential exfiltration detected.',
    })
  })
})

describe('skill market service source selection', () => {
  it('uses ClawHub only in auto mode when ClawHub succeeds and marks installed skills', async () => {
    const fetchCalls: string[] = []
    const service = createSkillMarketService({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url))
        return Response.json(CLAWHUB_TOP_SKILLS_RESPONSE)
      },
      installedSkillNames: async () => new Set(['skill-vetter']),
    })

    const result = await service.listSkills({ source: 'auto', limit: 12, query: 'vetter', cursor: 'next-page' })

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]).toStartWith('https://clawhub.ai/api/v1/skills')
    expect(fetchCalls[0]).toContain('sort=downloads')
    expect(fetchCalls[0]).toContain('nonSuspiciousOnly=true')
    expect(fetchCalls[0]).toContain('limit=12')
    expect(fetchCalls[0]).toContain('query=vetter')
    expect(fetchCalls[0]).toContain('cursor=next-page')
    expect(result).toMatchObject({
      source: 'clawhub',
      sourceStatus: 'ok',
      items: [
        {
          source: 'clawhub',
          slug: 'skill-vetter',
          installed: true,
        },
      ],
    })
  })

  it('falls back to SkillHub in auto mode when ClawHub fails and marks installed skills', async () => {
    const fetchCalls: string[] = []
    const service = createSkillMarketService({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url))
        if (String(url).startsWith('https://clawhub.ai/')) {
          return new Response('temporarily unavailable', { status: 503 })
        }
        return Response.json(SKILLHUB_TOP_SKILLS_RESPONSE)
      },
      installedSkillNames: new Set(['skill-vetter']),
    })

    const result = await service.listSkills({ source: 'auto', limit: 10, query: 'vetter', cursor: '3' })

    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls[0]).toStartWith('https://clawhub.ai/api/v1/skills')
    expect(fetchCalls[1]).toStartWith('https://api.skillhub.cn/api/skills')
    expect(fetchCalls[1]).toContain('sortBy=downloads')
    expect(fetchCalls[1]).toContain('order=desc')
    expect(fetchCalls[1]).toContain('limit=10')
    expect(fetchCalls[1]).toContain('query=vetter')
    expect(fetchCalls[1]).toContain('cursor=3')
    expect(result.source).toBe('skillhub')
    expect(result.sourceStatus).toBe('fallback')
    expect(result.message).toContain('ClawHub unavailable')
    expect(result.items[0]).toMatchObject({
      source: 'skillhub',
      slug: 'skill-vetter',
      installed: true,
    })
  })

  it('falls back to SkillHub in auto mode when ClawHub fetch throws', async () => {
    const fetchCalls: string[] = []
    const service = createSkillMarketService({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url))
        if (String(url).startsWith('https://clawhub.ai/')) {
          throw new Error('network down')
        }
        return Response.json(SKILLHUB_TOP_SKILLS_RESPONSE)
      },
      installedSkillNames: async () => new Set(),
    })

    const result = await service.listSkills({ source: 'auto' })

    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls[0]).toStartWith('https://clawhub.ai/api/v1/skills')
    expect(fetchCalls[1]).toStartWith('https://api.skillhub.cn/api/skills')
    expect(result.source).toBe('skillhub')
    expect(result.sourceStatus).toBe('fallback')
    expect(result.message).toContain('ClawHub unavailable')
    expect(result.message).toContain('network down')
  })

  it('caches catalog results without caching installed state', async () => {
    const fetchCalls: string[] = []
    let installedSkillNames = new Set<string>()
    const service = createSkillMarketService({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url))
        return Response.json(CLAWHUB_TOP_SKILLS_RESPONSE)
      },
      installedSkillNames: async () => installedSkillNames,
      now: () => 1_000,
    })

    const first = await service.listSkills({ source: 'clawhub', limit: 12, query: 'vetter' })
    installedSkillNames = new Set(['skill-vetter'])
    const second = await service.listSkills({ source: 'clawhub', limit: 12, query: 'vetter' })

    expect(fetchCalls).toHaveLength(1)
    expect(first.items[0]).toMatchObject({ slug: 'skill-vetter', installed: false })
    expect(second.items[0]).toMatchObject({ slug: 'skill-vetter', installed: true })
  })

  it('refreshes cached catalog results after the catalog TTL expires', async () => {
    const fetchCalls: string[] = []
    let now = 10_000
    const service = createSkillMarketService({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url))
        return Response.json(CLAWHUB_TOP_SKILLS_RESPONSE)
      },
      installedSkillNames: async () => new Set(),
      now: () => now,
    })

    await service.listSkills({ source: 'clawhub', limit: 12, query: 'vetter' })
    await service.listSkills({ source: 'clawhub', limit: 12, query: 'vetter' })
    expect(fetchCalls).toHaveLength(1)
    now += 5 * 60 * 1_000 + 1
    await service.listSkills({ source: 'clawhub', limit: 12, query: 'vetter' })

    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls[0]).toBe(fetchCalls[1])
  })

  it('uses the failure cache to skip repeated ClawHub request failures in auto mode', async () => {
    const fetchCalls: string[] = []
    let now = 20_000
    let clawHubRequests = 0
    const service = createSkillMarketService({
      fetchImpl: async (url) => {
        const urlString = String(url)
        fetchCalls.push(urlString)
        if (urlString.startsWith('https://clawhub.ai/')) {
          clawHubRequests += 1
          if (clawHubRequests === 1) {
            return new Response('temporarily unavailable', { status: 503 })
          }
          return Response.json(CLAWHUB_TOP_SKILLS_RESPONSE)
        }
        return Response.json(SKILLHUB_TOP_SKILLS_RESPONSE)
      },
      installedSkillNames: async () => new Set(),
      now: () => now,
    })

    const first = await service.listSkills({ source: 'auto', limit: 10, query: 'vetter' })
    const requestsAfterFirst = fetchCalls.length
    now += 30_000
    const second = await service.listSkills({ source: 'auto', limit: 10, query: 'vetter' })
    const requestsAfterSecond = fetchCalls.length
    now += 30_001
    const third = await service.listSkills({ source: 'auto', limit: 10, query: 'vetter' })

    expect(fetchCalls.slice(0, requestsAfterFirst)).toEqual([
      expect.stringContaining('https://clawhub.ai/api/v1/skills'),
      expect.stringContaining('https://api.skillhub.cn/api/skills'),
    ])
    expect(fetchCalls.slice(requestsAfterFirst, requestsAfterSecond)).not.toContainEqual(
      expect.stringContaining('https://clawhub.ai/'),
    )
    expect(first.sourceStatus).toBe('fallback')
    expect(second.source).toBe('skillhub')
    expect(second.sourceStatus).toBe('fallback')
    expect(second.message).toContain('ClawHub unavailable')
    expect(third).toMatchObject({ source: 'clawhub', sourceStatus: 'ok' })
    expect(clawHubRequests).toBe(2)
  })

  it('does not fall back when ClawHub returns 2xx but JSON parsing fails', async () => {
    const fetchCalls: string[] = []
    const service = createSkillMarketService({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url))
        if (String(url).startsWith('https://clawhub.ai/')) {
          return new Response('{not-json', { status: 200 })
        }
        return Response.json(SKILLHUB_TOP_SKILLS_RESPONSE)
      },
      installedSkillNames: async () => new Set(),
    })

    await expect(service.listSkills({ source: 'auto' })).rejects.toThrow()

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]).toStartWith('https://clawhub.ai/api/v1/skills')
  })

  it('does not fall back when installed skill resolution fails', async () => {
    const fetchCalls: string[] = []
    const service = createSkillMarketService({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url))
        return Response.json(CLAWHUB_TOP_SKILLS_RESPONSE)
      },
      installedSkillNames: async () => {
        throw new Error('installed provider unavailable')
      },
    })

    await expect(service.listSkills({ source: 'auto' })).rejects.toThrow('installed provider unavailable')

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]).toStartWith('https://clawhub.ai/api/v1/skills')
  })

  it("does not fallback to SkillHub when source is 'clawhub'", async () => {
    const fetchCalls: string[] = []
    const service = createSkillMarketService({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url))
        return new Response('temporarily unavailable', { status: 503 })
      },
      installedSkillNames: async () => new Set(),
    })

    await expect(service.listSkills({ source: 'clawhub' })).rejects.toThrow('ClawHub request failed')

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]).toStartWith('https://clawhub.ai/api/v1/skills')
  })

  it("uses SkillHub only when source is 'skillhub'", async () => {
    const fetchCalls: string[] = []
    const service = createSkillMarketService({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url))
        return Response.json(SKILLHUB_TOP_SKILLS_RESPONSE)
      },
      installedSkillNames: async () => new Set(),
    })

    const result = await service.listSkills({ source: 'skillhub', limit: 6, query: 'vetter', cursor: '2' })

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]).toStartWith('https://api.skillhub.cn/api/skills')
    expect(fetchCalls[0]).toContain('sortBy=downloads')
    expect(fetchCalls[0]).toContain('order=desc')
    expect(fetchCalls[0]).toContain('limit=6')
    expect(fetchCalls[0]).toContain('query=vetter')
    expect(fetchCalls[0]).toContain('cursor=2')
    expect(result.source).toBe('skillhub')
    expect(result.items[0]).toMatchObject({
      source: 'skillhub',
      slug: 'skill-vetter',
      installed: false,
    })
  })

  it('rejects unsupported v1 sources instead of treating them as auto', async () => {
    const fetchCalls: string[] = []
    const service = createSkillMarketService({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url))
        return Response.json(CLAWHUB_TOP_SKILLS_RESPONSE)
      },
      installedSkillNames: async () => new Set(),
    })

    await expect(
      service.listSkills({ source: 'future-source' as 'auto' }),
    ).rejects.toThrow('Unsupported skill market source')

    expect(fetchCalls).toHaveLength(0)
  })

  it('builds detail from the explicit ClawHub list and marks installed eligibility', async () => {
    const fetchCalls: string[] = []
    const service = createSkillMarketService({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url))
        return Response.json(CLAWHUB_TOP_SKILLS_RESPONSE)
      },
      installedSkillNames: new Set(['skill-vetter']),
    })

    const detail = await service.getDetail({ source: 'clawhub', slug: 'skill-vetter' })

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]).toStartWith('https://clawhub.ai/api/v1/skills')
    expect(fetchCalls[0]).toContain('query=skill-vetter')
    expect(fetchCalls[0]).toContain('limit=100')
    expect(detail).toMatchObject({
      source: 'clawhub',
      slug: 'skill-vetter',
      installed: true,
      files: [],
      riskLabels: [],
      installEligibility: {
        status: 'installed',
        installedSkillName: 'skill-vetter',
      },
    })
  })

  it('blocks detail installs when list trust metadata is not installable', async () => {
    const service = createSkillMarketService({
      fetchImpl: async () => Response.json(SKILLHUB_TOP_SKILLS_RESPONSE),
      installedSkillNames: new Set(),
    })

    const detail = await service.getDetail({ source: 'skillhub', slug: 'skill-vetter' })

    expect(detail).toMatchObject({
      source: 'skillhub',
      slug: 'skill-vetter',
      trustState: 'unknown',
      installed: false,
      files: [],
      riskLabels: [],
      installEligibility: {
        status: 'blocked',
        reason: expect.stringContaining('missing or inconclusive'),
      },
    })
  })
})

describe('skill market risk analysis', () => {
  it('detects allowed tools, hooks, scripts, executables, network, and api key labels in fixed order', () => {
    const risk = analyzeSkillRisk({
      entryContent: [
        '---',
        'description: Test',
        'allowed-tools: Bash, Read',
        'hooks:',
        '  PreToolUse: ./scripts/check.sh',
        '---',
        '',
        'This skill calls https://api.example.com and requires an API key.',
      ].join('\n'),
      files: [
        { path: 'SKILL.md' },
        { path: 'scripts/check.sh' },
        { path: 'bin/run' },
      ],
      requiresApiKey: true,
    })

    expect(risk).toEqual([
      'allowed-tools',
      'hooks',
      'scripts',
      'executables',
      'external-network',
      'requires-api-key',
    ])
  })

  it('normalizes Windows paths before detecting scripts and executables', () => {
    const risk = analyzeSkillRisk({
      files: [
        { path: 'scripts\\install.ps1' },
      ],
    })

    expect(risk).toEqual(['scripts', 'executables'])
  })

  it('detects API-key risk from token wording without requiresApiKey', () => {
    const risk = analyzeSkillRisk({
      entryContent: 'Set the service token before using this skill.',
      files: [],
      requiresApiKey: false,
    })

    expect(risk).toEqual(['requires-api-key'])
  })

  it('does not treat similarly named fields as allowed tools or hooks', () => {
    const risk = analyzeSkillRisk({
      entryContent: [
        '---',
        'disallowed-tools: Bash',
        'webhooks: https://example.com/callback',
        '---',
      ].join('\n'),
      files: [],
    })

    expect(risk).toEqual(['external-network'])
  })

  it('returns an empty array when no conservative risks are detected', () => {
    const risk = analyzeSkillRisk({
      entryContent: 'A local-only skill with no special permissions.',
      files: [{ path: 'SKILL.md' }],
    })

    expect(risk).toEqual([])
  })
})

describe('skill market API', () => {
  afterEach(() => {
    resetSkillMarketServiceFactoryForTests()
  })

  it('rejects unsupported methods', async () => {
    const url = new URL('/api/skill-market', 'http://localhost:3456')
    const req = new Request(url, { method: 'DELETE' })

    const res = await handleSkillMarketApi(req, url, ['api', 'skill-market'])

    expect(res.status).toBe(405)
  })

  it('rejects install requests with target paths', async () => {
    const url = new URL('/api/skill-market/install', 'http://localhost:3456')
    const req = new Request(url, {
      method: 'POST',
      body: JSON.stringify({ source: 'clawhub', slug: 'skill-vetter', targetPath: '/tmp/escape' }),
    })

    const res = await handleSkillMarketApi(req, url, ['api', 'skill-market', 'install'])

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'target_path_not_allowed' })
  })

  it('returns install skeleton response for safe install requests', async () => {
    const url = new URL('/api/skill-market/install', 'http://localhost:3456')
    const req = new Request(url, {
      method: 'POST',
      body: JSON.stringify({ source: 'clawhub', slug: 'skill-vetter' }),
    })

    const res = await handleSkillMarketApi(req, url, ['api', 'skill-market', 'install'])

    expect(res.status).toBe(501)
    await expect(res.json()).resolves.toMatchObject({ error: 'install_not_wired' })
  })

  it('rejects invalid install JSON', async () => {
    const url = new URL('/api/skill-market/install', 'http://localhost:3456')
    const req = new Request(url, {
      method: 'POST',
      body: '{not-json',
    })

    const res = await handleSkillMarketApi(req, url, ['api', 'skill-market', 'install'])

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_json' })
  })

  it('returns detail route responses from the service', async () => {
    let capturedParams: unknown
    setSkillMarketServiceFactoryForTests(() => ({
      list: async () => {
        throw new Error('list should not be called by detail route')
      },
      listSkills: async () => {
        throw new Error('listSkills should not be called by detail route')
      },
      getDetail: async (params) => {
        capturedParams = params
        return {
          source: 'clawhub',
          sourceMode: 'primary',
          slug: 'skill-vetter',
          displayName: 'Skill Vetter',
          summary: 'Reviews skill packages before install.',
          canonicalUrl: 'https://clawhub.ai/skill-vetter',
          trustState: 'clean',
          installed: false,
          files: [],
          riskLabels: [],
          installEligibility: { status: 'installable' },
        }
      },
    }))
    const url = new URL('/api/skill-market/clawhub/%73kill-vetter', 'http://localhost:3456')
    const req = new Request(url, { method: 'GET' })

    const res = await handleSkillMarketApi(req, url, ['api', 'skill-market', 'clawhub', '%73kill-vetter'])

    expect(res.status).toBe(200)
    expect(capturedParams).toEqual({
      source: 'clawhub',
      slug: 'skill-vetter',
    })
    await expect(res.json()).resolves.toMatchObject({
      detail: {
        source: 'clawhub',
        slug: 'skill-vetter',
        files: [],
        riskLabels: [],
        installEligibility: { status: 'installable' },
      },
    })
  })

  it('rejects unsupported detail sources', async () => {
    const url = new URL('/api/skill-market/auto/skill-vetter', 'http://localhost:3456')
    const req = new Request(url, { method: 'GET' })

    const res = await handleSkillMarketApi(req, url, ['api', 'skill-market', 'auto', 'skill-vetter'])

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'unsupported_source' })
  })

  it('returns 404 for detail requests with missing slugs', async () => {
    const url = new URL('/api/skill-market/clawhub', 'http://localhost:3456')
    const req = new Request(url, { method: 'GET' })

    const res = await handleSkillMarketApi(req, url, ['api', 'skill-market', 'clawhub'])

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  it('returns 404 when detail lookup misses the requested slug', async () => {
    setSkillMarketServiceFactoryForTests(() => ({
      list: async () => {
        throw new Error('list should not be called by detail route')
      },
      listSkills: async () => {
        throw new Error('listSkills should not be called by detail route')
      },
      getDetail: async () => null,
    }))
    const url = new URL('/api/skill-market/skillhub/not-found', 'http://localhost:3456')
    const req = new Request(url, { method: 'GET' })

    const res = await handleSkillMarketApi(req, url, ['api', 'skill-market', 'skillhub', 'not-found'])

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  it('routes skill market requests through the API router without network access', async () => {
    mock.module('@whiskeysockets/baileys', () => ({
      DisconnectReason: { loggedOut: 401 },
      fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
      makeCacheableSignalKeyStore: () => ({}),
      makeWASocket: () => ({ ev: { on: () => {} }, ws: { on: () => {} } }),
      useMultiFileAuthState: async () => ({
        state: { creds: {}, keys: {} },
        saveCreds: async () => {},
      }),
    }))
    const { handleApiRequest } = await import('../router.js')
    const url = new URL('/api/skill-market?source=unsupported', 'http://localhost:3456')

    const res = await handleApiRequest(new Request(url, { method: 'GET' }), url)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'unsupported_source' })
  })

  it('lists through the service with validated query params', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-market-api-'))
    const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    let capturedParams: unknown
    let installedNamesFromProvider: string[] = []

    try {
      const configDir = path.join(tmpDir, '.claude')
      const userSkillDir = path.join(configDir, 'skills', 'skill-vetter')
      await fs.mkdir(userSkillDir, { recursive: true })
      await fs.writeFile(
        path.join(userSkillDir, 'SKILL.md'),
        [
          '---',
          'name: Skill Vetter',
          'description: Reviews skill packages before install.',
          '---',
          '',
          'Review skills before installing them.',
        ].join('\n'),
        'utf-8',
      )
      process.env.CLAUDE_CONFIG_DIR = configDir

      setSkillMarketServiceFactoryForTests((options) => {
        return {
          list: async (params) => {
            capturedParams = params
            const installedSkillNames = await (
              options.installedSkillNames as (() => Set<string> | Promise<Set<string>>) | undefined
            )?.()
            installedNamesFromProvider = [...(installedSkillNames ?? new Set<string>())]
            return {
              items: [],
              nextCursor: null,
              source: 'skillhub',
              sourceStatus: 'ok',
            }
          },
          listSkills: async (params) => {
            capturedParams = params
            const installedSkillNames = await (
              options.installedSkillNames as (() => Set<string> | Promise<Set<string>>) | undefined
            )?.()
            installedNamesFromProvider = [...(installedSkillNames ?? new Set<string>())]
            return {
              items: [],
              nextCursor: null,
              source: 'skillhub',
              sourceStatus: 'ok',
            }
          },
          getDetail: async () => null,
        }
      })
      const url = new URL('/api/skill-market?source=skillhub&sort=updated&q=vetter&cursor=abc&limit=12', 'http://localhost:3456')
      const req = new Request(url, { method: 'GET' })

      const res = await handleSkillMarketApi(req, url, ['api', 'skill-market'])

      expect(res.status).toBe(200)
      expect(installedNamesFromProvider).toContain('skill-vetter')
      expect(capturedParams).toEqual({
        source: 'skillhub',
        sort: 'updated',
        query: 'vetter',
        cursor: 'abc',
        limit: 12,
      })
    } finally {
      if (originalConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalConfigDir
      }
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

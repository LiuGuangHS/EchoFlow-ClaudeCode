#!/usr/bin/env bun
/**
 * Conflict map for a sync PR.
 *
 * Recomputes what GitHub computes when the PR opens — `git merge-tree` between the
 * PR's base and head — and renders the conflict-matrix template from
 * `docs/internals/contributing.md` with one row per conflicting file. Read-only:
 * no resolution, no staging, no push. The matrix decisions stay with the
 * maintainer, as AGENTS.md "Upstream Sync Direction" requires.
 *
 * Unlike `upstream:check`, this probes the PR head rather than the upstream
 * release commit, so the map tracks resolution progress as the PR updates.
 * `--previous` points at the previously rendered map; decisions already filled
 * into it are carried forward instead of being overwritten by the re-render.
 *
 * Usage:
 *   bun run scripts/upstream/pr-conflict-map.ts --base origin/main --head <sha> [--out map.md] [--previous old-map.md]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { git } from './sync'
import {
  areaOf,
  decisionFor,
  parseSyncPolicy,
  parseMergeTreeConflicts,
  type FileDecision,
  type SyncPolicy,
} from './sync-plan'

const MARKER = '<!-- upstream-conflict-map -->'

/**
 * The policy lives beside the script, not in the caller's working directory: the
 * conflict probe runs this file with `cwd` set to a throwaway repository, so a
 * CWD-relative path would only work for a maintainer at the repo root.
 */
const POLICY_PATH = path.join(import.meta.dir, 'sync-policy.json')

function loadSyncPolicy(): SyncPolicy {
  return parseSyncPolicy(readFileSync(POLICY_PATH, 'utf8'))
}

/** The matrix's pre-filled decision for a file, or empty when the maintainer decides. */
function prefillFor(file: string, policy: SyncPolicy): string {
  switch (decisionFor(file, policy)) {
    case 'fork-brand-with-upstream-logic':
      return 'ours（品牌类）'
    case 'manual':
      return 'manual（provider 政策）'
    default:
      return ''
  }
}

/** Lists every path the policy pins to a decision, for the rendered footer. */
function policyFiles(policy: SyncPolicy, decision: FileDecision): string {
  return Object.entries(policy.fileDecisions)
    .filter(([, recorded]) => recorded === decision)
    .map(([file]) => `\`${file}\``)
    .join('、')
}

/**
 * Reads decisions already filled into a previously rendered map.
 *
 * The map is re-rendered on every push, so without this the maintainer loses every
 * decision they typed the moment they resolve the first file and push. Re-using the
 * recorded decision is safe because the decision belongs to the file, and a file
 * that no longer conflicts simply stops appearing.
 */
export function parseCarriedDecisions(markdown: string): Map<string, { decision: string; command: string }> {
  const carried = new Map<string, { decision: string; command: string }>()

  for (const line of markdown.split(/\r?\n/)) {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())

    // | `file` | decision | validating command |
    if (cells.length !== 3) {
      continue
    }

    const file = cells[0].match(/^`(.+)`$/)?.[1]

    if (!file || cells[1] === '') {
      continue
    }

    carried.set(file, { decision: cells[1], command: cells[2] })
  }

  return carried
}

export function formatConflictMap(input: {
  base: string
  head: string
  files: string[]
  carried?: Map<string, { decision: string; command: string }>
}): string {
  const { base, head, files, carried } = input
  // Shorten commit ids for the header; a ref name must survive intact or the
  // map blames "refs/remotes" instead of the branch it actually probed.
  const shortHead = /^[0-9a-f]{7,}$/.test(head) ? head.slice(0, 12) : head

  if (files.length === 0) {
    return [
      MARKER,
      '## 同步 PR 冲突地图',
      '',
      `\`${base}\` 与 \`${shortHead}\` 之间**没有冲突**，可以进入评审。`,
      '',
      '合并前仍按 `AGENTS.md`「Upstream Sync Direction」审计公开身份：README、文档、release notes、包元数据、诊断导出、签名/隐私页面、更新链接，以及桌面端「关于」/个人资料默认值，都不能把 NanmiCoder/阿江 或 `cc-haha` 写成当前 EchoFlow 的作者、维护者、联系人或产品。',
      '',
    ].join('\n')
  }

  const policy = loadSyncPolicy()

  const counts = new Map<string, number>()
  for (const file of files) {
    const area = areaOf(file)
    counts.set(area, (counts.get(area) ?? 0) + 1)
  }

  const areaRows = [...counts.entries()]
    .sort(([areaA, countA], [areaB, countB]) => countB - countA || areaA.localeCompare(areaB))
    .map(([area, count]) => `| ${area} | ${count} |`)

  // Sorted so the matrix does not reshuffle between updates; brand and policy
  // files arrive pre-decided, the rest wait for the maintainer.
  const fileRows = [...files]
    .sort()
    .map((file) => {
      // A decision the maintainer already recorded wins over the pre-fill: re-deciding
      // it would silently roll their work back on the next push.
      const previous = carried?.get(file)
      const decision = previous?.decision || prefillFor(file, policy)
      return `| \`${file}\` | ${decision} | ${previous?.command ?? ''} |`
    })

  return [
    MARKER,
    '## 同步 PR 冲突地图',
    '',
    `\`${base}\` 与 \`${shortHead}\` 之间共 **${files.length}** 个冲突文件。`,
    '',
    '| 区域 | 文件数 |',
    '| --- | --- |',
    ...areaRows,
    '',
    '<details>',
    `<summary>冲突矩阵模板（${files.length} 个文件，逐行填写后一轮解决）</summary>`,
    '',
    '| 文件 | 决策 | 验证命令 |',
    '| --- | --- | --- |',
    ...fileRows,
    '',
    '</details>',
    '',
    // The file lists come from the policy too, so editing sync-policy.json cannot
    // leave this footer naming files the matrix no longer pre-decides.
    `裁决规则见 \`AGENTS.md\`「Upstream Sync Direction」与 \`docs/internals/contributing.md\` 冲突矩阵：品牌类文件（${policyFiles(policy, 'fork-brand-with-upstream-logic')}）判 \`ours\`，并单独确认上游逻辑是否需要一并带走；${policyFiles(policy, 'manual')} 永远 \`manual\`，逐条按 provider 政策裁定；**禁止 blanket \`--ours\`/\`--theirs\`**，混合文件逐 hunk / 逐字段取舍；上游 release note 文件在归并完成后删除。`,
    '',
  ].join('\n')
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string>()

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (!arg.startsWith('--')) {
      continue
    }

    const next = argv[index + 1]

    if (next && !next.startsWith('--')) {
      args.set(arg, next)
      index += 1
    } else {
      args.set(arg, 'true')
    }
  }

  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const base = args.get('--base') ?? 'main'
  const head = args.get('--head') ?? 'HEAD'
  const out = args.get('--out')
  const previous = args.get('--previous')

  // Probing the repository the caller is standing in, not the checkout this file
  // happens to live in: a sync campaign runs in its own worktree, and a map that
  // silently fell back to the main checkout would report the wrong history. It is
  // also what keeps an unresolvable ref a local failure instead of a network fetch
  // against whatever remote the script's own repository has configured.
  const result = git(['merge-tree', '--write-tree', '--name-only', base, head], {
    allowFailure: true,
    cwd: process.cwd(),
  })
  const files = result.ok ? [] : parseMergeTreeConflicts(result.output)

  // A non-zero exit with no conflict list is not a clean merge: it is Git refusing
  // to merge these two at all (unresolvable ref, unrelated histories, missing
  // object in a partial clone). Rendering that as "没有冲突，可以进入评审" told the
  // maintainer a conflicting PR was ready for review — the exact false all-clear
  // this map exists to prevent, so it fails loudly instead.
  if (!result.ok && files.length === 0) {
    const reason = result.stderr || `git merge-tree exited non-zero without reporting conflicts`
    console.error(
      [
        `Cannot compute the conflict map between \`${base}\` and \`${head}\`.`,
        '',
        reason,
        '',
        'This is not a verdict: the merge was never evaluated, so the conflict count is',
        'unknown. Check that both refs exist locally (fetch them if needed) and re-run.',
      ].join('\n'),
    )
    process.exit(1)
  }

  const markdown = formatConflictMap({
    base,
    head,
    files,
    carried: previous ? parseCarriedDecisions(readFileSync(previous, 'utf8')) : undefined,
  })

  if (out) {
    writeFileSync(out, markdown)
    console.log(`Wrote ${out} (${files.length} conflicting file(s)).`)
  } else {
    console.log(markdown)
  }
}

// Guarded so tests can import the formatter without probing a repository.
if (import.meta.main) {
  main()
}

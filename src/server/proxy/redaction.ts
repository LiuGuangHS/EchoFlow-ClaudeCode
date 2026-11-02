import { createHmac, randomBytes } from 'node:crypto'
import type { LocalRedactionSettings } from '../../shared/localRedactionSettings.js'

type RedactionResult = { text: string; values: Map<string, string> }

const PLACEHOLDER = /\{\{[A-Z][A-Z0-9_]*_[a-z2-7]{8}\}\}/g
const PLACEHOLDER_SPLIT = /(\{\{[A-Z][A-Z0-9_]*_[a-z2-7]{8}\}\})/

/** Run a replacement pass only on text outside placeholders, so a later rule
 * (custom words, PASSWORD) cannot rewrite a token an earlier pass inserted. */
function replaceOutsidePlaceholders(text: string, replace: (segment: string) => string): string {
  return text.split(PLACEHOLDER_SPLIT).map((part, index) => index % 2 === 1 ? part : replace(part)).join('')
}
const STRUCTURAL_KEYS = /^(?:model|type|role|tool_call_id|tool_use_id|signature|media_type|mime_type|content_type)$/i

function isStructuralField(field: string, parent: Record<string, unknown> | undefined, path: readonly string[]): boolean {
  if (field.toLowerCase() === 'model') return path.length === 1
  if (STRUCTURAL_KEYS.test(field)) return true
  if (field.toLowerCase() === 'name') {
    return parent?.input_schema !== undefined
      || ['tool_use', 'server_tool_use', 'function_call'].includes(String(parent?.type))
  }
  if (field.toLowerCase() === 'id') {
    return ['tool_use', 'server_tool_use', 'function_call', 'message', 'reasoning'].includes(String(parent?.type))
      || parent?.call_id !== undefined
  }
  return false
}
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['PRIVATE_KEY', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['API_KEY', /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|xapp-[A-Za-z0-9-]{16,}|npm_[A-Za-z0-9]{20,}|dop_v1_[A-Za-z0-9]{20,}|doo_v1_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}|ABIA[A-Z0-9]{16}|ACCA[A-Z0-9]{16}|hf_[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9_-]{20,})\b/g],
  ['PASSWORD', /(?<=\b(?:passwd|token|api[_-]?key|secret|credential)\s*[=:]\s*)(?:"[^"]{4,}"|'[^']{4,}'|[^\s,;'"]{4,})/gi],
  ['PASSWORD', /(?<=\b[a-z0-9._%+-]+:)[^@\s]{4,}(?=@)/gi],
]

function passesLuhn(digits: string): boolean {
  let sum = 0
  for (let i = digits.length - 1, parity = 0; i >= 0; i--, parity++) {
    let digit = Number(digits[i])
    if (parity % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9 }
    sum += digit
  }
  return sum % 10 === 0
}

function validChineseId(id: string): boolean {
  if (!/^\d{17}[\dXx]$/i.test(id)) return false
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = '10X98765432'
  const sum = weights.reduce((total, weight, index) => total + Number(id[index]) * weight, 0)
  return checks[sum % 11] === id[17]?.toUpperCase()
}

function placeholder(kind: string, value: string, key: string): string {
  const digest = createHmac('sha256', key).update(`${kind}\0${value}`).digest()
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  let bits = 0
  let buffer = 0
  let encoded = ''
  for (const byte of digest) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5 && encoded.length < 8) {
      encoded += alphabet[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
    if (encoded.length === 8) break
  }
  return `{{${kind}_${encoded}}}`
}

export function redactText(text: string, settings: LocalRedactionSettings, key = randomBytes(32).toString('hex')): RedactionResult {
  const values = new Map<string, string>()
  if (!settings.enabled) return { text, values }
  let result = text
  for (const [kind, pattern] of SECRET_PATTERNS) {
    result = replaceOutsidePlaceholders(result, segment => segment.replace(pattern, match => {
      const token = placeholder(kind, match, key)
      values.set(token, match)
      return token
    }))
  }
  if (settings.personalInfo) {
    for (const [kind, pattern] of [
      ['EMAIL', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
      ['PHONE', /(?<!\d)1[3-9]\d{9}(?!\d)/g],
      ['CN_ID', /(?<!\d)\d{17}[\dXx](?!\d)/g],
      ['BANK_CARD', /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g],
    ] as Array<[string, RegExp]>) {
      result = replaceOutsidePlaceholders(result, segment => segment.replace(pattern, match => {
        const digits = match.replace(/\D/g, '')
        if (kind === 'BANK_CARD' && !passesLuhn(digits)) return match
        if (kind === 'CN_ID' && !validChineseId(match)) return match
        const token = placeholder(kind, match, key)
        values.set(token, match)
        return token
      }))
    }
  }
  for (const word of settings.customWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = replaceOutsidePlaceholders(result, segment => segment.replace(
      new RegExp(escaped, 'gi'),
      match => { const token = placeholder('TERM', match, key); values.set(token, match); return token },
    ))
  }
  return { text: result, values }
}

export function redactJson(value: unknown, settings: LocalRedactionSettings, key = randomBytes(32).toString('hex')): RedactionResult {
  const values = new Map<string, string>()
  const walk = (node: unknown, field = '', opaqueAttachment = false, parent?: Record<string, unknown>, path: readonly string[] = []): unknown => {
    if (typeof node === 'string') {
      if (isStructuralField(field, parent, path) || opaqueAttachment || /^(?:image_url)$/i.test(field) || /^(?:data|url)$/i.test(field) && (node.startsWith('data:') || node.length > 1024)) return node
      const result = redactText(node, settings, key)
      for (const [token, original] of result.values) values.set(token, original)
      return result.text
    }
    if (Array.isArray(node)) return node.map(item => walk(item, field, opaqueAttachment, parent, path))
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>
      const mediaSource = opaqueAttachment
        || /^(?:image_url)$/i.test(field)
        || /^(?:source)$/i.test(field) && record.type === 'url'
      return Object.fromEntries(Object.entries(record).map(([name, child]) => [name, walk(child, name, mediaSource, record, [...path, name])]))
    }
    return node
  }
  return { text: JSON.stringify(walk(value)), values }
}

export function restoreText(
  text: string,
  values: Map<string, string>,
  encode: (value: string) => string = value => value,
): string {
  return text.replace(/\{\{\s*([A-Z][A-Z0-9_]*)_([a-z2-7]{8})\s*\}\}/gi, (whole, kind: string, hash: string) => {
    const canonical = `{{${kind.toUpperCase()}_${hash.toLowerCase()}}}`
    const original = values.get(canonical)
    return original === undefined ? whole : encode(original)
  })
}

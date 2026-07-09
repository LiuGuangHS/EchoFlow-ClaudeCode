import type { NormalizedSkill } from '../../types/market'

/** Deterministic hue from a string so every skill keeps a stable identity color. */
function hashHue(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 360
}

/** First visible character of the name, uppercased (handles CJK and multi-byte chars). */
function initialOf(name: string): string {
  const first = Array.from(name.trim())[0]
  return first ? first.toUpperCase() : '?'
}

/**
 * Skill icon with a deterministic letter-avatar fallback.
 * Upstream sources rarely provide `iconUrl`, so the fallback carries the
 * visual identity: same skill name → same color + initial, every render.
 */
export function SkillAvatar({
  skill,
  size = 40,
  className = '',
}: {
  skill: Pick<NormalizedSkill, 'name' | 'iconUrl'>
  size?: number
  className?: string
}) {
  if (skill.iconUrl) {
    return (
      <img
        src={skill.iconUrl}
        alt=""
        loading="lazy"
        style={{ width: size, height: size }}
        className={`flex-shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container)] object-cover ${className}`}
      />
    )
  }
  const hue = hashHue(skill.name)
  return (
    <span
      aria-hidden
      data-testid="skill-avatar-fallback"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
        background: `linear-gradient(135deg, hsl(${hue} 68% 52%), hsl(${(hue + 28) % 360} 64% 38%))`,
      }}
      className={`inline-flex flex-shrink-0 select-none items-center justify-center rounded-xl font-semibold text-white ${className}`}
    >
      {initialOf(skill.name)}
    </span>
  )
}

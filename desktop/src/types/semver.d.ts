declare module 'semver' {
  export function gt(left: string, right: string): boolean
  export function valid(version: string): string | null
}

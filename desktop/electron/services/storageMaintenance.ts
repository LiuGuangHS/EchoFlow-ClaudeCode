// UI-side writer freeze. Cross-process exclusion is owned by the shared
// transaction and the host-lifetime lease acquired before Chromium startup.
let frozen = false

export function setStorageWritesFrozen(value: boolean): void {
  frozen = value
}

export function areStorageWritesFrozen(): boolean {
  return frozen
}

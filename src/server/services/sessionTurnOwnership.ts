export class SessionTurnOwnership<T extends object> extends Map<string, T> {
  release(sessionId: string, owner: T): boolean {
    if (this.get(sessionId) !== owner) return false
    return this.delete(sessionId)
  }
}

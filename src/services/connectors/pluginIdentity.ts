export const CONNECTOR_MARKETPLACE = 'echoflow-connectors'
export const LEGACY_CONNECTOR_MARKETPLACE = 'haha-connectors'

// Structural validation only; the bridge verifies legacy marketplace ownership
// before binding an installed connector to that identity.
export function connectorPluginName(definition: { id: string, pluginId: string }): string {
  const name = `office-${definition.id}`
  if (!/^[a-z][a-z0-9-]*$/.test(definition.id) || ![CONNECTOR_MARKETPLACE, LEGACY_CONNECTOR_MARKETPLACE].some(marketplace => definition.pluginId === `${name}@${marketplace}`)) {
    throw new Error('Invalid managed connector plugin identity')
  }
  return name
}

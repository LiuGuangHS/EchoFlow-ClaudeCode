import { expect, test } from 'bun:test'
import { lanesForMode } from '../quality-gate/modes'
import { evaluateChangePolicy } from './change-policy'
import { localCheckCommands } from './local-checks'

test('local argv mapping covers every impact-required PR command, without unconditional governance lanes', () => {
  const { checks } = evaluateChangePolicy([
    'package.json', 'desktop/src/view.test.tsx', 'src/server/ws/events.test.ts',
    'src/server/services/providerService.test.ts', 'adapters/fixture.test.ts',
    'src/server/__tests__/persistence-upgrade.test.ts',
  ])
  expect(Object.values(checks).every(Boolean)).toBe(true)
  const commands = localCheckCommands(checks).map(command => command.join(' '))
  const required = lanesForMode('pr')
    .filter(lane => lane.impactRequiredCheck && lane.requiredForModes.includes('pr'))
    .map(lane => lane.impactRequiredCheck!)
  expect([...commands].sort()).toEqual(required.sort())
  expect(commands[0]).toBe('bun run check:policy')
  expect(commands.at(-1)).toBe('bun run check:coverage')
  expect(localCheckCommands(evaluateChangePolicy([]).checks)).toEqual([])
})

test('coverage remains separately selectable so check:pr can explicitly exclude it', () => {
  const checks = { ...evaluateChangePolicy([]).checks, coverage: true }
  expect(localCheckCommands(checks)).toEqual([['bun', 'run', 'check:coverage']])
  expect(localCheckCommands({ ...checks, coverage: false })).toEqual([])
})

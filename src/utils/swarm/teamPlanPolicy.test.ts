import { afterEach, describe, expect, test } from 'bun:test'
import { getTeamLeaderRuntime, isTeamReviewRequired } from './teamPlanPolicy.js'

const original = {
  required: process.env.ECHOFLOW_TEAM_REVIEW_REQUIRED,
  runtime: process.env.ECHOFLOW_TEAM_LEADER_RUNTIME,
}
afterEach(() => {
  for (const [key, value] of Object.entries({
    ECHOFLOW_TEAM_REVIEW_REQUIRED: original.required,
    ECHOFLOW_TEAM_LEADER_RUNTIME: original.runtime,
  })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('desktop team policy', () => {
  test('requires the desktop launch policy, not a tool preference', () => {
    delete process.env.ECHOFLOW_TEAM_REVIEW_REQUIRED
    expect(isTeamReviewRequired()).toBe(false)
    process.env.ECHOFLOW_TEAM_REVIEW_REQUIRED = '1'
    expect(isTeamReviewRequired()).toBe(true)
  })

  test('preserves provider identity and the leader effort without changing the environment', () => {
    const runtime = JSON.stringify({ providerId: 'fixture-provider', modelId: 'fixture-model', effortLevel: 'high' })
    process.env.ECHOFLOW_TEAM_LEADER_RUNTIME = runtime
    expect(getTeamLeaderRuntime('')).toEqual({ providerId: 'fixture-provider', modelId: 'fixture-model', effortLevel: 'high' })
    expect(getTeamLeaderRuntime('changed-in-session').modelId).toBe('changed-in-session')
    expect(process.env.ECHOFLOW_TEAM_LEADER_RUNTIME).toBe(runtime)
  })

  test('fails closed instead of guessing a provider', () => {
    for (const runtime of ['null', '{}', 'bad-json', '{"providerId":""}']) {
      process.env.ECHOFLOW_TEAM_LEADER_RUNTIME = runtime
      expect(() => getTeamLeaderRuntime('fixture-model')).toThrow()
    }
  })
})

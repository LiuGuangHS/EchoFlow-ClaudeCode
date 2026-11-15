import { expect, test } from 'bun:test'
import { PRODUCT_NAME } from '../../src/utils/productIdentity.generated'
import { ECHOFLOW_PRODUCT_NAME } from './brand'

test('adapter product name consumes the shared product identity', () => {
  expect(ECHOFLOW_PRODUCT_NAME).toBe(PRODUCT_NAME)
})

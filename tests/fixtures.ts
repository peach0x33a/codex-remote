import { test as base } from '@playwright/test'
import { TEST_URL } from './config'
export { expect, type Page, type APIRequestContext, type Locator } from '@playwright/test'

// All browser contexts share server metadata now. Isolate test cases at that boundary.
export const test = base.extend<{ cleanProfiles: void }>({
  cleanProfiles: [async ({ request }, use) => {
    const headers = { Origin: TEST_URL }
    const response = await request.get(TEST_URL + '/api/profiles', { headers })
    if (!response.ok()) throw new Error('Cannot reset isolated e2e profile store: ' + response.status())
    const { profiles } = await response.json()
    for (const profile of profiles) {
      const removed = await request.delete(TEST_URL + '/api/profiles', { headers, data: { id: profile.id } })
      if (!removed.ok()) throw new Error('Cannot remove isolated e2e device')
    }
    await use()
  }, { auto: true }],
})

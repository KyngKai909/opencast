// The mock API's access token (`npm run dev:mock`): "mock-access-token:<email>", so the mock
// handlers know who's signed in. Its own module, so the app's bundle doesn't pull in the mocks.
export const MOCK_TOKEN_PREFIX = "mock-access-token:";

export function mockTokenFor(email: string): string {
  return `${MOCK_TOKEN_PREFIX}${email.trim().toLowerCase()}`;
}

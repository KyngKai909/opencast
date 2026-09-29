// The mock API's access token (`npm run dev:mock`): "mock-access-token:<email>", so the mock
// handlers know who's signed in (src/mocks/people.ts). Its own module, so the app's bundle doesn't
// pull in the mocks for it.
export const MOCK_TOKEN_PREFIX = "mock-access-token:";

export function mockTokenFor(email: string): string {
  return `${MOCK_TOKEN_PREFIX}${email.trim().toLowerCase()}`;
}

/** Kai M.'s token: the viewer's tests sign in as the reference's person. */
export const MOCK_TOKEN = `${MOCK_TOKEN_PREFIX}kai@example.com`;

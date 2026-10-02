// The mock API's access token (`npm run dev:mock`), shared by the mock sign-in and the mock
// handlers. Its own module, so the app's bundle doesn't pull in the mock handlers for it.
export const MOCK_TOKEN = "mock-access-token";

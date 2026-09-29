// Master control's mock handlers answer through the app's shared helpers (src/mocks/respond.ts):
// who's signed in is the same person in every area.
export { fail, needsUser, path, personOf, reply } from "../../mocks/respond";

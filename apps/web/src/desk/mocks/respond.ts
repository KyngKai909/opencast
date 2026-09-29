// The desk's mock handlers answer through the app's shared helpers (src/mocks/respond.ts). Every
// desk endpoint is `auth: "admin"`: needsAdmin answers 401 signed out and 403 for anyone who isn't
// on the Opencast team.
export { bodyOf, fail, needsAdmin, needsUser, path, personOf, reply } from "../../mocks/respond";

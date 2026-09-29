// Where each area of the app lives. The viewer is at /, master control at /control and Network
// desk at /desk: one app, one session. Links between them (and inside master control and the desk)
// are built from these.

export const CONTROL = "/control";
export const DESK = "/desk";

/** A path in master control: controlPath("/beat/monitor") is "/control/beat/monitor". */
export const controlPath = (p = "") => `${CONTROL}${p}`;

/** A path in Network desk: deskPath("/held-earnings") is "/desk/held-earnings". */
export const deskPath = (p = "") => `${DESK}${p}`;

/** The area a path belongs to. */
export function areaOf(pathname: string): "viewer" | "control" | "desk" {
  if (pathname === CONTROL || pathname.startsWith(`${CONTROL}/`)) return "control";
  if (pathname === DESK || pathname.startsWith(`${DESK}/`)) return "desk";
  return "viewer";
}

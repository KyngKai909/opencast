// @opencast/player: the one player for the viewer app, TV mode and the Cast receiver.
// Import the styles once: import "@opencast/player/styles.css" (after @opencast/ui's).

export type { Channel, Command, CommandType, CommandSource } from "./types";
export { inChannelOrder, neighbour, neighbours, findByChannel, type NeighbourOptions } from "./dial";
export { readEntry, typeKey, noStationText, type NumberEntry } from "./numberEntry";
export { swipeOrder, orderIds, stepId, orderPlace, boundaryFrom, preloadIds, bandOf, type SwipeOrder, type OrderIds, type OrderDir, type OrderPlace, type Boundary, type Band } from "./order";
export { PlayerEngine, CAPTION_SCALE, captionLineFor, TUNING_SOUND_DEFAULTS, tuningSoundFrom, prefersReducedMotion, type TuningSound, type PlayerState, type EngineOptions, type CaptionMode, type CaptionSize, type Status, type TuneRecord } from "./engine/PlayerEngine";
export { Deck, SignedOffError, type WarmMode, type DeckWarmMode, type DeckState } from "./engine/Deck";
export { defaultDriver, hlsDriver, nativeDriver, JOIN_CONFIG, type MediaDriver, type MediaHandle, type AttachOptions, type PlaylistInfo, type Quality } from "./engine/driver";
export { dashSupport, dashJsDriver, nativeDashDriver, defaultDashDriver, loadDashJs, dashJsLoads, dashAbr, isDash, DASH_EVENTS, type DashSupport, type DashAbr, type DashPlayer, type DashJsModule } from "./engine/dash";
export { directLoader, directUrlOf, interceptTransport, DIRECT_URL_HEADER, type DirectTransport, type DirectLoad } from "./engine/direct";
export { onScreenAt, mergeRanges, signOffIn, CODE_SECONDS, type OnScreen } from "./engine/timeline";
export { Prefetch, loadMedia, isLive, mediaPlaylist, variants, pictureVariants, startVariant, syncSegment, type Fetch, type MediaPlaylist, type Variant } from "./engine/playlist";
export * as tuningTimes from "./tuning/constants";
export { tuningStyle } from "./tuning/constants";
export { ChannelChange, minimumFor, clearingFor, type TuningState, type TuningLook, type TuningPhase } from "./tuning/change";
export { bandPercent, frequencyOf, needleAt, sweepDistance, type Sweep } from "./tuning/sweep";
export { hissAllowed, type HissGate } from "./tuning/hiss";
export { startHeartbeat, httpHeartbeat, sessionId, type SendHeartbeat, type HeartbeatBody } from "./heartbeat";
export * from "./input";
export * from "./react";

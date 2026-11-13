// Everything presence needs once you share, in one lazy chunk: the sync and the avatar row.
// app/presenceFlow.ts imports this with import(), so none of it is in the initial bundle.
export { PresenceSync, anonymousName, colorForPeer, lightColor } from './presence';
export { createPresenceBar } from '../ui/presenceBar';

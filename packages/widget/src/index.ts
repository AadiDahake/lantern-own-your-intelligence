// Public surface of the package, for anyone importing it rather than embedding
// the built bundle.
export { ApiClient } from './api/client';
export { SseDecoder, toChatEvent } from './api/sse';
export { scanAffordances } from './scan/affordances';
export type { ScanResult, ScanOptions } from './scan/affordances';
export { rank, scoreCandidate, tokenize } from './scan/rank';
export { GuideMachine } from './guide/machine';
export type { GuideDeps, GuideSnapshot, GuideState } from './guide/machine';
export { Spotlight } from './guide/spotlight';
export { onNavigate, onDomSettle, watchPage } from './guide/navigation';
export { VoiceRecorder } from './voice/recorder';
export { VoicePlayer } from './voice/player';
export { attachStyles, detectScheme, TOKEN_DEFAULTS } from './styles';
export type { LanternApi } from './ui/App';
export * from './types';

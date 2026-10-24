/** Source entry point for a separate Vite/React/TypeScript mobile-web frontend. No server imports. */
export {Phase3Client,Phase3ApiError,replayEvents,isReplayEcho} from '../shared/phase3-client';
export type {Overview,Suggestion,AnalysisStatus} from '../shared/phase3-client';
export type * from '../shared/phase3';
export type * from '../shared/evaluation';
export type {Turn,ProtocolEvent,SessionBootstrap} from '../shared/domain';
export {HiggsClient} from '../src/realtime/HiggsClient';
export type {ClientOptions,ConnectionState,Activity} from '../src/realtime/HiggsClient';
export {SessionRecorder} from '../src/recording';
export {emptyConversation,reduceTranscript,orderedTurns} from '../shared/transcript';

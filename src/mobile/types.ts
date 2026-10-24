import type { Activity, ConnectionState, Overview, Suggestion, AnalysisStatus, RestoreQualification,
  TimelineNode, ComparisonResult } from '../../client';
import type { Scenario } from '../../shared/domain';

export interface SavedDate { id:string; scenarioId:string; activeBranchId:string; createdAt:number; }
export interface MobileState {
  loading:boolean;
  profile:Scenario|null;
  configured:boolean|null;
  qualification:RestoreQualification|null;
  conversations:SavedDate[];
  overview:Overview|null;
  branchId:string;
  nodes:TimelineNode[];
  connection:ConnectionState;
  activity:Activity;
  mic:boolean;
  level:number;
  operating:string|null;
  error:string|null;
  warning:string|null;
  suggestion:Suggestion|null;
  evaluation:AnalysisStatus|null;
  comparison:ComparisonResult|null;
}
export interface MobileActions {
  initialize():Promise<void>;
  create():Promise<string|null>;
  open(id:string):Promise<void>;
  refresh():Promise<void>;
  talk():Promise<void>;
  connect():Promise<void>;
  end():Promise<void>;
  rewind(targetUserTurnId:string):Promise<void>;
  selectBranch(branchId:string):Promise<void>;
  evaluate():Promise<void>;
  dismissSuggestion():Promise<void>;
  retryEvaluation():Promise<void>;
  dismissError():void;
  dispose():Promise<void>;
}
export interface DiscoverProps {state:MobileState;onProfile():void;onResume(id:string):void;onRefresh():void;}
export interface ProfileProps {state:MobileState;onBack():void;onStart():void;onResume(id:string):void;}
export interface ConversationProps {
  state:MobileState;
  onBack():void;
  onTalk():void;
  onEnd():void;
  onRewind(id:string):Promise<void>;
  onSelectBranch(id:string):void;
  onEvaluate():void;
  onDismissSuggestion():void;
  onRetryEvaluation():void;
  onDismissError():void;
}

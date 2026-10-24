import { z } from 'zod';
import { idSchema } from './phase3';
export const dimensions=['clarity','curiosity','reciprocity','boundaryRespect'] as const;
export type Dimension=typeof dimensions[number];
export const weights:Record<Dimension,number>={clarity:.30,curiosity:.25,reciprocity:.25,boundaryRespect:.20};
export const rubricVersion='communication-1';
export const anchors={counterproductive:0,limited:25,mixed:50,effective:75,consistent:100} as const;
export const rubric={
  clarity:'Concrete, understandable answers that address the question. Concision and uncertainty are allowed. Do not reward verbosity or confidence alone.',
  curiosity:'Relevant questions or explicit attempts to understand the other perspective. Do not require a question every turn or penalize reasonable disagreement.',
  reciprocity:'Responds to what the other person actually said and leaves room for exchange. Do not equate agreement, friendliness, or oversharing with reciprocity.',
  boundaryRespect:'Responds to an explicit stated limit or clear opportunity to respect one. Without an actual boundary opportunity this category is unavailable; do not award a perfect score for absence of conflict.',
};
export const evidenceSchema=z.strictObject({turnId:idSchema,quote:z.string().min(4).max(180)});
export const assessmentSchema=z.strictObject({anchor:z.enum(['counterproductive','limited','mixed','effective','consistent']).nullable(),
  confidence:z.number().min(0).max(1),evidence:z.array(evidenceSchema).max(6),explanation:z.string().min(1).max(400)});
export const evaluationSchema=z.strictObject({categories:z.strictObject({clarity:assessmentSchema,curiosity:assessmentSchema,
  reciprocity:assessmentSchema,boundaryRespect:assessmentSchema}),observation:z.string().min(1).max(400)});
export type ModelEvaluation=z.infer<typeof evaluationSchema>;
export const suggestionSchema=z.strictObject({targetTurnId:idSchema.nullable(),reason:z.string().min(1).max(240),
  significance:z.number().min(0).max(1),explorationPotential:z.number().min(0).max(1),confidence:z.number().min(0).max(1),evidence:z.array(evidenceSchema).max(4)});
export type ModelSuggestion=z.infer<typeof suggestionSchema>;
export interface CategoryResult {score:number|null;anchor:z.infer<typeof assessmentSchema>['anchor'];confidence:number;evidence:z.infer<typeof evidenceSchema>[];explanation:string;provisional:boolean;unavailableReason:string|null;}
export interface BranchEvaluation {branchId:string;revision:number;contentHash:string;overall:number|null;coverage:number;provisional:boolean;
  categories:Record<Dimension,CategoryResult>;observation:string;provider:string;model?:string;latencyMs:number;usage?:import('./characterState').TokenUsage;}
export interface ComparisonResult {schemaVersion:1;rubricVersion:string;sharedTurnIds:string[];forkTurnId:string|null;
  paths:BranchEvaluation[];insight:string;comparisonCaution:string;interpretation:'simulated assessment';}

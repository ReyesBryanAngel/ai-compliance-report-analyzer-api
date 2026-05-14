export { runKyc } from './kyc';
export type { KycThresholds } from './kyc';
export { runSg } from './sg';
export type { SgThresholds } from './sg';
export { runTraml } from './traml';
export type { TramlThresholds } from './traml';
export { runDocumentIntegrity } from './document-integrity';
export type { DocumentIntegrityThresholds } from './document-integrity';

export const SUPPORTED_WORKFLOWS = ['kyc', 'sg', 'traml', 'document-integrity'] as const;
export type SupportedWorkflow = (typeof SUPPORTED_WORKFLOWS)[number];

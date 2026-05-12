export { runKyc } from './kyc';
export type { KycThresholds } from './kyc';
export { runSg } from './sg';
export type { SgThresholds } from './sg';

export const SUPPORTED_WORKFLOWS = ['kyc', 'sg'] as const;
export type SupportedWorkflow = (typeof SUPPORTED_WORKFLOWS)[number];

export { runKyc } from './kyc';

export const SUPPORTED_WORKFLOWS = ['kyc'] as const;
export type SupportedWorkflow = (typeof SUPPORTED_WORKFLOWS)[number];

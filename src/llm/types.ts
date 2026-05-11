export interface FindingExplanation {
  checkpoint: string;
  explanation: string;
}

export interface LLMNarrative {
  executiveSummary: string;
  findingExplanations: FindingExplanation[];
  reviewerNotes: string;
}

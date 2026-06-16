export interface InstructionItem {
  id: string;
  workflow: string;
  scope: 'org' | 'global';
  version: number;
  title: string | null;
  content: string;
  isActive: boolean;
  createdBy: { id: string; name: string | null; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstructionBody {
  title?: string;
  content: string;
}

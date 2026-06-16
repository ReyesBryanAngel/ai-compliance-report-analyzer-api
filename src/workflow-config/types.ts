export interface WorkflowConfigItem {
  workflow: string;
  mode: 'checkpoints' | 'agent_skill';
  isDefault: boolean;
  updatedAt: string | null;
}

export interface SetWorkflowModeBody {
  mode: 'checkpoints' | 'agent_skill';
}

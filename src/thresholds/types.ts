export interface ThresholdConfigItem {
  id: string;
  workflow: string;
  checkpoint: string;
  checkpointId: string;
  greenMax: number;
  amberMax: number;
  params: Record<string, unknown> | null;
  updatedAt: string;
  isDefault: boolean;
}

export interface UpsertThresholdBody {
  greenMax: number;
  amberMax: number;
  params?: Record<string, unknown>;
}

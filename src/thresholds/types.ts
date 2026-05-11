export interface ThresholdConfigItem {
  id: string;
  workflow: string;
  checkpoint: string;
  checkpointId: string;
  greenMax: number;
  amberMax: number;
  updatedAt: string;
  isDefault: boolean;
}

export interface UpsertThresholdBody {
  greenMax: number;
  amberMax: number;
}

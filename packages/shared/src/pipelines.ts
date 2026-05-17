export interface PublicPipelineStage {
  id: string;
  name: string;
  orderIndex: number;
  winProbability: number | null;
  isWon: boolean;
  isLost: boolean;
}

export interface PublicPipeline {
  id: string;
  name: string;
  isDefault: boolean;
  stages: PublicPipelineStage[];
}

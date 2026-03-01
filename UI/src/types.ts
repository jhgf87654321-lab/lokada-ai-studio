export interface Material {
  id: number;
  name: string;
  type: string;
  description: string;
  thumbnail_url: string;
  texture_prompt: string;
}

export interface PartAnalysis {
  type: string;
  recommendedMaterials: string[];
  reasoning: string;
  exists: boolean;
}

export interface AnalysisResult {
  top: PartAnalysis;
  bottom: PartAnalysis;
  overallStyle: string;
}

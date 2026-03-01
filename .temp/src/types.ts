export interface Material {
  id: number;
  name: string;
  type: string;
  description: string;
  thumbnail_url: string;
  texture_prompt: string;
}

export interface AnalysisResult {
  clothingType: string;
  recommendedMaterials: string[];
  reasoning: string;
}

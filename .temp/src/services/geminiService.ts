import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AnalysisResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeClothing(base64Image: string): Promise<AnalysisResult> {
  const model = "gemini-3-flash-preview";
  
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image.split(",")[1],
            },
          },
          {
            text: "分析这件服装。识别服装类型（例如：夹克、连衣裙、裤子）并为其推荐3种合适的面料材质。以 JSON 格式返回结果。",
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          clothingType: { type: Type.STRING, description: "服装类型" },
          recommendedMaterials: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "推荐材质列表"
          },
          reasoning: { type: Type.STRING, description: "推荐理由" },
        },
        required: ["clothingType", "recommendedMaterials", "reasoning"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
}

export async function replaceMaterial(base64Image: string, materialPrompt: string, color?: string): Promise<string> {
  const model = "gemini-2.5-flash-image";
  
  const finalPrompt = color 
    ? `请将图中服装的材质替换为 ${color}色的${materialPrompt}。尽可能保持服装的形状和光影效果真实。`
    : `请将图中服装的材质替换为 ${materialPrompt}。尽可能保持服装的形状和光影效果真实。`;

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: base64Image.split(",")[1],
          },
        },
        {
          text: finalPrompt,
        },
      ],
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }

  throw new Error("No image generated");
}

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
            text: "分析图中人物的服装。将其分为“上装”(top)和“下装”(bottom)两部分分别分析。如果某部分不存在（例如只穿了连衣裙，连衣裙可归为上装，下装设为不存在），请在 exists 字段标明。为每一部分推荐3种合适的面料材质。以 JSON 格式返回结果。",
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          top: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, description: "上装类型" },
              recommendedMaterials: { type: Type.ARRAY, items: { type: Type.STRING }, description: "推荐材质" },
              reasoning: { type: Type.STRING, description: "推荐理由" },
              exists: { type: Type.BOOLEAN, description: "是否存在" }
            }
          },
          bottom: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, description: "下装类型" },
              recommendedMaterials: { type: Type.ARRAY, items: { type: Type.STRING }, description: "推荐材质" },
              reasoning: { type: Type.STRING, description: "推荐理由" },
              exists: { type: Type.BOOLEAN, description: "是否存在" }
            }
          },
          overallStyle: { type: Type.STRING, description: "整体风格" }
        },
        required: ["top", "bottom", "overallStyle"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
}

export interface ReplacementConfig {
  part: "top" | "bottom" | "both";
  topMaterial?: string;
  topColor?: string;
  bottomMaterial?: string;
  bottomColor?: string;
}

export async function replaceMaterial(base64Image: string, config: ReplacementConfig): Promise<string> {
  const model = "gemini-2.5-flash-image";
  
  let prompt = "";
  if (config.part === "top" || config.part === "both") {
    const colorStr = config.topColor ? `${config.topColor}色的` : "";
    prompt += `请将图中人物的“上装”材质替换为 ${colorStr}${config.topMaterial}。`;
  }
  if (config.part === "bottom" || config.part === "both") {
    const colorStr = config.bottomColor ? `${config.bottomColor}色的` : "";
    prompt += `请将图中人物的“下装”材质替换为 ${colorStr}${config.bottomMaterial}。`;
  }
  prompt += "尽可能保持服装的形状、褶皱和光影效果真实。";

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
          text: prompt,
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

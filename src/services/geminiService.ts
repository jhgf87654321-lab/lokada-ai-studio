import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types";

/** 将大图压缩为较小 data URL，减少请求体体积，避免请求过大或超时 */
async function compressImageForUpload(dataUrl: string, maxSizePx = 1200, quality = 0.82): Promise<string> {
  if (dataUrl.length < 1_200_000) return dataUrl; // 约 1.2MB 以下不压缩
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      let dw = w;
      let dh = h;
      if (w > maxSizePx || h > maxSizePx) {
        if (w >= h) {
          dw = maxSizePx;
          dh = Math.round((h * maxSizePx) / w);
        } else {
          dh = maxSizePx;
          dw = Math.round((w * maxSizePx) / h);
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = dw;
      canvas.height = dh;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, dw, dh);
      try {
        const out = canvas.toDataURL("image/jpeg", quality);
        resolve(out);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// 使用浏览器直接调用 Google Gemini（需要在环境中配置 GEMINI_API_KEY）
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// 直接调用 Gemini 进行服装分析（gemini-3-flash-preview）
export async function analyzeClothing(base64Image: string): Promise<AnalysisResult> {
  if (!ai) {
    throw new Error("Gemini 客户端未初始化，请检查 GEMINI_API_KEY 环境变量。");
  }

  const compressed = await compressImageForUpload(base64Image);
  const imageData = compressed.split(",")[1] || base64Image.split(",")[1];

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: imageData,
            },
          },
          {
            text:
              "分析图中人物的服装。将其分为“上装”(top)和“下装”(bottom)两部分分别分析。" +
              "如果某部分不存在（例如只穿了连衣裙，连衣裙可归为上装，下装设为不存在），请在 exists 字段标明。" +
              "为每一部分推荐3种合适的面料材质。以 JSON 格式返回结果。",
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
              exists: { type: Type.BOOLEAN, description: "是否存在" },
            },
          },
          bottom: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, description: "下装类型" },
              recommendedMaterials: { type: Type.ARRAY, items: { type: Type.STRING }, description: "推荐材质" },
              reasoning: { type: Type.STRING, description: "推荐理由" },
              exists: { type: Type.BOOLEAN, description: "是否存在" },
            },
          },
          overallStyle: { type: Type.STRING, description: "整体风格" },
        },
        required: ["top", "bottom", "overallStyle"],
      },
    },
  });

  const text = response.text || "{}";
  return JSON.parse(text) as AnalysisResult;
}

// 使用 Gemini 图像模型进行材质替换（gemini-2.5-flash-image）
export async function replaceMaterial(
  base64Image: string,
  materialPrompt: string,
  color?: string
): Promise<string> {
  if (!ai) {
    throw new Error("Gemini 客户端未初始化，请检查 GEMINI_API_KEY 环境变量。");
  }

  // 压缩原图，减少上传体积
  const compressed = await compressImageForUpload(base64Image);
  const imageData = compressed.split(",")[1] || base64Image.split(",")[1];

  const colorPrefix = color ? `${color}色的 ` : "";
  const prompt =
    `请将图中人物服装的材质整体替换为${colorPrefix}${materialPrompt}。` +
    "保持服装的款式、版型和光影效果基本不变，只改变面料材质，呈现高清产品图效果。";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: imageData,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if ((part as any).inlineData) {
        const inline = (part as any).inlineData as { data: string };
        return `data:image/png;base64,${inline.data}`;
      }
    }

    throw new Error("Gemini 没有返回图像数据");
  } catch (error: any) {
    console.error("Replace material error (Gemini):", error);
    const rawMsg = error?.message ?? String(error);
    throw new Error(rawMsg || "材质替换失败，请稍后重试。");
  }
}

// 使用 Gemini 生成/扩图（gemini-2.5-flash-image），用于“AI生成新图”页面
// originalImage: 原图（保持人物/构图）；referenceImage: 参考风格图（颜色/材质/氛围）
export async function generateImage(
  prompt: string,
  originalImage?: string,
  referenceImage?: string
): Promise<string> {
  if (!ai) {
    throw new Error("Gemini 客户端未初始化，请检查 GEMINI_API_KEY 环境变量。");
  }

  const parts: any[] = [];

  if (originalImage) {
    const compressed = await compressImageForUpload(originalImage);
    const imageData = compressed.split(",")[1] || originalImage.split(",")[1];
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: imageData,
      },
    });
  }

  if (referenceImage) {
    const compressedRef = await compressImageForUpload(referenceImage);
    const refData = compressedRef.split(",")[1] || referenceImage.split(",")[1];
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: refData,
      },
    });
  }

  const finalPrompt =
    (prompt || "为时尚服装产品生成一张高质量产品图。") +
    (originalImage && referenceImage
      ? " 第一张图片是原图，请保持人物、姿态和构图；第二张图片是参考风格图，请尽量在颜色、材质和整体氛围上向其靠近。"
      : originalImage
      ? " 请在保持原图人物、姿态和构图的前提下，按文字描述调整风格。"
      : referenceImage
      ? " 请参考图片中的风格和氛围，根据文字描述生成一张新的产品图。"
      : " 请生成 1:1 构图、光线均匀、细节清晰的产品级效果图。");

  parts.push({ text: finalPrompt });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: { parts },
    });

    const resultParts = response.candidates?.[0]?.content?.parts || [];
    for (const part of resultParts) {
      if ((part as any).inlineData) {
        const inline = (part as any).inlineData as { data: string };
        return `data:image/png;base64,${inline.data}`;
      }
    }

    throw new Error("Gemini 没有返回生成的图像数据");
  } catch (error: any) {
    console.error("Generate image error (Gemini):", error);
    const rawMsg = error?.message ?? String(error);
    throw new Error(rawMsg || "生成图片失败，请稍后重试。");
  }
}

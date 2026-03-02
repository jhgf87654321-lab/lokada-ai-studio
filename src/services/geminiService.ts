import { AnalysisResult } from "../types";

// 前端现在只调用自己的后端 /api/*，不再直接访问 Google

export async function analyzeClothing(base64Image: string): Promise<AnalysisResult> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64Image }),
  });
  if (!response.ok) {
    throw new Error(`Analysis failed: ${response.statusText}`);
  }
  return response.json();
}

export async function replaceMaterial(
  base64Image: string,
  materialPrompt: string,
  color?: string
): Promise<string> {
  const response = await fetch("/api/replace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64Image, materialPrompt, color }),
  });
  if (!response.ok) {
    throw new Error(`Replace failed: ${response.statusText}`);
  }
  const data = await response.json();
  return data.image as string;
}

export async function generateImage(
  prompt: string,
  originalImage?: string,
  referenceImage?: string
): Promise<string> {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, originalImage, referenceImage }),
  });
  if (!response.ok) {
    throw new Error(`Generate failed: ${response.statusText}`);
  }
  const data = await response.json();
  return data.image as string;
}

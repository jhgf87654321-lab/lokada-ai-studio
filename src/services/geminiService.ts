import { AnalysisResult } from "../types";

// 前端现在只调用自己的后端 /api/*，不再直接访问 Google

/** 将大图压缩为较小 data URL，减少请求体体积 */
async function compressImageForUpload(dataUrl: string, maxSizePx = 1200, quality = 0.82): Promise<string> {
  // 约 1.2MB 以下不压缩（经验值：避免不必要的 canvas 开销）
  if (dataUrl.length < 1_200_000) return dataUrl;
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

export async function analyzeClothing(base64Image: string): Promise<AnalysisResult> {
  const payloadImage = await compressImageForUpload(base64Image);
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64Image: payloadImage }),
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
  const payloadImage = await compressImageForUpload(base64Image);
  const response = await fetch("/api/replace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64Image: payloadImage, materialPrompt, color }),
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
  const payloadOriginal = originalImage ? await compressImageForUpload(originalImage) : undefined;
  const payloadReference = referenceImage ? await compressImageForUpload(referenceImage) : undefined;
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, originalImage: payloadOriginal, referenceImage: payloadReference }),
  });
  if (!response.ok) {
    throw new Error(`Generate failed: ${response.statusText}`);
  }
  const data = await response.json();
  return data.image as string;
}

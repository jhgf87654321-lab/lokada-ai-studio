import { AnalysisResult } from "../types";

/** 将大图压缩为较小 data URL，减少请求体体积，避免 fetch 因体积/超时失败 */
async function compressImageForUpload(dataUrl: string, maxSizePx = 1200, quality = 0.82): Promise<string> {
  if (dataUrl.length < 1_200_000) return dataUrl; // 约 1.2MB 以下不压缩
  return new Promise((resolve, reject) => {
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

// 通过后端 API 调用 Google Gemini 进行服装分析
export async function analyzeClothing(base64Image: string): Promise<AnalysisResult> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ base64Image }),
  });

  if (!response.ok) {
    throw new Error(`Analysis failed: ${response.statusText}`);
  }

  const result = await response.json();
  return result;
}

// 通过后端 API 调用 Kie.ai 进行材质替换（图生图）
export async function replaceMaterial(
  base64Image: string,
  materialPrompt: string,
  color?: string
): Promise<string> {
  try {
    // 大图先压缩再上传，减小请求体，降低「fetch failed」概率
    const payloadImage = await compressImageForUpload(base64Image);

    // 创建材质替换任务，后端会组装最终提示词并处理图片
    const response = await fetch("/api/replace", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        base64Image: payloadImage,
        materialPrompt,
        color,
      }),
    });

    if (!response.ok) {
      // 尝试从后端返回的 JSON 中提取具体错误信息
      const text = await response.text();
      let message = `Replace failed: ${response.status} ${response.statusText}`;
      try {
        const data = JSON.parse(text);
        if (data?.error) {
          message = data.error;
        }
      } catch {
        // 不是 JSON，就保留默认 message
      }
      throw new Error(message);
    }

    const result = await response.json();
    console.log("Replace task result:", result);

    // 如果返回了 taskId，轮询查询状态（Kie 图生图可能需 1～2 分钟）
    if (result.taskId) {
      const maxAttempts = 60;   // 最多 60 次
      const intervalMs = 2000;  // 每 2 秒一次，总计约 120 秒
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));

        try {
          const statusResponse = await fetch(`/api/replace/${result.taskId}`);
          if (statusResponse.ok) {
            const statusResult = await statusResponse.json();
            if (i % 10 === 0) console.log("Replace status attempt", i + 1, statusResult);

            if (statusResult.status === "success" && statusResult.imageUrl) {
              return statusResult.imageUrl;
            } else if (statusResult.status === "failed") {
              throw new Error(`Image generation failed: ${statusResult.error}`);
            }
            // 处理中，继续轮询
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("Image generation failed")) throw e;
          console.warn("Polling error:", e);
        }
      }
      throw new Error("Image generation timeout (waited ~2min). 后台可能已生成，请稍后在 KIE 后台查看或重试。");
    }

    throw new Error("No task ID returned from /api/replace");
  } catch (error: any) {
    console.error("Replace material error:", error);
    const rawMsg = error?.message ?? String(error);
    // 网络层失败时给出可操作提示
    if (/fetch failed|Failed to fetch|NetworkError|Load failed|ECONNREFUSED/i.test(rawMsg)) {
      throw new Error(
        "网络请求失败：请确认在项目根目录运行了 npm run dev，并通过 http://localhost:3001 打开页面；若仍失败可换一张较小图片重试。"
      );
    }
    if (error instanceof Error) throw error;
    throw new Error(String(error));
  }
}

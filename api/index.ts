/**
 * Vercel serverless 入口：所有逻辑集中于此文件，避免跨文件 import 导致 MODULE_NOT_FOUND
 */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import COS from "cos-nodejs-sdk-v5";
import dotenv from "dotenv";
import fs from "fs";
import { GoogleGenerativeAI } from "@google/genai";
dotenv.config();

const isVercel = Boolean(process.env.VERCEL);
const geminiApiKey = process.env.GEMINI_API_KEY || "";
const gemini = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;
const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: "50mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

type CachedTaskStatus = "pending" | "processing" | "success" | "failed";
type CachedTask = {
  taskId: string;
  status: CachedTaskStatus;
  imageUrl?: string;
  error?: string;
  updatedAt: number;
  raw?: any;
};

const taskMemCache = new Map<string, CachedTask>();
let stmtUpsert: { run: (v: object) => void } | null = null;
let stmtGet: { get: (id: string) => any } | null = null;

;(async () => {
  if (isVercel) return;
  try {
    const { default: Database } = await import("better-sqlite3");
    const dataDir = path.join(rootDir, "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "kie-task-cache.db");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`CREATE TABLE IF NOT EXISTS kie_task_cache (task_id TEXT PRIMARY KEY, status TEXT NOT NULL, image_url TEXT, error TEXT, updated_at INTEGER NOT NULL, raw_json TEXT);`);
    stmtUpsert = db.prepare(`INSERT INTO kie_task_cache (task_id, status, image_url, error, updated_at, raw_json) VALUES (@task_id, @status, @image_url, @error, @updated_at, @raw_json) ON CONFLICT(task_id) DO UPDATE SET status=excluded.status, image_url=excluded.image_url, error=excluded.error, updated_at=excluded.updated_at, raw_json=excluded.raw_json`);
    stmtGet = db.prepare(`SELECT task_id, status, image_url, error, updated_at, raw_json FROM kie_task_cache WHERE task_id = ?`);
  } catch (e) {
    console.warn("SQLite init failed:", (e as Error)?.message);
  }
})();

function cacheSet(task: CachedTask) {
  taskMemCache.set(task.taskId, task);
  if (stmtUpsert) stmtUpsert.run({ task_id: task.taskId, status: task.status, image_url: task.imageUrl ?? null, error: task.error ?? null, updated_at: task.updatedAt, raw_json: task.raw ? JSON.stringify(task.raw) : null });
}

function cacheGet(taskId: string): CachedTask | null {
  const mem = taskMemCache.get(taskId);
  if (mem) return mem;
  if (!stmtGet) return null;
  const row = stmtGet.get(taskId) as any;
  if (!row) return null;
  return { taskId: row.task_id, status: row.status, imageUrl: row.image_url ?? undefined, error: row.error ?? undefined, updatedAt: row.updated_at, raw: row.raw_json ? (() => { try { return JSON.parse(row.raw_json); } catch { return undefined; } })() : undefined };
}

function safeJsonParse(text: string) { try { return JSON.parse(text); } catch { return undefined; } }

function extractImageUrlFromResult(result: any): string | undefined {
  return result?.resultUrls?.[0] ?? result?.result_urls?.[0] ?? result?.resultUrl ?? result?.result_url ?? result?.output?.[0] ?? result?.images?.[0] ?? result?.data?.resultUrls?.[0] ?? (Array.isArray(result) ? result[0] : undefined);
}

const cos = new COS({ SecretId: process.env.COS_SECRET_ID, SecretKey: process.env.COS_SECRET_KEY });
const Bucket = process.env.COS_BUCKET || "lokada-1254090729";
const Region = process.env.COS_REGION || "ap-shanghai";

function putObject(params: any): Promise<any> {
  return new Promise((resolve, reject) => { cos.putObject(params, (err, data) => err ? reject(err) : resolve(data)); });
}

const materialsData = [
  { id: 1, name: "真丝绸缎", type: "丝绸", description: "光滑、有光泽的织物，具有优美的垂坠感", thumbnail_url: "https://picsum.photos/seed/silk/400/400", texture_prompt: "luxurious smooth glossy silk satin fabric with elegant folds" },
  { id: 2, name: "厚重丹宁", type: "牛仔", description: "耐用、粗犷的斜纹棉布", thumbnail_url: "https://picsum.photos/seed/denim/400/400", texture_prompt: "rugged blue heavy denim texture with visible twill weave" },
  { id: 3, name: "羊绒羊毛", type: "羊毛", description: "极度柔软温暖的奢华纤维", thumbnail_url: "https://picsum.photos/seed/wool/400/400", texture_prompt: "soft fuzzy grey cashmere wool knit texture" },
  { id: 4, name: "灯芯绒", type: "绒布", description: "具有独特垂直条纹的纹理织物", thumbnail_url: "https://picsum.photos/seed/corduroy/400/400", texture_prompt: "brown corduroy fabric with thick vertical ribs" },
  { id: 5, name: "亚麻", type: "亚麻", description: "透气、轻便的织物，具有自然纹理", thumbnail_url: "https://picsum.photos/seed/linen/400/400", texture_prompt: "natural beige linen fabric with visible irregular weave" },
  { id: 6, name: "皮革", type: "动物皮", description: "由动物皮制成的坚韧、柔韧的材料", thumbnail_url: "https://picsum.photos/seed/leather/400/400", texture_prompt: "premium black pebbled leather texture" },
  { id: 7, name: "天鹅绒", type: "合成/丝绸", description: "柔软、豪华的织物，具有短而密的绒毛", thumbnail_url: "https://picsum.photos/seed/velvet/400/400", texture_prompt: "deep emerald green plush velvet fabric with soft sheen" },
  { id: 8, name: "粗花呢", type: "羊毛", description: "粗糙、紧密编织的羊毛织物", thumbnail_url: "https://picsum.photos/seed/tweed/400/400", texture_prompt: "classic grey and black herringbone tweed wool fabric" }
];

async function startServer() {
  const PORT = parseInt(String(process.env.PORT || 3001), 10);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.raw({ type: "application/octet-stream", limit: "50mb" }));

  app.get("/api/health", (_, res) => res.json({ status: "ok", timestamp: Date.now() }));
  app.get("/api/materials", (_, res) => res.json(materialsData));

  app.post("/api/upload-url", async (req, res) => {
    try {
      const { filename, contentType } = req.body;
      if (!Bucket || !/^[a-z0-9]+-\d+$/.test(Bucket)) return res.status(500).json({ error: "COS_BUCKET not configured" });
      const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${filename?.split(".").pop() || "png"}`;
      const presignedUrl = await new Promise<string>((resolve, reject) => {
        cos.getObjectUrl({ Bucket, Region, Key: key, Method: "PUT", Headers: { "Content-Type": contentType || "image/png" }, Expires: 300, Sign: true }, (err, data) => err ? reject(err) : resolve(data.Url));
      });
      res.json({ success: true, uploadUrl: presignedUrl, key, url: `https://${Bucket}.cos.${Region}.myqcloud.com/${key}` });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to generate upload URL" });
    }
  });

  app.post("/api/upload", async (req, res) => {
    try {
      let buffer: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ""));
      if (buffer.length === 0) return res.status(400).json({ error: "上传内容为空" });
      if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: "文件大小不能超过 5MB" });
      const key = `uploads/upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const result = await putObject({ Bucket, Region, Key: key, Body: buffer, ContentLength: buffer.length, ContentType: req.headers["content-type"] || "image/png", ACL: "public-read" });
      const url = (result.Location || "").startsWith("http") ? result.Location : `https://${result.Location}`;
      res.json({ success: true, url, filename: key, size: buffer.length, contentType: "image/png" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Upload failed" });
    }
  });

  // 使用 Gemini 进行服装分析（gemini-3-flash-preview）
  app.post("/api/analyze", async (req, res) => {
    const { base64Image } = req.body;
    if (!base64Image) return res.status(400).json({ error: "No image provided" });
    if (!gemini) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    try {
      const imageData = base64Image.replace(/^data:image\/\w+;base64,/, "");
      const model = gemini.getGenerativeModel({ model: "gemini-3-flash-preview" });

      const result = await model.generateContent({
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
                  "分析图中人物的服装，将其分为\"top\"和\"bottom\"两部分分别分析。" +
                  "如果某部分不存在（例如只穿连衣裙），请在该部分的 exists 字段标记为 false。" +
                  "为每一部分推荐3种合适的面料材质。" +
                  "严格按如下 JSON 结构返回（不要包含其它字段）：" +
                  `{"top":{"type":"上装类型","recommendedMaterials":["材质1","材质2","材质3"],"reasoning":"推荐理由","exists":true或false},"bottom":{"type":"下装类型","recommendedMaterials":["材质1","材质2","材质3"],"reasoning":"推荐理由","exists":true或false},"overallStyle":"整体风格描述"}`,
              },
            ],
          },
        ],
      });

      const text = result.response.text();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No valid JSON in Gemini response");
      const analysis = JSON.parse(match[0]);
      res.json(analysis);
    } catch (e) {
      console.error("Gemini analyze error:", e);
      res.json({
        top: { type: "上装", recommendedMaterials: ["棉质", "涤纶", "混纺"], reasoning: "AI分析暂时不可用", exists: true },
        bottom: { type: "下装", recommendedMaterials: ["牛仔", "亚麻", "混纺"], reasoning: "AI分析暂时不可用", exists: true },
        overallStyle: "服装",
      });
    }
  });

  // 使用 Gemini 图像模型进行材质替换（gemini-2.5-flash-image）
  app.post("/api/replace", async (req, res) => {
    const { base64Image, materialPrompt, color } = req.body;
    if (!base64Image) return res.status(400).json({ error: "No image provided" });
    if (!materialPrompt) return res.status(400).json({ error: "No material prompt provided" });
    if (!gemini) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    try {
      const imageData = base64Image.replace(/^data:image\/\w+;base64,/, "");
      const colorPrefix = color ? `${color}色的 ` : "";
      const prompt =
        `请将图中服装的材质整体替换为${colorPrefix}${materialPrompt}。` +
        "保持人物的姿态、构图和光影尽量不变，只改变服装面料的质感和颜色，生成高清产品图。";

      const model = gemini.getGenerativeModel({ model: "gemini-2.5-flash-image" });
      const result = await model.generateContent({
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: imageData,
              },
            },
            { text: prompt },
          ],
        },
      });

      const parts = result.response.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if ((part as any).inlineData) {
          const data = (part as any).inlineData.data as string;
          return res.json({ image: `data:image/png;base64,${data}` });
        }
      }

      res.status(500).json({ error: "Gemini did not return image data" });
    } catch (e: any) {
      console.error("Gemini replace error:", e);
      res.status(500).json({ error: e?.message || "Failed to replace material" });
    }
  });

  // 使用 Gemini 图像模型进行“AI 生图”（可选原图 + 参考图）
  app.post("/api/generate", async (req, res) => {
    const { prompt, originalImage, referenceImage } = req.body;
    if (!prompt && !originalImage && !referenceImage) {
      return res.status(400).json({ error: "At least prompt or image is required" });
    }
    if (!gemini) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    try {
      const parts: any[] = [];

      if (originalImage) {
        const data = originalImage.replace(/^data:image\/\w+;base64,/, "");
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data,
          },
        });
      }

      if (referenceImage) {
        const ref = referenceImage.replace(/^data:image\/\w+;base64,/, "");
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: ref,
          },
        });
      }

      const finalPrompt =
        (prompt || "为时尚服装产品生成一张高质量产品图。") +
        (originalImage && referenceImage
          ? " 第一张图片是原图，请保持人物、姿态和构图；第二张图片是参考风格图，请在颜色、材质和氛围上尽量靠近它。"
          : originalImage
          ? " 请在保持原图人物、姿态和构图的前提下，按文字描述调整风格。"
          : referenceImage
          ? " 请参考图片中的风格和氛围，根据文字描述生成新的产品图。"
          : " 请生成 1:1 构图、光线均匀、细节清晰的产品级效果图。");

      parts.push({ text: finalPrompt });

      const model = gemini.getGenerativeModel({ model: "gemini-2.5-flash-image" });
      const result = await model.generateContent({
        contents: { parts },
      });

      const resultParts = result.response.candidates?.[0]?.content?.parts || [];
      for (const part of resultParts) {
        if ((part as any).inlineData) {
          const data = (part as any).inlineData.data as string;
          return res.json({ image: `data:image/png;base64,${data}` });
        }
      }

      res.status(500).json({ error: "Gemini did not return image data" });
    } catch (e: any) {
      console.error("Gemini generate error:", e);
      res.status(500).json({ error: e?.message || "Failed to generate image" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true, port: PORT }, appType: "spa" });
    app.use(vite.middlewares as express.RequestHandler);
  } else {
    const distDir = path.join(rootDir, "dist");
    app.use(express.static(distDir));
    app.get("*", (_, res) => res.sendFile(path.join(distDir, "index.html")));
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
  }
}

startServer();
export default app;

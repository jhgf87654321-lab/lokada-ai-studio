import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import COS from "cos-nodejs-sdk-v5";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config();

const isVercel = Boolean(process.env.VERCEL);
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
    db.exec(`
      CREATE TABLE IF NOT EXISTS kie_task_cache (
        task_id TEXT PRIMARY KEY, status TEXT NOT NULL, image_url TEXT,
        error TEXT, updated_at INTEGER NOT NULL, raw_json TEXT
      );
    `);
    stmtUpsert = db.prepare(`
      INSERT INTO kie_task_cache (task_id, status, image_url, error, updated_at, raw_json)
      VALUES (@task_id, @status, @image_url, @error, @updated_at, @raw_json)
      ON CONFLICT(task_id) DO UPDATE SET
        status=excluded.status, image_url=excluded.image_url, error=excluded.error,
        updated_at=excluded.updated_at, raw_json=excluded.raw_json
    `);
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
      const ext = "png";
      const key = `uploads/upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const result = await putObject({ Bucket, Region, Key: key, Body: buffer, ContentLength: buffer.length, ContentType: req.headers["content-type"] || "image/png", ACL: "public-read" });
      const url = (result.Location || "").startsWith("http") ? result.Location : `https://${result.Location}`;
      res.json({ success: true, url, filename: key, size: buffer.length, contentType: "image/png" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Upload failed" });
    }
  });

  app.post("/api/generate", async (req, res) => {
    try {
      const { prompt, originalImageUrl } = req.body;
      const KIE_AI_API_KEY = process.env.KIE_AI_API_KEY;
      if (!KIE_AI_API_KEY) return res.status(500).json({ error: "KIE_AI_API_KEY not configured" });
      const requestBody: any = { model: "google/imagen-3-generate-002", input: { prompt, output_format: "png", image_size: "1:1" } };
      if (originalImageUrl) requestBody.input.image_url = originalImageUrl.startsWith("data:") || originalImageUrl.startsWith("http") ? originalImageUrl : `data:image/jpeg;base64,${originalImageUrl}`;
      const response = await fetch("https://api.kie.ai/api/v1/jobs/createTask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_AI_API_KEY}` }, body: JSON.stringify(requestBody) });
      if (!response.ok) throw new Error(`Kie.ai error: ${response.status}`);
      const data = await response.json();
      res.json({ success: true, taskId: data.data?.taskId || data.data?.recordId, status: "processing" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed" });
    }
  });

  app.get("/api/generate/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const KIE_AI_API_KEY = process.env.KIE_AI_API_KEY;
      if (!KIE_AI_API_KEY) return res.status(500).json({ error: "KIE_AI_API_KEY not configured" });
      const response = await fetch(`https://api.kie.ai/api/v1/jobs/${id}`, { headers: { Authorization: `Bearer ${KIE_AI_API_KEY}` } });
      if (!response.ok) return res.json({ taskId: id, status: "processing" });
      const data = await response.json();
      if (data.state === "success" && data.resultJson) {
        const result = JSON.parse(data.resultJson);
        res.json({ taskId: id, status: "success", outputUrl: result.resultUrls?.[0] });
      } else if (data.state === "fail") {
        res.json({ taskId: id, status: "failed", error: data.failMsg });
      } else {
        res.json({ taskId: id, status: "processing" });
      }
    } catch {
      res.json({ taskId: req.params.id, status: "processing" });
    }
  });

  app.post("/api/callback", async (req, res) => {
    try {
      const body = req.body;
      const payload = body?.data ? body : { data: body };
      const data = payload?.data ?? payload;
      const taskId = data?.taskId || data?.task_id || body?.taskId || body?.task_id;
      const state = data?.state || data?.status || body?.state || body?.status;
      const resultJson = data?.resultJson || data?.result_json || body?.resultJson || body?.result_json;
      if (taskId && String(state).toLowerCase() === "success" && resultJson) {
        const parsed = typeof resultJson === "string" ? safeJsonParse(resultJson) : resultJson;
        const imageUrl = extractImageUrlFromResult(parsed);
        if (imageUrl) cacheSet({ taskId, status: "success", imageUrl, updatedAt: Date.now(), raw: body });
        else cacheSet({ taskId, status: "failed", error: "No image URL", updatedAt: Date.now(), raw: body });
      } else if (taskId && (String(state).toLowerCase() === "fail" || String(state).toLowerCase() === "failed")) {
        cacheSet({ taskId, status: "failed", error: String(data?.failMsg || body?.failMsg || "Failed"), updatedAt: Date.now(), raw: body });
      } else if (taskId) {
        cacheSet({ taskId, status: "processing", updatedAt: Date.now(), raw: body });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    const { base64Image } = req.body;
    if (!base64Image) return res.status(400).json({ error: "No image provided" });
    const KIE_AI_API_KEY = process.env.KIE_AI_API_KEY;
    if (!KIE_AI_API_KEY) return res.status(500).json({ error: "KIE_AI_API_KEY not configured" });
    const imageData = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const requestBody = {
      model: "gemini-3-flash-preview",
      messages: [{ role: "user", content: [{ type: "text", text: `分析图中人物的服装。将其分为"上装"(top)和"下装"(bottom)两部分分别分析。如果某部分不存在，请在 exists 字段标明。为每一部分推荐3种合适的面料材质。请用 JSON 格式返回，严格包含以下结构：{ "top": { "type": "上装类型", "recommendedMaterials": ["材质1","材质2","材质3"], "reasoning": "推荐理由", "exists": true或false }, "bottom": { "type": "下装类型", "recommendedMaterials": ["材质1","材质2","材质3"], "reasoning": "推荐理由", "exists": true或false }, "overallStyle": "整体风格描述" }` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageData}` } }] }],
      stream: false
    };
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 60000);
      const response = await fetch("https://api.kie.ai/gemini-3-flash/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_AI_API_KEY}` }, body: JSON.stringify(requestBody), signal: controller.signal });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      let jsonText = await response.text();
      if (jsonText.startsWith("{}")) jsonText = jsonText.substring(2);
      const data = JSON.parse(jsonText);
      if (data.code && data.code !== 200) throw new Error(data.msg || "Unknown error");
      let resultText = data.choices?.[0]?.message?.content || "";
      resultText = resultText.replace(/^```json\s*/, "").replace(/```$/, "").trim();
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No valid JSON");
      let result = JSON.parse(jsonMatch[0]);
      if (result.clothingType && !result.top) {
        const mats = result.recommendedMaterials || ["棉质", "涤纶", "混纺"];
        result = { top: { type: result.clothingType, recommendedMaterials: mats, reasoning: result.reasoning || "", exists: true }, bottom: { type: result.clothingType, recommendedMaterials: mats, reasoning: result.reasoning || "", exists: true }, overallStyle: result.clothingType };
      }
      res.json(result);
    } catch (e) {
      console.error("Analysis error:", e);
      res.json({
        top: { type: "上装", recommendedMaterials: ["棉质", "涤纶", "混纺"], reasoning: "AI分析暂时不可用", exists: true },
        bottom: { type: "下装", recommendedMaterials: ["牛仔", "亚麻", "混纺"], reasoning: "AI分析暂时不可用", exists: true },
        overallStyle: "服装"
      });
    }
  });

  const KIE_FILE_UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload";
  async function uploadBase64ToKie(base64Image: string, apiKey: string): Promise<string> {
    const base64Data = base64Image.startsWith("data:") ? base64Image : `data:image/jpeg;base64,${base64Image}`;
    const uploadRes = await fetch(KIE_FILE_UPLOAD_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ base64Data, uploadPath: "replace", fileName: `replace-${Date.now()}.png` }) });
    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
    let uploadJson: any;
    try {
      const text = await uploadRes.text();
      uploadJson = JSON.parse(text.startsWith("{}") ? text.substring(2) : text);
    } catch {
      throw new Error("Invalid upload response");
    }
    const url = uploadJson?.data?.fileUrl ?? uploadJson?.data?.downloadUrl ?? uploadJson?.fileUrl ?? uploadJson?.downloadUrl;
    if (!url) throw new Error("No URL in upload response");
    return url;
  }

  app.post("/api/replace", async (req, res) => {
    try {
      const { base64Image, materialPrompt, color } = req.body;
      if (!base64Image) return res.status(400).json({ error: "No image provided" });
      const KIE_AI_API_KEY = process.env.KIE_AI_API_KEY;
      if (!KIE_AI_API_KEY) return res.status(500).json({ error: "KIE_AI_API_KEY not configured" });
      const imageUrl = await uploadBase64ToKie(base64Image, KIE_AI_API_KEY);
      const colorPrefix = color ? `${color}色的 ` : "";
      const finalPrompt = `将图片中服装的材质替换为${colorPrefix}${materialPrompt}。保持服装的款式、版型和光影效果完全不变，只改变面料材质。`;
      const requestBody = {
        model: "nano-banana-pro",
        callBackUrl: `${process.env.APP_URL || "http://localhost:3001"}/api/callback`,
        input: { prompt: finalPrompt, image_input: [imageUrl], aspect_ratio: "1:1", resolution: "1K", output_format: "png" }
      };
      const response = await fetch("https://api.kie.ai/api/v1/jobs/createTask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_AI_API_KEY}` }, body: JSON.stringify(requestBody) });
      if (!response.ok) throw new Error(`createTask error: ${response.status}`);
      let jsonText = await response.text();
      if (jsonText.startsWith("{}")) jsonText = jsonText.substring(2);
      const data = JSON.parse(jsonText);
      if (data.code != null && data.code !== 200) throw new Error(data.msg || data.message || "Unknown");
      const taskId = data?.data?.taskId ?? data?.data?.recordId ?? data?.data?.id ?? data?.taskId ?? data?.recordId ?? data?.id;
      if (!taskId) throw new Error("No taskId in response");
      cacheSet({ taskId, status: "pending", updatedAt: Date.now(), raw: {} });
      res.json({ taskId, status: "pending" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to replace" });
    }
  });

  app.get("/api/replace/:taskId", async (req, res) => {
    try {
      const { taskId } = req.params;
      const KIE_AI_API_KEY = process.env.KIE_AI_API_KEY;
      if (!KIE_AI_API_KEY) return res.status(500).json({ error: "KIE_AI_API_KEY not configured" });
      const cached = cacheGet(taskId);
      if (cached?.status === "success" && cached.imageUrl) return res.json({ status: "success", imageUrl: cached.imageUrl });
      if (cached?.status === "failed") return res.json({ status: "failed", error: cached.error });
      const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${KIE_AI_API_KEY}` } });
      if (!response.ok) return res.json({ status: "processing" });
      let jsonText = await response.text();
      if (jsonText.startsWith("{}")) jsonText = jsonText.substring(2);
      const payload = JSON.parse(jsonText);
      const data = payload?.data ?? payload;
      const state = (data?.state ?? "").toLowerCase();
      if (state === "success" && data?.resultJson) {
        let result: any = typeof data.resultJson === "string" ? JSON.parse(data.resultJson) : data.resultJson;
        const url = extractImageUrlFromResult(result);
        if (url) {
          cacheSet({ taskId, status: "success", imageUrl: url, updatedAt: Date.now(), raw: payload });
          return res.json({ status: "success", imageUrl: url });
        }
        cacheSet({ taskId, status: "failed", error: "No image URL", updatedAt: Date.now(), raw: payload });
      } else if (state === "fail") {
        cacheSet({ taskId, status: "failed", error: String(data?.failMsg || "Failed"), updatedAt: Date.now(), raw: payload });
        return res.json({ status: "failed", error: data?.failMsg });
      }
      cacheSet({ taskId, status: "processing", updatedAt: Date.now(), raw: payload });
      res.json({ status: "processing" });
    } catch {
      res.json({ status: "processing" });
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
export const handler = app;

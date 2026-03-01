import express from "express";
import { createServer as createViteServer } from "vite";

import path from "path";
import { fileURLToPath } from "url";
import COS from "cos-nodejs-sdk-v5";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config();

// Vercel serverless 下 better-sqlite3 等 native 模块可能无法运行，改用纯内存缓存
const isVercel = Boolean(process.env.VERCEL);

const app = express();

// CORS 支持
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: "50mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type CachedTaskStatus = "pending" | "processing" | "success" | "failed";
type CachedTask = {
  taskId: string;
  status: CachedTaskStatus;
  imageUrl?: string;
  error?: string;
  updatedAt: number;
  raw?: any;
};

// 本地任务缓存：内存 + SQLite（重启后仍可读到结果）
// Vercel serverless 下 SQLite 不可用，仅用内存
const taskMemCache = new Map<string, CachedTask>();
let db: InstanceType<typeof import("better-sqlite3")> | null = null;
let stmtUpsert: { run: (v: object) => void } | null = null;
let stmtGet: { get: (id: string) => any } | null = null;

;(async () => {
  if (isVercel) return;
  try {
    const { default: Database } = await import("better-sqlite3");
    const dataDir = path.join(__dirname, "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "kie-task-cache.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS kie_task_cache (
        task_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        image_url TEXT,
        error TEXT,
        updated_at INTEGER NOT NULL,
        raw_json TEXT
      );
    `);
    stmtUpsert = db.prepare(`
      INSERT INTO kie_task_cache (task_id, status, image_url, error, updated_at, raw_json)
      VALUES (@task_id, @status, @image_url, @error, @updated_at, @raw_json)
      ON CONFLICT(task_id) DO UPDATE SET
        status=excluded.status,
        image_url=excluded.image_url,
        error=excluded.error,
        updated_at=excluded.updated_at,
        raw_json=excluded.raw_json
    `);
    stmtGet = db.prepare(`SELECT task_id, status, image_url, error, updated_at, raw_json FROM kie_task_cache WHERE task_id = ?`);
  } catch (e) {
    console.warn("SQLite init failed, using memory cache only:", (e as Error)?.message);
  }
})();

function cacheSet(task: CachedTask) {
  taskMemCache.set(task.taskId, task);
  if (stmtUpsert) {
    stmtUpsert.run({
      task_id: task.taskId,
      status: task.status,
      image_url: task.imageUrl ?? null,
      error: task.error ?? null,
      updated_at: task.updatedAt,
      raw_json: task.raw ? JSON.stringify(task.raw) : null,
    });
  }
}

function cacheGet(taskId: string): CachedTask | null {
  const mem = taskMemCache.get(taskId);
  if (mem) return mem;
  if (!stmtGet) return null;
  const row = stmtGet.get(taskId) as any;
  if (!row) return null;
  const parsed: CachedTask = {
    taskId: row.task_id,
    status: row.status,
    imageUrl: row.image_url ?? undefined,
    error: row.error ?? undefined,
    updatedAt: row.updated_at,
    raw: row.raw_json ? safeJsonParse(row.raw_json) : undefined,
  };
  taskMemCache.set(taskId, parsed);
  return parsed;
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stripKieWeirdPrefix(text: string) {
  return text.startsWith("{}") ? text.substring(2) : text;
}

function extractImageUrlFromResult(result: any): string | undefined {
  return (
    result?.resultUrls?.[0] ??
    result?.result_urls?.[0] ??
    result?.resultUrl ??
    result?.result_url ??
    result?.output?.[0] ??
    result?.images?.[0] ??
    result?.data?.resultUrls?.[0] ??
    (Array.isArray(result) ? result[0] : undefined)
  );
}

function normalizeTaskStatus(state: any): CachedTaskStatus {
  const s = String(state ?? "").toLowerCase();
  if (s === "success") return "success";
  if (s === "fail" || s === "failed") return "failed";
  return "processing";
}

// COS 配置
const cosConfig = {
  SecretId: process.env.COS_SECRET_ID,
  SecretKey: process.env.COS_SECRET_KEY,
};

const cos = new COS(cosConfig);

const Bucket = process.env.COS_BUCKET || "lokada-1254090729";
const Region = process.env.COS_REGION || "ap-shanghai";

// 材质库数据 - 使用占位图
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
console.log("COS Config:", {
  SecretId: cosConfig.SecretId ? `已配置(${cosConfig.SecretId.substring(0, 8)}...)` : "未配置",
  Bucket,
  Region,
});

function putObject(params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    cos.putObject(params, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

async function startServer() {
  const PORT = parseInt(String(process.env.PORT || 3001), 10);

  app.use(express.json({ limit: '50mb' }));
  app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // API Routes - Materials (使用 COS 存储的材质数据)
  app.get("/api/materials", (req, res) => {
    res.json(materialsData);
  });

  // API Routes - 上传预签名URL
  app.post("/api/upload-url", async (req, res) => {
    try {
      const { filename, contentType } = req.body;

      if (!Bucket || !/^[a-z0-9]+-\d+$/.test(Bucket)) {
        return res.status(500).json({ error: "COS_BUCKET not configured" });
      }

      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const ext = filename?.split('.').pop() || 'png';
      const key = `uploads/${timestamp}-${randomId}.${ext}`;

      console.log("Generating presigned URL for key:", key);

      const presignedUrl = await new Promise<string>((resolve, reject) => {
        cos.getObjectUrl({
          Bucket,
          Region,
          Key: key,
          Method: 'PUT',
          Headers: {
            'Content-Type': contentType || 'image/png',
          },
          Expires: 300,
          Sign: true,
        }, (err, data) => {
          if (err) {
            console.error("COS getObjectUrl error:", err);
            return reject(err);
          }
          console.log("Presigned URL generated:", data.Url);
          resolve(data.Url);
        });
      });

      res.json({
        success: true,
        uploadUrl: presignedUrl,
        key,
        url: `https://${Bucket}.cos.${Region}.myqcloud.com/${key}`
      });
    } catch (error: any) {
      console.error('Generate presigned URL error:', error);
      res.status(500).json({ error: error.message || 'Failed to generate upload URL' });
    }
  });

  // API Routes - 直接上传
  app.post("/api/upload", async (req, res) => {
    try {
      const contentTypeHeader = req.headers["content-type"] || "application/octet-stream";
      const filenameHeader = req.headers["x-file-name"] as string || "upload";

      // 处理 Buffer
      let buffer: Buffer;
      if (Buffer.isBuffer(req.body)) {
        buffer = req.body;
      } else if (typeof req.body === 'string') {
        buffer = Buffer.from(req.body);
      } else {
        return res.status(400).json({ error: "Invalid request body" });
      }

      // 验证文件大小 (5MB)
      const maxSize = 5 * 1024 * 1024;
      if (buffer.length === 0) {
        return res.status(400).json({ error: "上传内容为空" });
      }
      if (buffer.length > maxSize) {
        return res.status(400).json({ error: "文件大小不能超过 5MB" });
      }

      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);

      const nameExt = typeof filenameHeader === "string" && filenameHeader.includes(".")
        ? filenameHeader.split(".").pop()
        : undefined;

      const mimeExt =
        String(contentTypeHeader).startsWith("image/jpeg") ? "jpg" :
        String(contentTypeHeader).startsWith("image/png") ? "png" :
        String(contentTypeHeader).startsWith("image/webp") ? "webp" :
        String(contentTypeHeader).startsWith("image/gif") ? "gif" :
        undefined;
      const extension = nameExt || mimeExt || "png";
      const filename = `upload-${timestamp}-${randomId}.${extension}`;

      const key = `uploads/${filename}`;

      const params: any = {
        Bucket,
        Region,
        Key: key,
        Body: buffer,
        ContentLength: buffer.length,
        ContentType: String(contentTypeHeader) || "image/png",
        ACL: "public-read",
      };

      const result = await putObject(params);

      const location: string = result.Location || '';
      const url = location.startsWith('http')
        ? location
        : `https://${location}`;

      res.json({
        success: true,
        url,
        filename: key,
        size: buffer.length,
        contentType: String(contentTypeHeader) || "image/png"
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      res.status(500).json({
        error: `上传失败: ${error?.message ?? String(error)}`,
        code: error?.code,
      });
    }
  });

  // API Routes - Kie.ai 生图
  app.post("/api/generate", async (req, res) => {
    try {
      const { prompt, originalImageUrl, aspectRatio, resolution, outputFormat, model } = req.body;
      const KIE_AI_API_KEY = process.env.KIE_AI_API_KEY;

      if (!KIE_AI_API_KEY) {
        return res.status(500).json({ error: "KIE_AI_API_KEY not configured" });
      }

      const apiUrl = "https://api.kie.ai/api/v1/jobs/createTask";
      const callbackUrl = `${process.env.APP_URL || 'http://localhost:3001'}/api/callback`;

      // 使用更适合服装/时尚任务的模型
      const requestBody: any = {
        model: model || "google/imagen-3-generate-002",
        input: {
          prompt: prompt,
          output_format: outputFormat || "png",
          image_size: aspectRatio || "1:1"
        }
      };

      // 处理原始图片 - 如果是 base64 格式，转换为 data URL 格式
      if (originalImageUrl) {
        if (originalImageUrl.startsWith('data:')) {
          // 已经是 data URL 格式，直接使用
          requestBody.input.image_url = originalImageUrl;
        } else if (originalImageUrl.startsWith('http')) {
          // 是普通 URL，直接使用
          requestBody.input.image_url = originalImageUrl;
        } else {
          // 假设是纯 base64 数据，添加前缀
          requestBody.input.image_url = `data:image/jpeg;base64,${originalImageUrl}`;
        }
      }

      console.log("Creating Kie.ai job:", requestBody);

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${KIE_AI_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Kie.ai API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log("Kie.ai response:", data);

      res.json({
        success: true,
        taskId: data.data?.taskId || data.data?.recordId,
        status: "processing",
      });
    } catch (error: any) {
      console.error("Generate error:", error);
      res.status(500).json({ error: error.message || "Failed to create generation job" });
    }
  });

  // API Routes - 查询生图状态
  app.get("/api/generate/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const KIE_AI_API_KEY = process.env.KIE_AI_API_KEY;

      if (!KIE_AI_API_KEY) {
        return res.status(500).json({ error: "KIE_AI_API_KEY not configured" });
      }

      const apiUrl = `https://api.kie.ai/api/v1/jobs/${id}`;

      const response = await fetch(apiUrl, {
        headers: {
          "Authorization": `Bearer ${KIE_AI_API_KEY}`,
        },
      });

      const responseText = await response.text();
      console.log("Kie.ai query response:", responseText.substring(0, 500));

      if (!response.ok) {
        // Kie.ai 查询端点似乎不可用，尝试直接返回任务创建成功，让前端继续轮询
        console.log("Query endpoint not available, returning processing status");
        res.json({
          taskId: id,
          status: "processing"
        });
        return;
      }

      const data = JSON.parse(responseText);
      console.log("Kie.ai job status:", data);

      // 检查任务状态
      if (data.state === "success" && data.resultJson) {
        const result = JSON.parse(data.resultJson);
        res.json({
          taskId: id,
          status: "success",
          outputUrl: result.resultUrls?.[0],
        });
      } else if (data.state === "fail") {
        res.json({
          taskId: id,
          status: "failed",
          error: data.failMsg,
        });
      } else {
        res.json({
          taskId: id,
          status: "processing",
        });
      }
    } catch (error: any) {
      console.error("Query status error:", error);
      // 返回处理中状态而不是错误，让前端继续尝试
      res.json({ taskId: req.params.id, status: "processing" });
    }
  });

  // API Routes - Kie.ai 回调
  app.post("/api/callback", async (req, res) => {
    try {
      const body = req.body;
      // 兼容不同回调结构：可能直接是 data，也可能包一层
      const payload = body?.data ? body : { data: body };
      const data = payload?.data ?? payload;

      const taskId = data?.taskId || data?.task_id || body?.taskId || body?.task_id;
      const state = data?.state || data?.status || body?.state || body?.status;
      const failMsg = data?.failMsg || data?.error || body?.failMsg || body?.error;
      const resultJson = data?.resultJson || data?.result_json || body?.resultJson || body?.result_json;

      if (taskId) {
        if (String(state).toLowerCase() === "success" && resultJson) {
          const parsed = typeof resultJson === "string" ? safeJsonParse(resultJson) : resultJson;
          const imageUrl = extractImageUrlFromResult(parsed);
          if (imageUrl) {
            cacheSet({ taskId, status: "success", imageUrl, updatedAt: Date.now(), raw: body });
          } else {
            cacheSet({ taskId, status: "failed", error: "No image URL in callback result", updatedAt: Date.now(), raw: body });
          }
        } else if (String(state).toLowerCase() === "fail" || String(state).toLowerCase() === "failed") {
          cacheSet({ taskId, status: "failed", error: String(failMsg || "Generation failed"), updatedAt: Date.now(), raw: body });
        } else {
          cacheSet({ taskId, status: "processing", updatedAt: Date.now(), raw: body });
        }
      }

      console.log("Kie.ai callback received:", {
        taskId,
        state,
        hasResult: Boolean(resultJson),
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Callback error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Routes - 服装分析 (使用 Kie.ai 的 Google Gemini Vision)
  app.post("/api/analyze", async (req, res) => {
    const { base64Image } = req.body;

    if (!base64Image) {
      return res.status(400).json({ error: "No image provided" });
    }

    console.log("Analyzing clothing image with Kie.ai...");

    // 使用 Kie.ai 的 API 调用 Gemini Vision
    const KIE_AI_API_KEY = process.env.KIE_AI_API_KEY;

    // Kie.ai API 端点 - 使用 gemini-3-flash 模型进行视觉分析
    const apiUrl = "https://api.kie.ai/gemini-3-flash/v1/chat/completions";

    // 移除 base64 前缀
    const imageData = base64Image.replace(/^data:image\/\w+;base64,/, "");

    // 使用 gemini-3-flash-preview 模型进行视觉分析（与 UI 逻辑统一：上装/下装分拆）
    const requestBody = {
      model: "gemini-3-flash-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `分析图中人物的服装。将其分为"上装"(top)和"下装"(bottom)两部分分别分析。如果某部分不存在（例如只穿了连衣裙，连衣裙可归为上装，下装设为不存在），请在 exists 字段标明。为每一部分推荐3种合适的面料材质。
请用 JSON 格式返回，严格包含以下结构（不要包含其他字段）：
{
  "top": { "type": "上装类型", "recommendedMaterials": ["材质1","材质2","材质3"], "reasoning": "推荐理由", "exists": true或false },
  "bottom": { "type": "下装类型", "recommendedMaterials": ["材质1","材质2","材质3"], "reasoning": "推荐理由", "exists": true或false },
  "overallStyle": "整体风格描述"
}`
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageData}`
              }
            }
          ]
        }
      ],
      stream: false
    };

    console.log("Calling Kie.ai API...");

    // 添加超时控制 - 增加到60秒以处理图像分析
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${KIE_AI_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Kie.ai API error: ${response.status} - ${errorText}`);
      }

      // 先获取原始响应文本
      const responseText = await response.text();
      console.log("Kie.ai raw response:", responseText.substring(0, 500));

      // 处理 Kie.ai API 返回的特殊格式 {}{"code":200,"msg":"","data":{...}}
      let jsonText = responseText;
      if (responseText.startsWith('{}')) {
        jsonText = responseText.substring(2);
      }

      const data = JSON.parse(jsonText);
      console.log("Kie.ai response:", data);

      // 检查 Kie.ai 是否返回错误
      if (data.code && data.code !== 200) {
        throw new Error(`Kie.ai API error: ${data.code} - ${data.msg || 'Unknown error'}`);
      }

      // 解析返回的 JSON - OpenAI 格式
      let resultText = data.choices?.[0]?.message?.content;
      if (!resultText) {
        throw new Error("No analysis result returned");
      }

      // 移除 markdown 代码块标记和前后空白
      resultText = resultText.replace(/^```json\s*/, "").replace(/```$/, "").trim();

      // 尝试提取 JSON（处理可能存在的额外文本）
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in response");
      }

      let result = JSON.parse(jsonMatch[0]);
      console.log("Analysis result:", result);

      // 兼容旧版 flat 格式，转换为 top/bottom 结构
      if (result.clothingType && !result.top) {
        const mats = result.recommendedMaterials || ["棉质", "涤纶", "混纺"];
        result = {
          top: { type: result.clothingType, recommendedMaterials: mats, reasoning: result.reasoning || "", exists: true },
          bottom: { type: result.clothingType, recommendedMaterials: mats, reasoning: result.reasoning || "", exists: true },
          overallStyle: result.clothingType
        };
      }

      res.json(result);
    } catch (error: any) {
      console.error("Analysis error:", error);

      // API 失败时返回默认结果（与 UI 结构一致：top/bottom）
      const fallbackResult = {
        top: { type: "上装", recommendedMaterials: ["棉质", "涤纶", "混纺"], reasoning: "AI分析暂时不可用，已返回默认推荐材质。", exists: true },
        bottom: { type: "下装", recommendedMaterials: ["牛仔", "亚麻", "混纺"], reasoning: "AI分析暂时不可用，已返回默认推荐材质。", exists: true },
        overallStyle: "服装"
      };
      res.json(fallbackResult);
    } finally {
      clearTimeout(timeoutId);
    }
  });

  // 辅助：将 base64 图片上传到 Kie 文件服务，返回可访问的 URL（图生图接口只接受 URL，不接受 base64）
  const KIE_FILE_UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload";
  async function uploadBase64ToKie(base64Image: string, apiKey: string): Promise<string> {
    const base64Data =
      typeof base64Image === "string" && base64Image.startsWith("data:")
        ? base64Image
        : `data:image/jpeg;base64,${base64Image}`;
    const uploadRes = await fetch(KIE_FILE_UPLOAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        base64Data,
        uploadPath: "replace",
        fileName: `replace-${Date.now()}.png`,
      }),
    });
    const uploadText = await uploadRes.text();
    if (!uploadRes.ok) {
      throw new Error(`Kie file upload failed: ${uploadRes.status} - ${uploadText.substring(0, 300)}`);
    }
    let uploadJson: any;
    try {
      uploadJson = JSON.parse(uploadText.startsWith("{}") ? uploadText.substring(2) : uploadText);
    } catch {
      throw new Error(`Kie file upload invalid JSON: ${uploadText.substring(0, 200)}`);
    }
    const url = uploadJson?.data?.fileUrl ?? uploadJson?.data?.downloadUrl ?? uploadJson?.fileUrl ?? uploadJson?.downloadUrl;
    if (!url) {
      throw new Error(`Kie file upload: no URL in response. Raw: ${JSON.stringify(uploadJson).substring(0, 300)}`);
    }
    return url;
  }

  // API Routes - 材质替换 (使用 Kie.ai 图生图：先上传图片拿 URL，再用 nano-banana-pro 图生图)
  app.post("/api/replace", async (req, res) => {
    try {
      const { base64Image, materialPrompt, color } = req.body;

      if (!base64Image) {
        return res.status(400).json({ error: "No image provided" });
      }

      const KIE_AI_API_KEY = process.env.KIE_AI_API_KEY;
      if (!KIE_AI_API_KEY) {
        return res.status(500).json({ error: "KIE_AI_API_KEY not configured" });
      }

      // 1. 上传 base64 到 Kie 文件服务，拿到图片 URL（Kie 生图只接受 URL，不接受 base64）
      console.log("Uploading image to Kie file service...");
      const imageUrl = await uploadBase64ToKie(base64Image, KIE_AI_API_KEY);
      console.log("Kie file URL obtained, length:", imageUrl?.length);

      // 2. 使用支持参考图的模型创建生图任务（nano-banana-pro 为图生图，入参为 image_input 数组）
      const colorPrefix = color ? `${color}色的 ` : "";
      const finalPrompt = `将图片中服装的材质替换为${colorPrefix}${materialPrompt}。保持服装的款式、版型和光影效果完全不变，只改变面料材质。专业服装产品摄影，高品质细节，清晰可触摸的材质质感。`;

      const requestBody = {
        model: "nano-banana-pro",
        // 回调能显著提升体感速度：Kie 生成完成会主动通知我们
        callBackUrl: `${process.env.APP_URL || "http://localhost:3001"}/api/callback`,
        input: {
          prompt: finalPrompt,
          image_input: [imageUrl],
          aspect_ratio: "1:1",
          resolution: "1K",
          output_format: "png",
        },
      };

      const createTaskUrl = "https://api.kie.ai/api/v1/jobs/createTask";
      console.log("Creating Kie.ai image generation task (nano-banana-pro)...");
      const response = await fetch(createTaskUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KIE_AI_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Kie.ai createTask error: ${response.status} - ${responseText.substring(0, 500)}`);
      }

      let jsonText = responseText;
      if (responseText.startsWith("{}")) jsonText = responseText.substring(2);
      const data = JSON.parse(jsonText);
      console.log("Kie.ai createTask response:", JSON.stringify(data).substring(0, 400));

      if (data.code != null && data.code !== 200) {
        throw new Error(`Kie.ai API: ${data.code} - ${data.msg || data.message || "Unknown error"}`);
      }

      const taskId =
        data?.data?.taskId ?? data?.data?.recordId ?? data?.data?.id ?? data?.taskId ?? data?.recordId ?? data?.id;
      if (!taskId) {
        throw new Error(`No taskId in response. Raw: ${JSON.stringify(data).substring(0, 300)}`);
      }

      cacheSet({ taskId, status: "pending", updatedAt: Date.now(), raw: { createdAt: Date.now() } });
      res.json({ taskId, status: "pending" });
    } catch (error: any) {
      console.error("Replace material error:", error);
      res.status(500).json({ error: error.message || "Failed to replace material" });
    }
  });

  // API Routes - 查询图片生成任务状态（使用 Kie 文档推荐的 recordInfo 端点）
  app.get("/api/replace/:taskId", async (req, res) => {
    try {
      const { taskId } = req.params;
      const KIE_AI_API_KEY = process.env.KIE_AI_API_KEY;
      if (!KIE_AI_API_KEY) {
        return res.status(500).json({ error: "KIE_AI_API_KEY not configured" });
      }

      // 1) 优先查本地缓存（回调命中时这里会立刻返回）
      const cached = cacheGet(taskId);
      if (cached?.status === "success" && cached.imageUrl) {
        return res.json({ status: "success", imageUrl: cached.imageUrl });
      }
      if (cached?.status === "failed") {
        return res.json({ status: "failed", error: cached.error || "Generation failed" });
      }
      const apiUrl = `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`;

      const response = await fetch(apiUrl, {
        headers: {
          "Authorization": `Bearer ${KIE_AI_API_KEY}`,
        },
      });

      const responseText = await response.text();
      if (!response.ok) {
        console.log("Kie.ai recordInfo error:", responseText.substring(0, 200));
        if (cached) cacheSet({ ...cached, status: "processing", updatedAt: Date.now() });
        res.json({ status: "processing" });
        return;
      }

      let jsonText = responseText;
      if (responseText.startsWith("{}")) {
        jsonText = responseText.substring(2);
      }
      const payload = JSON.parse(jsonText);
      const data = payload?.data ?? payload;
      const state = (data?.state ?? "").toLowerCase();
      const resultJson = data?.resultJson;
      const failMsg = data?.failMsg;

      if (state === "success" && resultJson) {
        let result: any;
        try {
          result = typeof resultJson === "string" ? JSON.parse(resultJson) : resultJson;
        } catch (e) {
          console.warn("Parse resultJson failed:", e);
          if (cached) cacheSet({ ...cached, status: "processing", updatedAt: Date.now() });
          res.json({ status: "processing" });
          return;
        }
        // 兼容多种返回格式，并打印便于排查
        const url = extractImageUrlFromResult(result);
        if (url && typeof url === "string") {
          console.log("Kie task success, imageUrl:", url.substring(0, 100) + "...");
          cacheSet({ taskId, status: "success", imageUrl: url, updatedAt: Date.now(), raw: payload });
          res.json({ status: "success", imageUrl: url });
        } else {
          console.warn("Kie task success but no URL. result keys:", result ? Object.keys(result) : [], "sample:", JSON.stringify(result).substring(0, 300));
          cacheSet({ taskId, status: "failed", error: "No image URL in result", updatedAt: Date.now(), raw: payload });
          res.json({ status: "failed", error: "No image URL in result" });
        }
      } else if (state === "fail") {
        cacheSet({ taskId, status: "failed", error: String(failMsg || "Generation failed"), updatedAt: Date.now(), raw: payload });
        res.json({ status: "failed", error: failMsg || "Generation failed" });
      } else {
        cacheSet({ taskId, status: "processing", updatedAt: Date.now(), raw: payload });
        res.json({ status: "processing" });
      }
    } catch (error: any) {
      console.error("Query task error:", error);
      res.json({ status: "processing" });
    }
  });

  // Vite middleware for development (Connect 型，用类型断言兼容 Express)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, port: parseInt(String(PORT)) },
      appType: "spa",
    });
    app.use(vite.middlewares as express.RequestHandler);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  // 仅在本机/非 Vercel 环境启动 listen，Vercel 使用导出的 app 作为 handler
  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`COS Bucket: ${Bucket}`);
      console.log(`COS Region: ${Region}`);
    });
  }
}

// 始终执行 startServer 以注册路由；Vercel 下不执行 listen，由平台调用导出的 handler
startServer();

// VERCEL Serverless 导出 - 让 VERCEL 可以调用这个 Express 应用
export { app as handler };

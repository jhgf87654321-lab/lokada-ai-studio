import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("materials.db");

// Initialize database
db.exec(`
  DROP TABLE IF EXISTS materials;
  CREATE TABLE materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    thumbnail_url TEXT,
    texture_prompt TEXT NOT NULL
  )
`);

// Seed data
const insert = db.prepare(`
  INSERT INTO materials (name, type, description, thumbnail_url, texture_prompt)
  VALUES (?, ?, ?, ?, ?)
`);

const sampleMaterials = [
  ["真丝绸缎", "丝绸", "光滑、有光泽的织物，具有优美的垂坠感。", "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?q=80&w=400&auto=format&fit=crop", "luxurious smooth glossy silk satin fabric with elegant folds"],
  ["厚重丹宁", "棉", "耐用、粗犷的斜纹棉布。", "https://images.unsplash.com/photo-1542272604-787c3835535d?q=80&w=400&auto=format&fit=crop", "rugged blue heavy denim texture with visible twill weave"],
  ["羊绒羊毛", "羊毛", "极度柔软温暖的奢华纤维。", "https://images.unsplash.com/photo-1520032484190-e5ef81d87978?q=80&w=400&auto=format&fit=crop", "soft fuzzy grey cashmere wool knit texture"],
  ["灯芯绒", "棉", "具有独特垂直条纹的纹理织物。", "https://images.unsplash.com/photo-1584589330011-479a42943f20?q=80&w=400&auto=format&fit=crop", "brown corduroy coat close-up texture"],
  ["亚麻", "亚麻", "透气、轻便的织物，具有自然纹理。", "https://picsum.photos/seed/linen-weave/400/400", "natural beige linen fabric with visible irregular weave"],
  ["皮革", "动物皮", "由动物皮制成的坚韧、柔韧的材料。", "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?q=80&w=400&auto=format&fit=crop", "premium black pebbled leather texture"],
  ["天鹅绒", "合成/丝绸", "柔软、豪华的织物，具有短而密的绒毛。", "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=400&auto=format&fit=crop", "deep emerald green plush velvet fabric with soft sheen"],
  ["粗花呢", "羊毛", "粗糙、紧密编织的羊毛织物。", "https://images.unsplash.com/photo-1621184455862-c163dfb30e0f?q=80&w=400&auto=format&fit=crop", "classic chanel style tweed wool fabric texture"],
];

for (const material of sampleMaterials) {
  insert.run(...material);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.get("/api/materials", (req, res) => {
    try {
      const materials = db.prepare("SELECT * FROM materials").all();
      res.json(materials);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch materials" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

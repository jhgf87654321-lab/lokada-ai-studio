import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Upload, Sparkles, LogOut, User, ImageIcon, Loader2, Download, Copy, Check, X, ChevronRight } from "lucide-react";
import { Material, AnalysisResult, PartAnalysis } from "./types";
import { analyzeClothing, replaceMaterial, generateImage } from "./services/geminiService";

// CloudBase 认证辅助函数
async function isCloudbaseLoggedIn(auth: any): Promise<boolean> {
  if (!auth) return false;
  try {
    const { data: sessionData } = await auth.getSession();
    if (!sessionData?.session) return false;
    const { data: userData } = await auth.getUser();
    if (!userData?.user) return false;
    const user = userData.user;
    return Boolean(user.email || user.phone || user.user_metadata?.username);
  } catch {
    return false;
  }
}

function normalizeCNPhone(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (!digits || digits.length !== 11) return "";
  return `+86 ${digits}`;
}

function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
}

interface UserInfo {
  userId: string;
  phone?: string;
  email?: string;
  nickname?: string;
}

interface AdminMaterialRow {
  id: string;
  name: string;
  description: string;
  thumbnailKey: string;
  thumbnailUrl: string;
  prompt: string;
  order?: number;
}

export default function App() {
  const MAX_IMAGE_UPLOAD_MB = 10;
  const MAX_IMAGE_UPLOAD_BYTES = MAX_IMAGE_UPLOAD_MB * 1024 * 1024;
  const [view, setView] = useState<"studio" | "generate" | "admin">("studio");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);

  // Login form state
  const [loginMethod, setLoginMethod] = useState<"phone" | "email">("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Upload state（AI 生图页：原图和参考图都用 base64 存）
  const [uploadedImage, setUploadedImage] = useState<string | null>(null); // 原图
  const [referenceImage, setReferenceImage] = useState<string | null>(null); // 参考风格图
  const [uploading, setUploading] = useState(false);

  // Generate state（文生图 / 图生图）
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  // Studio state
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  // Top/Bottom selection (FabricFlow style)
  const [topMaterial, setTopMaterial] = useState<Material | null>(null);
  const [topCustomMaterial, setTopCustomMaterial] = useState<string | null>(null);
  const [topColor, setTopColor] = useState<string | null>(null);
  const [topColorText, setTopColorText] = useState<string>("");
  const [bottomMaterial, setBottomMaterial] = useState<Material | null>(null);
  const [bottomCustomMaterial, setBottomCustomMaterial] = useState<string | null>(null);
  const [bottomColor, setBottomColor] = useState<string | null>(null);
  const [bottomColorText, setBottomColorText] = useState<string>("");
  const [activePart, setActivePart] = useState<"top" | "bottom">("top");
  const [replacing, setReplacing] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [resultImageLoadError, setResultImageLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pantoneCoatedMap, setPantoneCoatedMap] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);          // 原图上传
  const referenceInputRef = useRef<HTMLInputElement>(null);     // 参考图上传
  const generateSectionRef = useRef<HTMLDivElement | null>(null); // AI 生图区域（用于滚动）
  const studioResultBottomRef = useRef<HTMLDivElement | null>(null); // Studio 结果区域（手机端滚动）

  const [isAdmin, setIsAdmin] = useState(false);

  // 根据 URL 查询参数决定是否进入管理员模式（?admin=1）
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("admin") === "1") {
        setIsAdmin(true);
        setView("admin");
      }
    }
  }, []);

  // 当切换到 AI 生图视图时，在手机端自动滚动到生图区域
  useEffect(() => {
    if (view === "generate" && typeof window !== "undefined" && window.innerWidth < 768) {
      if (generateSectionRef.current) {
        generateSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [view]);

  // Studio：生成结果后，手机端自动滚到页面底部（步骤 05）
  useEffect(() => {
    if (!resultImage) return;
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      // 等图片容器渲染后再滚动，避免跳不到正确位置
      setTimeout(() => {
        studioResultBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }, [resultImage]);

  // 监听 mpfff.icu postMessage，自动接收颜色值（若对方支持）
  const activePartRef = useRef(activePart);
  useEffect(() => {
    activePartRef.current = activePart;
  }, [activePart]);
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== "https://mpfff.icu") return;
      const d = e.data;
      if (!d || typeof d !== "object") return;
      const hex = d.hex || d.color || d.hexCode;
      const name = d.name || d.pantone;
      const val = [hex, name].filter(Boolean).join(" ");
      if (!val) return;
      if (activePartRef.current === "top") setTopColorText(val);
      else setBottomColorText(val);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // 加载完整 Pantone C 数据集（数字+C 全部支持）
  useEffect(() => {
    fetch("https://raw.githubusercontent.com/brettapeters/pantones/master/pantone-coated.json")
      .then((r) => r.json())
      .then((arr: { pantone: string; hex: string }[]) => {
        const m: Record<string, string> = {};
        arr.forEach(({ pantone, hex }) => {
          const key = pantone.toLowerCase().replace(/\s/g, "");
          m[key] = hex;
          m[key.replace("-", "")] = hex;
        });
        setPantoneCoatedMap(m);
      })
      .catch(() => {});
  }, []);

  // Check login status and fetch materials on mount
  useEffect(() => {
    checkLoginStatus();
    fetch("/api/materials")
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) {
          console.warn("Materials API returned", res.status, text.slice(0, 80));
          return [];
        }
        try {
          return JSON.parse(text) as Material[];
        } catch {
          console.warn("Materials API returned non-JSON:", text.slice(0, 80));
          return [];
        }
      })
      .then((data) => setMaterials(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error("Error fetching materials:", err);
        setMaterials([]);
      });
  }, []);

  // Poll task status when taskId is set
  useEffect(() => {
    if (!taskId) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/generate/${taskId}`);
        const data = await response.json();

        if (data.status === "completed" && data.outputUrl) {
          setGeneratedImage(data.outputUrl);
          setGenerating(false);
          clearInterval(pollInterval);
        } else if (data.status === "failed") {
          setGenerating(false);
          clearInterval(pollInterval);
        }
      } catch (error) {
        console.error("Poll error:", error);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [taskId]);

  async function checkLoginStatus() {
    try {
      const { getCloudbaseAuth } = await import("./services/cloudbaseAuth");
      const auth = getCloudbaseAuth();
      if (!auth) {
        setLoading(false);
        return;
      }

      const loggedIn = await isCloudbaseLoggedIn(auth);
      if (loggedIn) {
        const { data: userData } = await auth.getUser();
        if (userData?.user) {
          const u = userData.user as Record<string, unknown>;
          const meta = (u.user_metadata as Record<string, unknown>) || {};
          setUser({
            userId: (u.userId as string) || (u.uid as string) || "",
            phone: u.phone as string | undefined,
            email: u.email as string | undefined,
            nickname: (meta.nickname as string) || (meta.nickName as string) || (meta.name as string),
          });
        }
      }
    } catch (error) {
      console.error("Check login error:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);

    if (loginMethod === "phone") {
      if (!phone.trim() || !password.trim()) {
        setLoginError("请填写手机号和密码");
        setLoginLoading(false);
        return;
      }
      if (!normalizeCNPhone(phone)) {
        setLoginError("请输入有效的11位手机号");
        setLoginLoading(false);
        return;
      }
    } else {
      if (!email.trim() || !password.trim()) {
        setLoginError("请填写邮箱和密码");
        setLoginLoading(false);
        return;
      }
      if (!validateEmail(email)) {
        setLoginError("请输入有效的邮箱地址");
        setLoginLoading(false);
        return;
      }
    }

    try {
      const { getCloudbaseAuth, loginWithPhonePassword, loginWithEmailPassword } = await import("./services/cloudbaseAuth");
      const auth = getCloudbaseAuth();
      if (!auth) {
        setLoginError("CloudBase 未初始化");
        setLoginLoading(false);
        return;
      }

      let result;
      if (loginMethod === "phone") {
        result = await loginWithPhonePassword(normalizeCNPhone(phone), password);
      } else {
        result = await loginWithEmailPassword(email.toLowerCase(), password);
      }

      if (result.error) {
        throw new Error(result.error.message || "登录失败");
      }

      await checkLoginStatus();
      setShowLogin(false);
    } catch (err: any) {
      const rawMsg = err?.message || "";
      if (loginMethod === "phone") {
        if (rawMsg.includes("phone")) {
          setLoginError("手机号登录未启用或手机号/密码错误");
        } else {
          setLoginError(rawMsg || "登录失败");
        }
      } else {
        if (rawMsg.includes("email")) {
          setLoginError("邮箱登录未启用或邮箱/密码错误");
        } else {
          setLoginError(rawMsg || "登录失败");
        }
      }
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    try {
      const { logout } = await import("./services/cloudbaseAuth");
      await logout();
      setUser(null);
      setUploadedImage(null);
      setGeneratedImage(null);
    } catch (error) {
      console.error("Logout error:", error);
    }
  }

  // AI 生图页原图上传：不再走 COS，直接读为 base64 供 Gemini 使用
  async function handleCOSUpload(file: File) {
    if (!file) return;
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      alert(`图片过大（>${MAX_IMAGE_UPLOAD_MB}MB），请压缩后再上传。`);
      return;
    }
    setUploading(true);
    try {
      await new Promise<void>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target?.result as string;
          setUploadedImage(base64);
          resolve();
        };
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(file);
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      alert(`上传失败: ${error.message || error}`);
    } finally {
      setUploading(false);
    }
  }

  // 参考风格图上传：同样以 base64 形式保存在前端
  const handleReferenceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      alert(`参考图过大（>${MAX_IMAGE_UPLOAD_MB}MB），请压缩后再上传。`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setReferenceImage(base64);
    };
    reader.readAsDataURL(file);
  };

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setGeneratedImage(null);
    setTaskId(null);
    try {
      const imageUrl = await generateImage(prompt, uploadedImage || undefined, referenceImage || undefined);
      setGeneratedImage(imageUrl);
    } catch (error: any) {
      console.error("Generate error:", error);
      alert(`生成失败: ${error.message}`);
      setGenerating(false);
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
        setError(`图片过大（>${MAX_IMAGE_UPLOAD_MB}MB），请压缩后再上传。`);
        return;
      }
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        setSelectedImage(base64);
        setAnalysis(null);
        setResultImage(null);
        setTopMaterial(null);
        setTopCustomMaterial(null);
        setTopColor(null);
        setBottomMaterial(null);
        setBottomCustomMaterial(null);
        setBottomColor(null);
        setError(null);
        setAnalyzing(true);
        try {
          const result = await analyzeClothing(base64);
          setAnalysis(result);
          // 与 UI 逻辑统一：按 top/bottom.exists 分配默认材质，设置 activePart
          if (result.top?.exists && result.top.recommendedMaterials?.length > 0) {
            setTopCustomMaterial(result.top.recommendedMaterials[0]);
          }
          if (result.bottom?.exists && result.bottom.recommendedMaterials?.length > 0) {
            setBottomCustomMaterial(result.bottom.recommendedMaterials[0]);
          }
          if (!result.top?.exists && result.bottom?.exists) {
            setActivePart("bottom");
          } else {
            setActivePart("top");
          }
        } catch (err) {
          console.error("Analysis failed:", err);
          setError("图片分析失败，请重试。");
        } finally {
          setAnalyzing(false);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleReplace = async () => {
    const topPrompt = topMaterial?.texture_prompt || topCustomMaterial;
    const bottomPrompt = bottomMaterial?.texture_prompt || bottomCustomMaterial;
    if (!selectedImage || (!topPrompt && !bottomPrompt)) return;
    setReplacing(true);
    setError(null);
    try {
      setResultImageLoadError(false);
      const parts: string[] = [];
      const topColorLabel = topColorText || topColor || "";
      const bottomColorLabel = bottomColorText || bottomColor || "";
      if (topPrompt) parts.push(`上装${topColorLabel ? `（${topColorLabel}）` : ""}${topPrompt}`);
      if (bottomPrompt) parts.push(`下装${bottomColorLabel ? `（${bottomColorLabel}）` : ""}${bottomPrompt}`);
      const materialPrompt = parts.join("，") || "替换材质";
      const result = await replaceMaterial(selectedImage, materialPrompt, undefined);
      setResultImage(result);
    } catch (err) {
      console.error("Replacement failed:", err);
      const message = err instanceof Error && err.message ? err.message : "材质替换失败。";
      setError(message);
    } finally {
      setReplacing(false);
    }
  };

  const renderAnalysisPart = (part: "top" | "bottom", data: PartAnalysis) => {
    if (!data?.exists) return null;
    return (
      <div className="space-y-6 p-8 bg-white/5 backdrop-blur-xl rounded-[2.5rem] border border-white/10 relative overflow-hidden">
        <div className="flex items-center justify-between relative z-10">
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/50 font-display">
              {part === "top" ? "上装分析" : "下装分析"}
            </p>
            <h3 className="text-2xl font-black text-white font-sans">{data.type}</h3>
          </div>
          <div className="w-10 h-10 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20">
            <ChevronRight className="w-5 h-5 text-white rotate-90" />
          </div>
        </div>
        <div className="h-px bg-white/10 w-full relative z-10" />
        <p className="text-sm leading-relaxed text-white/80 font-medium relative z-10">{data.reasoning}</p>
        <div className="space-y-4 relative z-10">
          <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] font-display">推荐材质 / Recommended</p>
          <div className="flex flex-wrap gap-2">
            {data.recommendedMaterials.map((mat: string, i: number) => {
              const isSelected = part === "top" ? topCustomMaterial === mat : bottomCustomMaterial === mat;
              return (
                <button
                  key={i}
                  onClick={() => handleRecommendClick(mat, part)}
                  className={`px-5 py-2.5 rounded-full text-[11px] font-black transition-all cursor-pointer font-display uppercase tracking-wider ${isSelected ? "bg-brand text-white shadow-xl shadow-brand/20 border-brand" : "bg-white/10 text-white border border-white/10 hover:bg-white/20"}`}
                >
                  {mat}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const handleRecommendClick = (matName: string, part: "top" | "bottom") => {
    const match = materials.find((m) => {
      const name = m.name || "";
      const type = (m as any).type ? String((m as any).type) : "";
      return (
        (name && name.includes(matName)) ||
        (matName && matName.includes(name)) ||
        (type && type.includes(matName))
      );
    });
    if (part === "top") {
      setTopCustomMaterial(matName);
      setTopMaterial(match || null);
      setActivePart("top");
    } else {
      setBottomCustomMaterial(matName);
      setBottomMaterial(match || null);
      setActivePart("bottom");
    }
  };

  // Pantone 编号/名称 → hex 映射（mpfff.icu 常用 + 常见 Pantone C，支持 293C / 293 C 等格式）
  const PANTONE_TO_HEX: Record<string, string> = {
    "300 c": "#005EB8", "300c": "#005EB8",
    "293 c": "#0046AD", "293c": "#0046AD",
    "112 c": "#9C8412", "112c": "#9C8412",
    "185 c": "#E4002B", "185c": "#E4002B",
    "process blue c": "#0085CA", "process blue": "#0085CA",
    "reflex blue c": "#001489", "reflex blue": "#001489",
    "yellow c": "#FEDD00", "yellow": "#FEDD00",
    "warm red c": "#F9423A", "warm red": "#F9423A",
    "green c": "#00AB84", "green": "#00AB84",
    "orange 021 c": "#FE5000", "orange 021": "#FE5000", "021 c": "#FE5000",
    "purple c": "#BB29BB", "purple": "#BB29BB",
    "nebulas blue": "#2D62A3", "nebulasblue": "#2D62A3",
    "hawaiian surf": "#00A3B5", "hawaiiansurf": "#00A3B5",
    "iris bloom": "#5B5FAA", "irisbloom": "#5B5FAA",
    "indigo bunting": "#3D7AB5", "indigobunting": "#3D7AB5",
    "blue horizon": "#5D8DC4", "bluehorizon": "#5D8DC4",
    "fjord blue": "#006994", "fjordblue": "#006994",
    "gray blue": "#6B8E9F", "grayblue": "#6B8E9F",
    "301 c": "#005293", "302 c": "#003D7A", "286 c": "#0033A0",
    "187 c": "#C8102E", "194 c": "#862633", "199 c": "#E40046",
    "7481 c": "#009639", "7482 c": "#2E7D32", "7483 c": "#4CAF50",
    "116 c": "#FFCD00", "109 c": "#FFD100", "1235 c": "#FFC72C",
    "2767 c": "#512D6D", "2685 c": "#6C1D87", "2597 c": "#6E1B62",
  };

  const hexToRgb = (hex: string): string | null => {
    const m = hex.slice(1).match(hex.length <= 4 ? /^(.)(.)(.)$/ : /^(..)(..)(..)/);
    if (!m) return null;
    const r = hex.length <= 4 ? parseInt(m[1] + m[1], 16) : parseInt(m[1], 16);
    const g = hex.length <= 4 ? parseInt(m[2] + m[2], 16) : parseInt(m[2], 16);
    const b = hex.length <= 4 ? parseInt(m[3] + m[3], 16) : parseInt(m[3], 16);
    return `rgb(${r},${g},${b})`;
  };

  // 从 mpfff.icu 导出的颜色文本（hex/rgb/pantone 编号/名称）解析为 CSS 颜色值
  const parseColorFromText = (text: string): string | null => {
    if (!text?.trim()) return null;
    const t = text.trim();
    const hex = t.match(/#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/)?.[0];
    if (hex) return hexToRgb(hex);
    const rgb = t.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgb) return `rgb(${rgb[1]},${rgb[2]},${rgb[3]})`;
    const key = t.toLowerCase().replace(/\s+/g, " ").trim();
    const keyNoPrefix = key.replace(/^(pantone|p)\s*/i, "").trim();
    const keysToTry = [
      key,
      key.replace(/\s/g, ""),
      keyNoPrefix,
      keyNoPrefix.replace(/\s/g, ""),
      key.replace(/\s+c\s*$/i, "").trim(),
      key.replace(/\s*[-–(].*$/, "").trim(),
      key.replace(/\s+c\s*$/i, "").replace(/\s/g, "").trim(),
    ];
    for (const k of keysToTry) {
      const pantoneHex = PANTONE_TO_HEX[k];
      if (pantoneHex) return hexToRgb(pantoneHex);
    }
    const numC = t.match(/(?:pantone|p)?\s*(\d+)\s*c\b/i);
    if (numC && Object.keys(pantoneCoatedMap).length > 0) {
      const n = numC[1];
      const coatedHex = pantoneCoatedMap[`${n}-c`] || pantoneCoatedMap[`${n}c`];
      if (coatedHex) return hexToRgb(coatedHex.startsWith("#") ? coatedHex : `#${coatedHex}`);
    }
    return null;
  };

  const colors = [
    { name: "原始", value: null, class: "bg-transparent border border-white/10" },
    { name: "黑色", value: "黑", class: "bg-black" },
    { name: "白色", value: "白", class: "bg-white border border-white/10" },
    { name: "红色", value: "红", class: "bg-red-500" },
    { name: "蓝色", value: "蓝", class: "bg-blue-500" },
    { name: "绿色", value: "绿", class: "bg-green-500" },
    { name: "黄色", value: "黄", class: "bg-yellow-400" },
    { name: "粉色", value: "粉", class: "bg-pink-400" },
    { name: "紫色", value: "紫", class: "bg-brand" },
    { name: "棕色", value: "棕", class: "bg-amber-800" },
    { name: "灰色", value: "灰", class: "bg-gray-500" },
  ];

  const getColorSwatch = (value: string | null, text: string): { class?: string; style?: React.CSSProperties } => {
    const rgb = parseColorFromText(text);
    if (rgb) return { style: { backgroundColor: rgb } };
    const c = colors.find((x) => x.value === value);
    if (c) return { class: c.class };
    return {};
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center flowing-bg cyber-grid">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white font-sans flowing-bg cyber-grid overflow-hidden flex flex-col selection:bg-brand selection:text-white">
      {/* Flowing Curves Background */}
      <svg className="flowing-curves fixed inset-0 w-full h-full pointer-events-none z-0" viewBox="0 0 1440 900" preserveAspectRatio="none">
        <defs>
          <linearGradient id="curveGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="50%" stopColor="#6A38B0" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
        {[...Array(10)].map((_, i) => (
          <path
            key={i}
            className="curve-path"
            d={`M 0,${50 + i * 100} C 360,${i * 100 - (i % 2 === 0 ? 150 : -150)} 720,${100 + i * 100 + (i % 2 === 0 ? 150 : -150)} 720,${100 + i * 100 + (i % 2 === 0 ? 150 : -150)} C 1080,${i * 100 - (i % 2 === 0 ? 150 : -150)} 1440,${50 + i * 100} 1440,${50 + i * 100}`}
            style={{ animationDelay: `${i * -2.5}s`, animationDuration: `${12 + (i % 3) * 3}s`, opacity: 0.5 + (i * 0.04) }}
          />
        ))}
      </svg>
      {/* Header */}
      <header className="bg-[#050505]/60 border-b border-white/10 px-4 py-3 md:px-8 md:py-4 flex justify-between items-center flex-shrink-0 backdrop-blur-2xl">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center shadow-lg shadow-brand/40">
            <Sparkles className="text-white w-5 h-5" />
          </div>
          <h1 className="text-xl font-black tracking-tight font-display uppercase">LOKADA AI Studio</h1>
          <div className="flex gap-2 ml-4">
            <button
              onClick={() => setView("studio")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors font-display tracking-[0.15em] uppercase ${
                view === "studio"
                  ? "bg-brand text-white shadow-md shadow-brand/40"
                  : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              材质库
            </button>
            <button
              onClick={() => setView("generate")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors font-display tracking-[0.15em] uppercase ${
                view === "generate"
                  ? "bg-brand text-white shadow-md shadow-brand/40"
                  : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              AI 生图
            </button>
            {isAdmin && (
              <button
                onClick={() => setView("admin")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors font-display tracking-[0.15em] uppercase ${
                  view === "admin"
                    ? "bg-amber-500 text-black shadow-md shadow-amber-400/40"
                    : "bg-white/5 text-amber-300 hover:bg-amber-500/10"
                }`}
              >
                Admin 材质库
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <span className="text-xs text-white/60 font-medium">
                {user.phone || user.email || user.nickname || user.userId}
              </span>
              <button onClick={handleLogout} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
                <LogOut className="w-5 h-5" />
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowLogin(true)}
              className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors font-display text-xs uppercase tracking-[0.15em] shadow-lg shadow-brand/40"
            >
              <User className="w-4 h-4" />
              登录
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto px-4 py-6 md:p-8">
        <div className="max-w-7xl mx-auto h-full relative z-10">
        {view === "admin" && isAdmin ? (
          <AdminMaterials />
        ) : view === "studio" ? (
          <>
            {/* Hero Title - FabricFlow style */}
            <div className="mb-10 max-w-3xl">
              <h2 className="text-3xl md:text-4xl lg:text-5xl leading-[1.1] font-black font-display uppercase tracking-tighter mb-2">
                进入 <span className="text-brand">AI 材质</span> 与 <span className="text-brand">智能设计</span> 的世界
              </h2>
              <p className="text-sm text-white/50 font-medium">上传服装图片，AI 分析并推荐材质，一键替换面料效果</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left Column: Upload & Analysis */}
              <div className="lg:col-span-7 space-y-8">
                <section className="bg-white/5 backdrop-blur-2xl rounded-[3rem] p-10 shadow-2xl border border-white/10 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-brand/20 blur-[100px] -mr-32 -mt-32" />
                  <div className="relative z-10">
                    <div className="flex justify-between items-start mb-10">
                      <div>
                        <p className="text-[14px] font-black uppercase tracking-[0.3em] text-brand mb-2 font-display drop-shadow-[0_0_15px_rgba(106,56,176,1)]">步骤 01</p>
                        <h3 className="text-lg font-black font-display uppercase text-white">上传服装图片</h3>
                      </div>
                      <button onClick={() => fileInputRef.current?.click()} className="w-14 h-14 bg-brand rounded-full flex items-center justify-center shadow-xl shadow-brand/40 hover:scale-110 transition-all group-hover:rotate-45">
                        <Upload className="text-white w-6 h-6" />
                      </button>
                    </div>
                    <div onClick={() => fileInputRef.current?.click()} className={`relative aspect-[16/10] rounded-[2rem] border-2 border-dashed transition-all cursor-pointer flex items-center justify-center overflow-hidden ${selectedImage ? "border-transparent" : "border-white/10 hover:border-white/20 bg-white/5"}`}>
                      {selectedImage ? (
                        <img src={selectedImage} alt="Uploaded garment" className="w-full h-full object-contain" />
                      ) : (
                        <div className="text-center space-y-4">
                          <div className="w-16 h-16 bg-brand/20 rounded-full flex items-center justify-center mx-auto">
                            <ImageIcon className="w-8 h-8 text-brand/60" />
                          </div>
                          <p className="text-sm text-white/60 font-medium">拖拽图片至此处或点击浏览</p>
                        </div>
                      )}
                      <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                    </div>
                  </div>
                </section>

                <AnimatePresence>
                  {(analyzing || analysis) && (
                    <motion.section initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} className="bg-white/5 backdrop-blur-2xl rounded-[3rem] p-10 shadow-2xl border border-white/10">
                      <div className="flex items-center justify-between mb-8">
                        <div>
                          <p className="text-[14px] font-black uppercase tracking-[0.3em] text-brand font-display drop-shadow-[0_0_10px_rgba(106,56,176,0.8)] mb-2">步骤 02</p>
                          <h2 className="text-lg font-black uppercase font-display tracking-tight">AI 智能分析</h2>
                        </div>
                        {analyzing && <Loader2 className="w-5 h-5 animate-spin text-brand" />}
                      </div>
                      {analyzing ? (
                        <div className="py-10 text-center">
                          <p className="text-sm text-brand/60 font-bold uppercase tracking-widest font-display animate-pulse">正在分析服装材质...</p>
                        </div>
                      ) : analysis && (
                        <div className="space-y-8">
                          <div className="p-8 bg-white/5 backdrop-blur-xl rounded-[2.5rem] border border-white/10 shadow-xl flex items-center gap-6">
                            <div className="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center shadow-lg shadow-brand/40 shrink-0">
                              <Sparkles className="text-white w-8 h-8" />
                            </div>
                            <div className="space-y-1">
                              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/50 font-display">整体风格 / Overall Style</p>
                              <p className="text-xl font-black text-white font-sans leading-tight">{analysis.overallStyle}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {renderAnalysisPart("top", analysis.top)}
                            {renderAnalysisPart("bottom", analysis.bottom)}
                          </div>
                        </div>
                      )}
                    </motion.section>
                  )}
                </AnimatePresence>

                {/* Studio 生成结果：桌面端在左列显示；手机端挪到页面底部 */}
                {resultImage && (
                  <motion.section initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="hidden lg:block bg-white/5 backdrop-blur-2xl rounded-[3rem] pt-8 pb-4 px-10 shadow-2xl border border-white/10 relative overflow-hidden group">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="text-[14px] font-black uppercase tracking-[0.3em] text-brand mb-1 font-display drop-shadow-[0_0_15px_rgba(106,56,176,1)]">步骤 05</p>
                        <h3 className="text-lg font-black font-display uppercase text-white">生成结果</h3>
                      </div>
                    </div>
                    <div className="aspect-[16/10] rounded-[2rem] overflow-hidden bg-white/5 flex items-center justify-center border border-white/10 relative group/img">
                      {resultImageLoadError ? (
                        <div className="flex flex-col gap-2 text-center text-sm text-white/60 p-4">
                          <p>图片加载失败（可能因外链限制）</p>
                          <a href={resultImage} target="_blank" rel="noopener noreferrer" className="text-brand font-bold underline">在新标签页打开查看</a>
                        </div>
                      ) : (
                        <>
                          <img src={resultImage} alt="Result" className="w-full h-full object-contain" referrerPolicy="no-referrer" onError={() => setResultImageLoadError(true)} />
                          <div className="absolute bottom-6 right-6 opacity-0 group-hover/img:opacity-100 transition-opacity">
                            <a href={resultImage} download="lokada-design.png" className="px-6 py-3 bg-brand text-white text-[10px] font-black rounded-full uppercase font-display shadow-xl shadow-brand/40 hover:scale-105 transition-all flex items-center gap-2">
                              下载设计图 <ChevronRight className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.section>
                )}
              </div>

              {/* Right Column: Material Library */}
              <div className="lg:col-span-5 space-y-8">
                <section className="bg-white/5 backdrop-blur-2xl rounded-[3rem] p-10 shadow-2xl border border-white/10 flex flex-col min-h-[800px]">
                  <div className="flex justify-between items-center mb-10">
                    <div>
                      <p className="text-[14px] font-black uppercase tracking-[0.3em] text-brand font-display drop-shadow-[0_0_10px_rgba(106,56,176,0.8)] mb-2">步骤 03</p>
                      <div className="flex items-baseline gap-3 whitespace-nowrap">
                        <h2 className="text-lg font-black uppercase font-display tracking-tight shrink-0">材质库</h2>
                        <span className="text-[12px] font-bold text-white/70">（优先使用智能分析推荐，或从下方选择）</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 md:gap-6 overflow-y-auto max-h-[500px] pr-2 md:pr-4 custom-scrollbar mb-8 md:mb-10">
                    {materials.map((material) => {
                      const isSelected = activePart === "top" ? topMaterial?.id === material.id : bottomMaterial?.id === material.id;
                      return (
                        <motion.div
                          key={material.id}
                          whileHover={{ y: -5 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => {
                            if (activePart === "top") {
                              setTopMaterial(material);
                              setTopCustomMaterial(null);
                            } else {
                              setBottomMaterial(material);
                              setBottomCustomMaterial(null);
                            }
                          }}
                          className={`group relative rounded-[1.75rem] md:rounded-[2rem] border-2 transition-all cursor-pointer overflow-hidden ${isSelected ? "border-brand bg-brand/10" : "border-white/5 hover:border-brand/30 bg-white/5"}`}
                        >
                          <div className="aspect-square overflow-hidden">
                            <img src={material.thumbnail_url} alt={material.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" referrerPolicy="no-referrer" />
                          </div>
                          <div className="p-3 md:p-4 space-y-1">
                            <p className="text-[11px] md:text-xs font-black uppercase font-display truncate text-white">{material.name}</p>
                            {material.description && (
                              <p className="text-[10px] md:text-[11px] text-white/40 leading-snug line-clamp-2 md:line-clamp-3">
                                {material.description}
                              </p>
                            )}
                          </div>
                          {isSelected && (
                            <div className="absolute top-3 right-3 w-6 h-6 bg-brand rounded-full flex items-center justify-center shadow-lg shadow-brand/40">
                              <Check className="text-white w-3.5 h-3.5" />
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>

                  <div className="mt-auto space-y-8">
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-[14px] font-black uppercase tracking-[0.3em] text-brand font-display drop-shadow-[0_0_10px_rgba(106,56,176,0.8)] mb-2">步骤 04</p>
                          <p className="text-lg font-black text-white uppercase tracking-[0.2em] font-display">调色盘 ({activePart === "top" ? "上装" : "下装"})</p>
                        </div>
                        {((activePart === "top" && (topColor || topColorText)) || (activePart === "bottom" && (bottomColor || bottomColorText))) && (
                          <button
                            onClick={() => {
                              if (activePart === "top") {
                                setTopColor(null);
                                setTopColorText("");
                              } else {
                                setBottomColor(null);
                                setBottomColorText("");
                              }
                            }}
                            className="text-[10px] font-black text-brand uppercase font-display"
                          >
                            重置
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-4 items-center">
                        {colors.map((color) => {
                          const isSelected = color.value === null
                            ? (activePart === "top" ? topColor === null && !topColorText : bottomColor === null && !bottomColorText)
                            : (activePart === "top" ? topColor === color.value : bottomColor === color.value);
                          return (
                            <button
                              key={color.name}
                              onClick={() => {
                                if (activePart === "top") {
                                  setTopColor(color.value);
                                  setTopColorText("");
                                } else {
                                  setBottomColor(color.value);
                                  setBottomColorText("");
                                }
                              }}
                              title={color.name}
                              className={`w-11 h-11 rounded-full transition-all flex items-center justify-center relative border border-white/10 ${color.class} ${isSelected ? "ring-4 ring-white/30 ring-offset-4 ring-offset-[#050505] scale-110 border-white/40" : "hover:scale-110 hover:border-white/30"}`}
                            >
                              {isSelected && (
                                <Check className={`w-4 h-4 relative z-10 ${color.value === "白" || color.value === "黄" || color.value === null ? "text-black" : "text-white"}`} />
                              )}
                            </button>
                          );
                        })}
                        {(() => {
                          const customText = activePart === "top" ? topColorText : bottomColorText;
                          const rgb = parseColorFromText(customText);
                          const isCustomSelected = activePart === "top" ? !!topColorText && !topColor : !!bottomColorText && !bottomColor;
                          return (
                            <button
                              key="mpfff"
                              onClick={() => {
                                if (activePart === "top") {
                                  setTopColor(null);
                                  setTopColorText(customText);
                                } else {
                                  setBottomColor(null);
                                  setBottomColorText(customText);
                                }
                              }}
                              title={rgb ? `mpfff.icu: ${rgb}` : "输入 hex/Pantone 添加自定义颜色"}
                              className={`w-11 h-11 rounded-full transition-all flex items-center justify-center relative border border-white/10 shrink-0 ${isCustomSelected ? "ring-4 ring-white/30 ring-offset-4 ring-offset-[#050505] scale-110 border-white/40" : "hover:scale-110 hover:border-white/30"} ${!rgb ? "border-dashed bg-white/5" : ""}`}
                              style={rgb ? { backgroundColor: rgb } : undefined}
                            >
                              {rgb && isCustomSelected && (
                                <Check className="w-4 h-4 relative z-10 text-white drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]" />
                              )}
                              {!rgb && <span className="text-white/40 text-[10px] font-bold">+</span>}
                            </button>
                          );
                        })()}
                      </div>
                      <div className="mt-4 space-y-2 text-[11px] text-white/50">
                        <p>
                          更多颜色请到{" "}
                          <a
                            href="https://mpfff.icu"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand underline"
                          >
                            pantone 对照选色
                          </a>
                          ，复制后点击下方按钮即可自动填入。
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const text = await navigator.clipboard.readText();
                                const hex = text.match(/#[0-9A-Fa-f]{3,8}\b/)?.[0];
                                const pantone = text.match(/(?:Pantone|P\s*\d+\s*[A-Z]?|Nebulas Blue|Hawaiian Surf|Iris Bloom|Indigo Bunting|Blue Horizon|Fjord Blue|Gray Blue|[\u4e00-\u9fa5]+\s*(?:Blue|Green|Red|Orange|Purple|Pink|Yellow|Gray|Brown|Black|White)[^\n]*)/)?.[0]?.trim();
                                const color = hex || pantone || text.trim().slice(0, 80);
                                if (color) {
                                  if (activePart === "top") setTopColorText(color);
                                  else setBottomColorText(color);
                                } else {
                                  setError("剪贴板中未检测到颜色值");
                                }
                              } catch {
                                setError("需要粘贴权限，请先在输入框中粘贴颜色");
                              }
                            }}
                            className="shrink-0 px-4 py-2 rounded-lg bg-brand/80 hover:bg-brand text-white font-bold text-[11px] uppercase"
                          >
                            自动从剪贴板获取
                          </button>
                          <input
                            type="text"
                            value={activePart === "top" ? topColorText : bottomColorText}
                            onChange={(e) =>
                              activePart === "top"
                                ? setTopColorText(e.target.value)
                                : setBottomColorText(e.target.value)
                            }
                            placeholder="或手动输入颜色描述 / 十六进制"
                            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white placeholder-white/30 focus:outline-none focus:border-brand"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <button onClick={() => setActivePart("top")} className={`text-left transition-all duration-300 rounded-[1.5rem] p-5 border shadow-[0_0_20px_rgba(255,255,255,0.05)] ${activePart === "top" ? "bg-brand border-brand shadow-[0_0_30px_rgba(106,56,176,0.4)] scale-[1.02]" : "bg-white/10 border-white/20 hover:bg-white/15"}`}>
                        <p className={`text-[14px] font-black uppercase tracking-[0.2em] font-display mb-2 ${activePart === "top" ? "text-white" : "text-white/60"}`}>已选上装</p>
                        <p className="text-xs font-black font-display truncate text-white">{topMaterial?.name || topCustomMaterial || "未选择"}</p>
                        {(topColor || topColorText) && (() => {
                          const swatch = getColorSwatch(topColor, topColorText);
                          return (
                            <span className="text-[9px] font-bold uppercase mt-1 flex items-center gap-1.5 tracking-widest text-white/80">
                              <span className={`w-3 h-3 rounded-full shrink-0 border border-white/20 ${swatch.class || ""}`} style={swatch.style} />
                              颜色: {topColorText || topColor}
                            </span>
                          );
                        })()}
                      </button>
                      <button onClick={() => setActivePart("bottom")} className={`text-left transition-all duration-300 rounded-[1.5rem] p-5 border shadow-[0_0_20px_rgba(255,255,255,0.05)] ${activePart === "bottom" ? "bg-brand border-brand shadow-[0_0_30px_rgba(106,56,176,0.4)] scale-[1.02]" : "bg-white/10 border-white/20 hover:bg-white/15"}`}>
                        <p className={`text-[14px] font-black uppercase tracking-[0.2em] font-display mb-2 ${activePart === "bottom" ? "text-white" : "text-white/60"}`}>已选下装</p>
                        <p className="text-xs font-black font-display truncate text-white">{bottomMaterial?.name || bottomCustomMaterial || "未选择"}</p>
                        {(bottomColor || bottomColorText) && (() => {
                          const swatch = getColorSwatch(bottomColor, bottomColorText);
                          return (
                            <span className="text-[9px] font-bold uppercase mt-1 flex items-center gap-1.5 tracking-widest text-white/80">
                              <span className={`w-3 h-3 rounded-full shrink-0 border border-white/20 ${swatch.class || ""}`} style={swatch.style} />
                              颜色: {bottomColorText || bottomColor}
                            </span>
                          );
                        })()}
                      </button>
                    </div>

                    {error && <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-[11px] font-bold text-red-400 uppercase font-display">{error}</div>}

                    <button
                      disabled={!selectedImage || (!topMaterial && !topCustomMaterial && !bottomMaterial && !bottomCustomMaterial) || replacing}
                      onClick={handleReplace}
                      className={`w-full py-8 rounded-full flex items-center justify-center gap-4 font-black text-[22px] uppercase font-display transition-all relative overflow-hidden ${!selectedImage || (!topMaterial && !topCustomMaterial && !bottomMaterial && !bottomCustomMaterial) || replacing ? "bg-brand/40 text-white/60 cursor-not-allowed" : "bg-brand text-white hover:scale-[1.05] active:scale-95 shadow-xl shadow-brand/40"}`}
                    >
                      {replacing ? (
                        <>
                          <Loader2 className="w-6 h-6 animate-spin text-white" />
                          <span className="text-white">正在合成中...</span>
                        </>
                      ) : (
                        <>
                          <span className="text-white">应用合成设计</span>
                          <ChevronRight className="w-[22px] h-[22px] text-white" />
                        </>
                      )}
                    </button>
                  </div>
                </section>
              </div>

              {/* Studio 生成结果：手机端显示在最下方，并支持自动滚动 */}
              {resultImage && (
                <div ref={studioResultBottomRef} className="lg:hidden">
                  <motion.section
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white/5 backdrop-blur-2xl rounded-[2rem] pt-6 pb-4 px-5 shadow-2xl border border-white/10 relative overflow-hidden"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="text-[12px] font-black uppercase tracking-[0.3em] text-brand mb-1 font-display drop-shadow-[0_0_15px_rgba(106,56,176,1)]">步骤 05</p>
                        <h3 className="text-base font-black font-display uppercase text-white">生成结果</h3>
                      </div>
                    </div>
                    <div className="aspect-[16/10] rounded-2xl overflow-hidden bg-white/5 flex items-center justify-center border border-white/10 relative">
                      {resultImageLoadError ? (
                        <div className="flex flex-col gap-2 text-center text-sm text-white/60 p-4">
                          <p>图片加载失败（可能因外链限制）</p>
                          <a href={resultImage} target="_blank" rel="noopener noreferrer" className="text-brand font-bold underline">
                            在新标签页打开查看
                          </a>
                        </div>
                      ) : (
                        <img
                          src={resultImage}
                          alt="Result"
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                          onError={() => setResultImageLoadError(true)}
                        />
                      )}
                    </div>
                    <div className="flex gap-3 mt-4">
                      <a
                        href={resultImage}
                        download="lokada-design.png"
                        className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand text-white rounded-xl transition-colors font-display text-xs uppercase tracking-wider shadow-lg shadow-brand/40"
                      >
                        <Download className="w-4 h-4" />
                        下载
                      </a>
                      <button
                        onClick={() => navigator.clipboard.writeText(resultImage)}
                        className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors font-display text-xs uppercase tracking-wider"
                      >
                        <Copy className="w-4 h-4" />
                        复制
                      </button>
                    </div>
                  </motion.section>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8" ref={generateSectionRef}>
            {/* Generate View */}
            <div className="bg-white/5 backdrop-blur-2xl rounded-[3rem] p-8 shadow-2xl border border-white/10">
              <p className="text-[14px] font-black uppercase tracking-[0.3em] text-brand mb-2 font-display">步骤 01</p>
              <h2 className="text-lg font-black uppercase font-display text-white mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5" /> 上传原图（可选）
              </h2>
              <div onClick={() => fileInputRef.current?.click()} className={`relative aspect-square rounded-[2rem] border-2 border-dashed transition-all cursor-pointer flex items-center justify-center overflow-hidden ${uploadedImage ? 'border-transparent' : 'border-white/10 hover:border-white/20 bg-white/5'}`}>
                {uploading ? (
                  <Loader2 className="w-10 h-10 animate-spin text-brand" />
                ) : uploadedImage ? (
                  <img src={uploadedImage} alt="Uploaded" className="w-full h-full object-contain" />
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-white/40 mb-2" />
                    <p className="text-white/60">点击上传图片</p>
                  </>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleCOSUpload(file); }} className="hidden" />

              <div className="mt-8 border-t border-white/10 pt-6">
                <p className="text-[14px] font-black uppercase tracking-[0.3em] text-brand mb-2 font-display">步骤 02</p>
                <h3 className="text-sm font-black uppercase font-display text-white mb-4 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" /> 上传参考风格图（可选）
                </h3>
                <div
                  onClick={() => referenceInputRef.current?.click()}
                  className={`relative aspect-square rounded-2xl border border-dashed transition-all cursor-pointer flex items-center justify-center overflow-hidden ${referenceImage ? "border-transparent" : "border-white/10 hover:border-white/20 bg-white/5"}`}
                >
                  {referenceImage ? (
                    <img src={referenceImage} alt="Reference" className="w-full h-full object-contain" />
                  ) : (
                    <>
                      <ImageIcon className="w-8 h-8 text-white/40 mb-2" />
                      <p className="text-xs text-white/60 text-center px-4">可选：上传一张你期望的风格/材质参考图</p>
                    </>
                  )}
                </div>
                <input
                  ref={referenceInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleReferenceUpload}
                  className="hidden"
                />
              </div>
            </div>

            <div className="bg-white/5 backdrop-blur-2xl rounded-[3rem] p-8 shadow-2xl border border-white/10">
              <p className="text-[14px] font-black uppercase tracking-[0.3em] text-brand mb-2 font-display">步骤 03</p>
              <h2 className="text-lg font-black uppercase font-display text-white mb-6 flex items-center gap-2">
                <Sparkles className="w-5 h-5" /> AI 生图
              </h2>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="描述你想要的图片..." className="w-full h-32 bg-white/5 border border-white/10 rounded-xl p-4 text-white placeholder-white/40 focus:outline-none focus:border-brand resize-none" />
              <button onClick={handleGenerate} disabled={!prompt.trim() || generating} className="w-full mt-6 py-4 bg-brand text-white hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-black uppercase font-display transition-all flex items-center justify-center gap-2 shadow-xl shadow-brand/40">
                {generating ? <><Loader2 className="w-5 h-5 animate-spin" />生成中...</> : <><Sparkles className="w-5 h-5" />开始生成</>}
              </button>

              <AnimatePresence>
                {generatedImage && (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
                    <img src={generatedImage} alt="Generated" className="w-full rounded-[2rem] border border-white/10" />
                    <div className="flex gap-3 mt-4">
                      <a href={generatedImage} download="generated-image.png" className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors font-display text-xs uppercase tracking-wider">
                        <Download className="w-4 h-4" />下载
                      </a>
                      <button onClick={() => navigator.clipboard.writeText(generatedImage)} className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors font-display text-xs uppercase tracking-wider">
                        <Copy className="w-4 h-4" />复制链接
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
        </div>
      </main>

      {/* Login Modal */}
      <AnimatePresence>
        {showLogin && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setShowLogin(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-[#0a0a0f] border border-white/10 rounded-[2rem] p-8 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-black font-display uppercase tracking-tight text-white">登录</h2>
                <button onClick={() => setShowLogin(false)} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                  <X className="w-5 h-5 text-white/60" />
                </button>
              </div>

              {loginError && <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium">{loginError}</div>}

              <div className="grid grid-cols-2 gap-3 mb-6">
                <button type="button" onClick={() => { setLoginMethod("phone"); setLoginError(""); }} className={`py-3 px-4 rounded-xl border-2 transition-all font-bold text-center font-display text-xs uppercase ${loginMethod === "phone" ? "border-brand bg-brand text-white" : "border-white/10 text-white/60 hover:border-white/20"}`}>手机号</button>
                <button type="button" onClick={() => { setLoginMethod("email"); setLoginError(""); }} className={`py-3 px-4 rounded-xl border-2 transition-all font-bold text-center font-display text-xs uppercase ${loginMethod === "email" ? "border-brand bg-brand text-white" : "border-white/10 text-white/60 hover:border-white/20"}`}>邮箱</button>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                {loginMethod === "phone" ? (
                  <input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))} placeholder="手机号（11位）" className="w-full px-4 py-4 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-brand text-white placeholder-white/40 text-base" />
                ) : (
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱地址" className="w-full px-4 py-4 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-brand text-white placeholder-white/40 text-base" />
                )}
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" className="w-full px-4 py-4 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-brand text-white placeholder-white/40 text-base pr-16" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 text-sm font-medium">{showPassword ? "隐藏" : "显示"}</button>
                </div>
                <button type="submit" disabled={loginLoading} className="w-full py-4 bg-brand text-white hover:bg-brand-dark disabled:opacity-50 rounded-xl font-black font-display uppercase transition-colors flex items-center justify-center gap-2 text-base shadow-lg shadow-brand/40">
                  {loginLoading && <Loader2 className="w-5 h-5 animate-spin" />}
                  {loginLoading ? "登录中..." : "立即登录"}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AdminMaterials() {
  const [rows, setRows] = useState<AdminMaterialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adminToken = (import.meta as any).env.VITE_ADMIN_TOKEN as string | undefined;

  useEffect(() => {
    async function load() {
      if (!adminToken) {
        setError("缺少 VITE_ADMIN_TOKEN，无法使用管理员接口。");
        setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/admin/materials", {
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": adminToken,
          },
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`加载失败: ${res.status} ${text}`);
        }
        const data = await res.json();
        setRows(data.materials || []);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminToken]);

  const handleFieldChange = (id: string, field: keyof AdminMaterialRow, value: string) => {
    setRows((old) =>
      old.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  };

  const handleAddRow = () => {
    const id = `material_${Date.now()}`;
    setRows((old) => [
      ...old,
      {
        id,
        name: "",
        description: "",
        thumbnailKey: "",
        thumbnailUrl: "",
        prompt: "",
        order: (old[old.length - 1]?.order ?? old.length) + 1,
      },
    ]);
  };

  const handleDeleteRow = (id: string) => {
    setRows((old) => old.filter((row) => row.id !== id));
  };

  const handleUploadImage = async (rowId: string, file: File) => {
    try {
      const presignRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "image/jpeg" }),
      });
      if (!presignRes.ok) throw new Error("获取上传地址失败");
      const { uploadUrl, key, url } = await presignRes.json();

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("上传失败");

      setRows((old) =>
        old.map((row) =>
          row.id === rowId ? { ...row, thumbnailKey: key, thumbnailUrl: url } : row
        )
      );
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  };

  const handleSave = async () => {
    if (!adminToken) {
      alert("缺少 VITE_ADMIN_TOKEN，无法保存。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        materials: rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          thumbnailKey: r.thumbnailKey,
          prompt: r.prompt,
          order: r.order,
        })),
      };
      const res = await fetch("/api/admin/materials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": adminToken,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`保存失败: ${res.status} ${text}`);
      }
      alert("已保存材质元数据到 COS。");
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-white" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[14px] font-black uppercase tracking-[0.3em] text-brand mb-2 font-display">
            Admin
          </p>
          <h2 className="text-2xl font-black font-display">材质仓库管理</h2>
          <p className="text-xs text-white/50 mt-1">
            仅通过 COS 元数据维护：Name / Description / 缩略图 / Prompt
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleAddRow}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-[0.2em] font-display"
          >
            新增一行
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-brand text-white hover:bg-brand-dark disabled:opacity-50 text-xs font-bold uppercase tracking-[0.2em] font-display shadow-lg shadow-brand/40"
          >
            {saving ? "保存中..." : "保存到 COS"}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/40 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30">
        <table className="min-w-full text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-[0.2em] font-display text-white/60">
            <tr>
              <th className="px-4 py-3 text-left">ID</th>
              <th className="px-4 py-3 text-left">排序</th>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-left">Thumbnail</th>
              <th className="px-4 py-3 text-left">Prompt</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="px-4 py-3 text-xs text-white/40 max-w-[160px] break-all">
                  {row.id}
                </td>
                <td className="px-4 py-3 w-[80px]">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setRows((old) => {
                          const idx = old.findIndex((r) => r.id === row.id);
                          if (idx <= 0) return old;
                          const copy = [...old];
                          const tmp = copy[idx - 1];
                          copy[idx - 1] = copy[idx];
                          copy[idx] = tmp;
                          return copy.map((r, i) => ({ ...r, order: i }));
                        })
                      }
                      className="px-1 py-0.5 rounded bg-white/5 hover:bg-white/15 text-[10px]"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setRows((old) => {
                          const idx = old.findIndex((r) => r.id === row.id);
                          if (idx === -1 || idx >= old.length - 1) return old;
                          const copy = [...old];
                          const tmp = copy[idx + 1];
                          copy[idx + 1] = copy[idx];
                          copy[idx] = tmp;
                          return copy.map((r, i) => ({ ...r, order: i }));
                        })
                      }
                      className="px-1 py-0.5 rounded bg-white/5 hover:bg-white/15 text-[10px]"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 w-[160px]">
                  <input
                    value={row.name}
                    onChange={(e) => handleFieldChange(row.id, "name", e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-brand"
                    placeholder="名称"
                  />
                </td>
                <td className="px-4 py-3 w-[220px]">
                  <textarea
                    value={row.description}
                    onChange={(e) => handleFieldChange(row.id, "description", e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-brand resize-none h-20"
                    placeholder="描述"
                  />
                </td>
                <td className="px-4 py-3 w-[220px]">
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 rounded-lg border border-white/10 overflow-hidden bg-white/5 flex-shrink-0 flex items-center justify-center">
                      {row.thumbnailUrl ? (
                        <img src={row.thumbnailUrl} alt={row.name} className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="w-6 h-6 text-white/30" />
                      )}
                    </div>
                    <div className="flex-1 space-y-1">
                      <input
                        value={row.thumbnailKey}
                        onChange={(e) => handleFieldChange(row.id, "thumbnailKey", e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-brand"
                        placeholder="materials/thumbnails/xxx.jpg"
                      />
                      <label className="inline-flex items-center gap-2 text-[11px] text-white/60 cursor-pointer">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUploadImage(row.id, file);
                          }}
                        />
                        <span className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 border border-white/10 text-[10px] font-display uppercase tracking-[0.15em]">
                          上传图片
                        </span>
                      </label>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 w-[260px]">
                  <textarea
                    value={row.prompt}
                    onChange={(e) => handleFieldChange(row.id, "prompt", e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-brand resize-none h-20"
                    placeholder="用于 AI 的材质提示词（英文/中英结合均可）"
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDeleteRow(row.id)}
                    className="inline-flex items-center justify-center px-3 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-[11px] text-red-100 font-display uppercase tracking-[0.15em]"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

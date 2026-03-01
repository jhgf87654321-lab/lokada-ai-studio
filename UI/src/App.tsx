import React, { useState, useEffect, useRef } from "react";
import { Upload, Image as ImageIcon, Sparkles, Check, Loader2, ChevronRight, Info } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Material, AnalysisResult } from "./types";
import { analyzeClothing, replaceMaterial, ReplacementConfig } from "./services/geminiService";

export default function App() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  
  // Selection state for Top
  const [topMaterial, setTopMaterial] = useState<Material | null>(null);
  const [topCustomMaterial, setTopCustomMaterial] = useState<string | null>(null);
  const [topColor, setTopColor] = useState<string | null>(null);

  // Selection state for Bottom
  const [bottomMaterial, setBottomMaterial] = useState<Material | null>(null);
  const [bottomCustomMaterial, setBottomCustomMaterial] = useState<string | null>(null);
  const [bottomColor, setBottomColor] = useState<string | null>(null);

  // Active part for the material library
  const [activePart, setActivePart] = useState<"top" | "bottom">("top");
  const [activeNav, setActiveNav] = useState("产品开发");

  const [replacing, setReplacing] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/materials")
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) {
          console.error("Error fetching materials: HTTP", res.status, text);
          throw new Error(`Failed to fetch /api/materials: ${res.status}`);
        }
        try {
          return JSON.parse(text);
        } catch (e) {
          console.error("Error fetching materials: non-JSON response:", text);
          throw e;
        }
      })
      .then((data) => setMaterials(data))
      .catch((err) => console.error("Error fetching materials:", err));
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        setSelectedImage(base64);
        setAnalysis(null);
        setResultImage(null);
        
        // Reset selections
        setTopMaterial(null);
        setTopCustomMaterial(null);
        setTopColor(null);
        setBottomMaterial(null);
        setBottomCustomMaterial(null);
        setBottomColor(null);
        
        setError(null);
        
        // Auto-analyze
        setAnalyzing(true);
        try {
          const result = await analyzeClothing(base64);
          setAnalysis(result);
          
          // Default selection for materials
          if (result.top.exists && result.top.recommendedMaterials.length > 0) {
            setTopCustomMaterial(result.top.recommendedMaterials[0]);
          }
          if (result.bottom.exists && result.bottom.recommendedMaterials.length > 0) {
            setBottomCustomMaterial(result.bottom.recommendedMaterials[0]);
          }

          if (!result.top.exists && result.bottom.exists) {
            setActivePart("bottom");
          } else {
            setActivePart("top");
          }
        } catch (err) {
          console.error("Analysis failed:", err);
          setError("分析失败。请重试。");
        } finally {
          setAnalyzing(false);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleReplace = async () => {
    if (!selectedImage) return;
    
    const topPrompt = topMaterial?.texture_prompt || topCustomMaterial;
    const bottomPrompt = bottomMaterial?.texture_prompt || bottomCustomMaterial;

    if (!topPrompt && !bottomPrompt) {
      setError("请至少选择一个上装或下装材质。");
      return;
    }

    setReplacing(true);
    setError(null);
    try {
      const config: ReplacementConfig = {
        part: (topPrompt && bottomPrompt) ? "both" : (topPrompt ? "top" : "bottom"),
        topMaterial: topPrompt || undefined,
        topColor: topColor || undefined,
        bottomMaterial: bottomPrompt || undefined,
        bottomColor: bottomColor || undefined
      };
      const result = await replaceMaterial(selectedImage, config);
      setResultImage(result);
    } catch (err) {
      console.error("Replacement failed:", err);
      setError("材质替换失败。AI 可能正忙或请求被过滤。");
    } finally {
      setReplacing(false);
    }
  };

  const handleRecommendClick = (matName: string, part: "top" | "bottom") => {
    const match = materials.find(m => 
      m.name.includes(matName) || 
      matName.includes(m.name) ||
      m.type.includes(matName)
    );

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

  const colors = [
    { name: "原始", value: null, class: "bg-transparent border border-black/10" },
    { name: "黑色", value: "黑", class: "bg-black" },
    { name: "白色", value: "白", class: "bg-white border border-black/10" },
    { name: "红色", value: "红", class: "bg-red-500" },
    { name: "蓝色", value: "蓝", class: "bg-blue-500" },
    { name: "绿色", value: "绿", class: "bg-green-500" },
    { name: "黄色", value: "黄", class: "bg-yellow-400" },
    { name: "粉色", value: "粉", class: "bg-pink-400" },
    { name: "紫色", value: "紫", class: "bg-brand" },
    { name: "棕色", value: "棕", class: "bg-amber-800" },
    { name: "灰色", value: "灰", class: "bg-gray-500" },
  ];

  const renderAnalysisPart = (part: "top" | "bottom", data: any) => {
    if (!data.exists) return null;
    return (
      <div className="space-y-6 p-8 bg-white/5 backdrop-blur-xl rounded-[2.5rem] border border-white/10 relative overflow-hidden">
        <div className="flex items-center justify-between relative z-10">
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/50 font-display">
              {part === "top" ? "Top Analysis" : "Bottom Analysis"}
            </p>
            <h3 className="text-2xl font-black text-white font-sans">
              {data.type}
            </h3>
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
                  className={`px-5 py-2.5 rounded-full text-[11px] font-black transition-all cursor-pointer font-display uppercase tracking-wider
                    ${isSelected 
                      ? 'bg-brand text-white shadow-xl shadow-brand/20 border-brand' 
                      : 'bg-white/10 text-white border border-white/10 hover:bg-white/20'}`}
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

  return (
    <div className="min-h-screen text-white font-sans cyber-grid flowing-bg selection:bg-brand selection:text-white">
      {/* Flowing Curves Background */}
      <svg className="flowing-curves fixed inset-0 w-full h-full" viewBox="0 0 1440 900" preserveAspectRatio="none">
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
            style={{ 
              animationDelay: `${i * -2.5}s`,
              animationDuration: `${12 + Math.random() * 8}s`,
              opacity: 0.5 + (i * 0.04)
            }}
          />
        ))}
      </svg>

      {/* Header */}
      <header className="px-8 py-6 flex justify-between items-center sticky top-0 z-50 bg-[#050505]/60 backdrop-blur-2xl border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand rounded-2xl flex items-center justify-center shadow-lg shadow-brand/40">
            <Sparkles className="text-white w-5 h-5" />
          </div>
          <h1 className="text-xl font-black tracking-tighter font-display uppercase">FabricFlow</h1>
        </div>
        
        <nav className="hidden md:flex items-center gap-1 bg-white/5 backdrop-blur-md p-1 rounded-full border border-white/10 shadow-sm relative">
          {["首页", "产品开发", "工服定制", "关于我们"].map((item) => (
            <button 
              key={item} 
              onClick={() => setActiveNav(item)}
              className={`px-5 py-2 text-[11px] font-bold rounded-full transition-all relative z-10 ${activeNav === item ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
            >
              {item}
              {activeNav === item && (
                <motion.div 
                  layoutId="nav-pill"
                  className="absolute inset-0 bg-brand rounded-full -z-10 shadow-lg shadow-brand/40"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center bg-white/5 hover:bg-white/10 transition-all">
            <Info className="w-4 h-4" />
          </button>
          <button className="px-6 py-2.5 bg-brand text-white text-[11px] font-black rounded-full uppercase font-display shadow-lg shadow-brand/40 hover:bg-brand-dark transition-all flex items-center gap-2">
            立即注册 <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-12 relative z-10">
        <div className="mb-12 max-w-3xl">
          <h2 className="text-4xl md:text-5xl lg:text-6xl leading-[1.1] font-black font-display uppercase tracking-tighter mb-6">
            PLUNGE INTO THE <span className="text-brand">INCREDIBLE</span> AND FANTASTIC WORLD OF <span className="text-brand">FABRIC</span> WITH US
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Upload & Analysis */}
          <div className="lg:col-span-7 space-y-8">
            <section className="bg-white/5 backdrop-blur-2xl rounded-[3rem] p-10 shadow-2xl border border-white/10 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-64 h-64 bg-brand/20 blur-[100px] -mr-32 -mt-32"></div>
              <div className="relative z-10">
                <div className="flex justify-between items-start mb-10">
                  <div>
                    <p className="text-[14px] font-black uppercase tracking-[0.3em] text-brand mb-2 font-display drop-shadow-[0_0_15px_rgba(106,56,176,1)]">步骤 01</p>
                    <h3 className="text-lg font-black font-display uppercase text-white">上传服装图片</h3>
                  </div>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-14 h-14 bg-brand rounded-full flex items-center justify-center shadow-xl shadow-brand/40 hover:scale-110 transition-all group-hover:rotate-45"
                  >
                    <Upload className="text-white w-6 h-6" />
                  </button>
                </div>
                
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative aspect-[16/10] rounded-[2rem] border-2 border-dashed transition-all cursor-pointer flex items-center justify-center overflow-hidden
                    ${selectedImage ? 'border-transparent' : 'border-white/10 hover:border-white/20 bg-white/5'}`}
                >
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
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImageUpload} 
                    className="hidden" 
                    accept="image/*"
                  />
                </div>
              </div>
            </section>

            <AnimatePresence>
              {(analyzing || analysis) && (
                <motion.section 
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 30 }}
                  className="bg-white/5 backdrop-blur-2xl rounded-[3rem] p-10 shadow-2xl border border-white/10"
                >
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <div className="flex gap-4 mb-2">
                        <p className="text-[14px] font-black uppercase tracking-[0.3em] text-brand font-display drop-shadow-[0_0_10px_rgba(106,56,176,0.8)]">步骤 02</p>
                      </div>
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
                          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/50 font-display">Overall Style / 整体风格</p>
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

            {resultImage && (
              <motion.section 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white/5 backdrop-blur-2xl rounded-[3rem] pt-8 pb-4 px-10 shadow-2xl border border-white/10 relative overflow-hidden group"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-[14px] font-black uppercase tracking-[0.3em] text-brand mb-1 font-display drop-shadow-[0_0_15px_rgba(106,56,176,1)]">步骤 05</p>
                    <h3 className="text-lg font-black font-display uppercase text-white">生成结果</h3>
                  </div>
                </div>

                <div className="aspect-[16/10] rounded-[2rem] overflow-hidden relative group/img">
                  {resultImage ? (
                    <>
                      <img src={resultImage} alt="Result" className="w-full h-full object-contain" />
                      <div className="absolute bottom-6 right-6 opacity-0 group-hover/img:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            const link = document.createElement('a');
                            link.href = resultImage;
                            link.download = 'fabricflow-design.png';
                            link.click();
                          }}
                          className="px-6 py-3 bg-brand text-white text-[10px] font-black rounded-full uppercase font-display shadow-xl shadow-brand/40 hover:scale-105 transition-all flex items-center gap-2"
                        >
                          下载设计图 <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4">
                      <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center border border-white/10">
                        <ImageIcon className="w-8 h-8 text-white/20" />
                      </div>
                      <p className="text-xs font-black uppercase tracking-widest text-white/20 font-display">Waiting for generation / 等待生成结果</p>
                    </div>
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
                    <span className="text-[12px] font-bold text-white">（优先使用智能分析中的材质，如需特殊材质请在下方选择）</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 overflow-y-auto max-h-[500px] pr-4 custom-scrollbar mb-10">
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
                      className={`group relative rounded-[2rem] border-2 transition-all cursor-pointer overflow-hidden
                        ${isSelected 
                          ? 'border-brand bg-brand/10' 
                          : 'border-white/5 hover:border-brand/30 bg-white/5'}`}
                    >
                      <div className="aspect-square overflow-hidden">
                        <img 
                          src={material.thumbnail_url} 
                          alt={material.name} 
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div className="p-4">
                        <p className="text-xs font-black uppercase font-display truncate text-white">{material.name}</p>
                        <p className="text-[9px] text-white/30 font-bold uppercase tracking-widest">{material.type}</p>
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
                    {((activePart === "top" && topColor) || (activePart === "bottom" && bottomColor)) && (
                      <button onClick={() => activePart === "top" ? setTopColor(null) : setBottomColor(null)} className="text-[10px] font-black text-brand uppercase font-display">重置</button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {colors.map((color) => {
                      const isSelected = activePart === "top" ? topColor === color.value : bottomColor === color.value;
                      return (
                        <button
                          key={color.name}
                          onClick={() => activePart === "top" ? setTopColor(color.value) : setBottomColor(color.value)}
                          title={color.name}
                          className={`w-11 h-11 rounded-full transition-all flex items-center justify-center relative border border-white/10
                            ${color.class} 
                            ${isSelected ? 'ring-4 ring-white/30 ring-offset-4 ring-offset-[#050505] scale-110 border-white/40' : 'hover:scale-110 hover:border-white/30'}`}
                        >
                          {isSelected && (
                            <>
                              <div className="absolute inset-[-8px] border-2 border-white/40 rounded-full animate-pulse shadow-[0_0_15px_rgba(255,255,255,0.3)]" />
                              <Check className={`w-4 h-4 relative z-10 ${color.value === '白' ? 'text-black' : 'text-white'}`} />
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setActivePart("top")}
                    className={`text-left transition-all duration-300 rounded-[1.5rem] p-5 border shadow-[0_0_20px_rgba(255,255,255,0.05)]
                      ${activePart === "top" 
                        ? 'bg-brand border-brand shadow-[0_0_30px_rgba(106,56,176,0.4)] scale-[1.02]' 
                        : 'bg-white/10 border-white/20 hover:bg-white/15'}`}
                  >
                    <p className={`text-[14px] font-black uppercase tracking-[0.2em] font-display mb-2 drop-shadow-[0_0_5px_rgba(255,255,255,0.6)] ${activePart === "top" ? 'text-white' : 'text-white/60'}`}>已选上装</p>
                    <p className="text-xs font-black font-display truncate text-white drop-shadow-[0_0_3px_rgba(255,255,255,0.4)]">{topMaterial?.name || topCustomMaterial || "未选择"}</p>
                    {topColor && <span className={`text-[9px] font-bold uppercase mt-1 block tracking-widest ${activePart === "top" ? 'text-white/80' : 'text-white/60'}`}>颜色: {topColor}</span>}
                  </button>
                  <button
                    onClick={() => setActivePart("bottom")}
                    className={`text-left transition-all duration-300 rounded-[1.5rem] p-5 border shadow-[0_0_20px_rgba(255,255,255,0.05)]
                      ${activePart === "bottom" 
                        ? 'bg-brand border-brand shadow-[0_0_30px_rgba(106,56,176,0.4)] scale-[1.02]' 
                        : 'bg-white/10 border-white/20 hover:bg-white/15'}`}
                  >
                    <p className={`text-[14px] font-black uppercase tracking-[0.2em] font-display mb-2 drop-shadow-[0_0_5px_rgba(255,255,255,0.6)] ${activePart === "bottom" ? 'text-white' : 'text-white/60'}`}>已选下装</p>
                    <p className="text-xs font-black font-display truncate text-white drop-shadow-[0_0_3px_rgba(255,255,255,0.4)]">{bottomMaterial?.name || bottomCustomMaterial || "未选择"}</p>
                    {bottomColor && <span className={`text-[9px] font-bold uppercase mt-1 block tracking-widest ${activePart === "bottom" ? 'text-white/80' : 'text-white/60'}`}>颜色: {bottomColor}</span>}
                  </button>
                </div>

                {error && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-[11px] font-bold text-red-400 uppercase font-display">
                    {error}
                  </div>
                )}

                <button
                  disabled={!selectedImage || (!topMaterial && !topCustomMaterial && !bottomMaterial && !bottomCustomMaterial) || replacing}
                  onClick={handleReplace}
                  className={`w-full py-8 rounded-full flex items-center justify-center gap-4 font-black text-[22px] uppercase font-display transition-all relative overflow-hidden
                    ${!selectedImage || (!topMaterial && !topCustomMaterial && !bottomMaterial && !bottomCustomMaterial) || replacing
                      ? 'bg-brand/40 text-white/60 cursor-not-allowed'
                      : 'bg-brand text-white hover:scale-[1.05] active:scale-95'}`}
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
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-8 py-16 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand rounded-xl flex items-center justify-center">
            <Sparkles className="text-white w-4 h-4" />
          </div>
          <p className="text-sm font-black font-display uppercase">FabricFlow AI</p>
        </div>
        <p className="text-[11px] font-bold text-white/30 uppercase tracking-widest">© 2026 神经设计系统. 保留所有权利.</p>
        <div className="flex gap-8 text-[11px] font-black uppercase tracking-widest font-display">
          <a href="#" className="hover:text-brand transition-colors">文档</a>
          <a href="#" className="hover:text-brand transition-colors">状态</a>
          <a href="#" className="hover:text-brand transition-colors">隐私政策</a>
        </div>
      </footer>
    </div>
  );
}

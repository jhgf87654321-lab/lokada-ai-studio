import React, { useState, useEffect, useRef } from "react";
import { Upload, Image as ImageIcon, Sparkles, Check, Loader2, ChevronRight, Info } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Material, AnalysisResult } from "./types";
import { analyzeClothing, replaceMaterial } from "./services/geminiService";

export default function App() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [customMaterial, setCustomMaterial] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/materials")
      .then((res) => res.json())
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
        setSelectedMaterial(null);
        setError(null);
        
        // Auto-analyze
        setAnalyzing(true);
        try {
          const result = await analyzeClothing(base64);
          setAnalysis(result);
        } catch (err) {
          console.error("Analysis failed:", err);
          setError("Failed to analyze image. Please try again.");
        } finally {
          setAnalyzing(false);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleReplace = async () => {
    const prompt = selectedMaterial?.texture_prompt || customMaterial;
    if (!selectedImage || !prompt) return;
    
    setReplacing(true);
    setError(null);
    try {
      const result = await replaceMaterial(
        selectedImage, 
        prompt, 
        selectedColor || undefined
      );
      setResultImage(result);
    } catch (err) {
      console.error("Replacement failed:", err);
      setError("材质替换失败。AI 可能正忙或请求被过滤。");
    } finally {
      setReplacing(false);
    }
  };

  const handleRecommendClick = (matName: string) => {
    setCustomMaterial(matName);
    // Try to find a matching material in the library for better visualization if possible
    const match = materials.find(m => 
      m.name.includes(matName) || 
      matName.includes(m.name) ||
      m.type.includes(matName)
    );
    if (match) {
      setSelectedMaterial(match);
    } else {
      setSelectedMaterial(null);
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
    { name: "紫色", value: "紫", class: "bg-purple-500" },
    { name: "棕色", value: "棕", class: "bg-amber-800" },
    { name: "灰色", value: "灰", class: "bg-gray-500" },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-black/5 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
            <Sparkles className="text-white w-5 h-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">FabricFlow</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs font-medium text-black/40 uppercase tracking-widest">材质库 v1.0</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Upload & Analysis */}
        <div className="lg:col-span-7 space-y-6">
          <section className="bg-white rounded-3xl p-6 shadow-sm border border-black/5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-black/40 mb-4 flex items-center gap-2">
              <Upload className="w-4 h-4" /> 服装上传
            </h2>
            
            <div 
              onClick={() => fileInputRef.current?.click()}
              className={`relative aspect-video rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-center items-center justify-center overflow-hidden
                ${selectedImage ? 'border-transparent' : 'border-black/10 hover:border-black/20 bg-black/[0.02]'}`}
            >
              {selectedImage ? (
                <img src={selectedImage} alt="Uploaded garment" className="w-full h-full object-contain" />
              ) : (
                <div className="text-center space-y-2">
                  <div className="w-12 h-12 bg-black/5 rounded-full flex items-center justify-center mx-auto">
                    <Upload className="w-6 h-6 text-black/40" />
                  </div>
                  <p className="text-sm text-black/60">点击或拖拽上传服装图片</p>
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
          </section>

          <AnimatePresence>
            {(analyzing || analysis) && (
              <motion.section 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="bg-white rounded-3xl p-6 shadow-sm border border-black/5"
              >
                <h2 className="text-sm font-semibold uppercase tracking-wider text-black/40 mb-4 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> AI 智能分析
                </h2>
                
                {analyzing ? (
                  <div className="flex items-center gap-3 py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-black/40" />
                    <p className="text-sm text-black/60 italic">正在分析服装结构和风格...</p>
                  </div>
                ) : analysis && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 bg-black text-white text-xs font-bold rounded-full uppercase tracking-tighter">
                        {analysis.clothingType}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-black/70">{analysis.reasoning}</p>
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-black/40 uppercase tracking-widest">推荐材质 (点击直接使用)</p>
                      <div className="flex flex-wrap gap-2">
                        {analysis.recommendedMaterials.map((mat, i) => (
                          <button 
                            key={i} 
                            onClick={() => handleRecommendClick(mat)}
                            className={`px-3 py-1.5 border rounded-xl text-xs font-medium transition-all cursor-pointer
                              ${customMaterial === mat 
                                ? 'bg-black text-white border-black shadow-md' 
                                : 'bg-black/5 border-black/5 hover:bg-black/10'}`}
                          >
                            {mat}
                          </button>
                        ))}
                      </div>
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
              className="bg-white rounded-3xl p-6 shadow-sm border border-black/5"
            >
              <h2 className="text-sm font-semibold uppercase tracking-wider text-black/40 mb-4 flex items-center gap-2">
                <ImageIcon className="w-4 h-4" /> 材质预览
              </h2>
              <div className="aspect-video rounded-2xl overflow-hidden bg-black/5">
                <img src={resultImage} alt="Result" className="w-full h-full object-contain" />
              </div>
              <div className="mt-4 flex justify-end">
                <button 
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = resultImage;
                    link.download = 'fabricflow-design.png';
                    link.click();
                  }}
                  className="px-4 py-2 bg-black text-white text-sm font-medium rounded-xl hover:bg-black/80 transition-colors"
                >
                  下载设计图
                </button>
              </div>
            </motion.section>
          )}
        </div>

        {/* Right Column: Material Library */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-white rounded-3xl p-6 shadow-sm border border-black/5 h-full">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-black/40 flex items-center gap-2">
                <Info className="w-4 h-4" /> 材质库
              </h2>
              <span className="text-[10px] font-bold bg-black/5 px-2 py-1 rounded text-black/40 uppercase">
                {materials.length} 个项目
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {materials.map((material) => (
                <motion.div
                  key={material.id}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setSelectedMaterial(material);
                    setCustomMaterial(null);
                  }}
                  className={`group relative rounded-2xl border transition-all cursor-pointer overflow-hidden
                    ${selectedMaterial?.id === material.id 
                      ? 'border-black ring-1 ring-black' 
                      : 'border-black/5 hover:border-black/20'}`}
                >
                  <div className="aspect-square bg-black/5 overflow-hidden">
                    <img 
                      src={material.thumbnail_url} 
                      alt={material.name} 
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="p-3 bg-white">
                    <p className="text-xs font-bold truncate">{material.name}</p>
                    <p className="text-[10px] text-black/40 uppercase tracking-tighter">{material.type}</p>
                  </div>
                  {selectedMaterial?.id === material.id && (
                    <div className="absolute top-2 right-2 w-5 h-5 bg-black rounded-full flex items-center justify-center">
                      <Check className="text-white w-3 h-3" />
                    </div>
                  )}
                </motion.div>
              ))}
            </div>

            <div className="mt-8 pt-6 border-t border-black/5 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-bold text-black/40 uppercase tracking-widest">颜色选项</p>
                <div className="flex flex-wrap gap-2">
                  {colors.map((color) => (
                    <button
                      key={color.name}
                      onClick={() => setSelectedColor(color.value)}
                      title={color.name}
                      className={`w-8 h-8 rounded-full transition-all flex items-center justify-center
                        ${color.class} 
                        ${selectedColor === color.value ? 'ring-2 ring-black ring-offset-2 scale-110' : 'hover:scale-105'}`}
                    >
                      {selectedColor === color.value && (
                        <Check className={`w-3 h-3 ${color.value === '白' || color.value === '黄' || color.value === null ? 'text-black' : 'text-white'}`} />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-black/5 rounded-2xl p-4">
                <p className="text-xs font-bold text-black/40 uppercase tracking-widest mb-2">已选材质</p>
                {selectedMaterial || customMaterial ? (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">{selectedMaterial?.name || customMaterial}</p>
                    <p className="text-xs text-black/60 leading-relaxed">
                      {selectedMaterial?.description || "AI 推荐材质，将直接应用其纹理特征。"}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-black/40 italic">请选择一个材质进行预览和应用</p>
                )}
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600">
                  {error}
                </div>
              )}

              <button
                disabled={!selectedImage || (!selectedMaterial && !customMaterial) || replacing}
                onClick={handleReplace}
                className={`w-full py-4 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm transition-all
                  ${!selectedImage || (!selectedMaterial && !customMaterial) || replacing
                    ? 'bg-black/5 text-black/20 cursor-not-allowed'
                    : 'bg-black text-white hover:bg-black/90 shadow-lg shadow-black/10'}`}
              >
                {replacing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    处理中...
                  </>
                ) : (
                  <>
                    应用材质 <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto p-8 border-t border-black/5 flex flex-col md:flex-row justify-between items-center gap-4 text-black/40">
        <p className="text-xs">© 2026 FabricFlow AI. 保留所有权利。</p>
        <div className="flex gap-6 text-xs font-medium uppercase tracking-widest">
          <a href="#" className="hover:text-black transition-colors">文档</a>
          <a href="#" className="hover:text-black transition-colors">API 状态</a>
          <a href="#" className="hover:text-black transition-colors">隐私</a>
        </div>
      </footer>
    </div>
  );
}

"use client";

import { ChangeEvent, DragEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  ArrowRight, BadgeCheck, Check, CheckCircle2, ChevronDown, CircleHelp, Download, FileImage,
  FileSearch, ImagePlus, Layers3, Loader2, RefreshCcw, ShieldCheck, Sparkles, Trash2,
  UploadCloud, WandSparkles, X, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "visible" | "metadata" | "erase" | "identify";
type Status = "idle" | "working" | "done" | "error";
type Entry = { id: string; file: File; url: string };
type ProcessedFile = { name: string; original_name: string; download_url: string };
type ProcessResponse = { count: number; download_all_url: string; download_url: string; files: ProcessedFile[] };
type IdentifyResponse = { count: number; reports: Array<{ name: string; report: Record<string, unknown> }> };
type ServerConfig = { max_files: number; max_upload_mb: number; max_total_upload_mb: number };

const modes: Array<{ id: Mode; label: string; detail: string; icon: typeof Sparkles }> = [
  { id: "visible", label: "可见标识", detail: "检测并修复常见 AI 标识", icon: WandSparkles },
  { id: "metadata", label: "元数据清理", detail: "处理 C2PA、EXIF 与 XMP", icon: ShieldCheck },
  { id: "erase", label: "区域擦除", detail: "按坐标擦除指定矩形", icon: Layers3 },
  { id: "identify", label: "来源检测", detail: "仅扫描，不修改图片", icon: FileSearch },
];

const marks = [
  ["auto", "智能识别 · 所有已注册标识"], ["gemini", "Google Gemini / Nano Banana"],
  ["doubao", "豆包 · Doubao"], ["jimeng", "即梦 · Dreamina"], ["jimeng_pill", "即梦 AI 角标"],
  ["qwen", "千问 · Qwen"], ["wan", "通义万相 · Wan"], ["kling", "可灵 · Kling"],
  ["yuanbao", "腾讯元宝"], ["dola", "Dola AI"], ["workbuddy", "腾讯 WorkBuddy"],
  ["samsung", "Samsung Galaxy AI"], ["runninghub", "RunningHub"], ["baidu", "百度"],
  ["liblib", "LiblibAI"], ["liblib_pill", "LiblibAI AI 角标"],
  ["microsoft", "Microsoft AI 标识"], ["generic_ai_label", "通用「AI生成」标识"],
  ["openart", "OpenArt"],
];

const defaults: ServerConfig = { max_files: 10, max_upload_mb: 20, max_total_upload_mb: 100 };
const supported = new Set(["image/png", "image/jpeg", "image/webp", "image/bmp", "image/tiff"]);
const extOK = /\.(png|jpe?g|webp|bmp|tiff?)$/i;
const fmtSize = (size: number) => size < 1024 * 1024 ? `${(size / 1024).toFixed(0)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
const valText = (value: unknown) => value === null || value === undefined || value === "" ? "未检测到" : typeof value === "object" ? JSON.stringify(value) : String(value);

export default function Page() {
  const inputRef = useRef<HTMLInputElement>(null);
  const entriesRef = useRef<Entry[]>([]);
  const requestRef = useRef<AbortController | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("visible");
  const [mark, setMark] = useState("auto");
  const [sensitivity, setSensitivity] = useState("auto");
  const [inpaint, setInpaint] = useState("telea");
  const [regions, setRegions] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [inspection, setInspection] = useState<IdentifyResponse | null>(null);
  const [config, setConfig] = useState<ServerConfig>(defaults);

  useEffect(() => {
    fetch("/api/config").then((response) => response.ok ? response.json() : defaults)
      .then((data: ServerConfig) => {
        if (Number.isInteger(data.max_files) && data.max_files > 0) setConfig(data);
      }).catch(() => {});
    return () => {
      requestRef.current?.abort();
      entriesRef.current.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, []);

  function replaceEntries(next: Entry[]) {
    entriesRef.current = next;
    setEntries(next);
    if (inputRef.current) inputRef.current.value = "";
    setResult(null);
    setInspection(null);
    setMessage("");
    setStatus("idle");
  }

  function addFiles(newFiles: File[]) {
    if (status === "working" || newFiles.length === 0) return;
    const valid = newFiles.filter((file) => supported.has(file.type) || extOK.test(file.name));
    const invalidCount = newFiles.length - valid.length;
    const existing = entriesRef.current;
    const seen = new Set(existing.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}`));
    const next: Entry[] = [...existing];
    let rejected = 0;
    for (const file of valid) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (seen.has(key)) continue;
      if (next.length >= config.max_files || file.size > config.max_upload_mb * 1024 * 1024 ||
          next.reduce((sum, entry) => sum + entry.file.size, 0) + file.size > config.max_total_upload_mb * 1024 * 1024) {
        rejected++; continue;
      }
      seen.add(key);
      next.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
    }
    replaceEntries(next);
    if (!active && next.length) setActive(next[0].id);
    if (invalidCount || rejected) {
      setMessage(`已跳过 ${invalidCount + rejected} 个文件。支持常见图片格式，最多 ${config.max_files} 张、单张 ${config.max_upload_mb} MB，总量 ${config.max_total_upload_mb} MB。`);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files || []));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function removeFile(id: string) {
    if (status === "working") return;
    const match = entriesRef.current.find((entry) => entry.id === id);
    const next = entriesRef.current.filter((entry) => entry.id !== id);
    replaceEntries(next);
    if (active === id) setActive(next[0]?.id ?? null);
    if (match) URL.revokeObjectURL(match.url);
  }

  function clearAll() {
    if (status === "working") return;
    entriesRef.current.forEach((entry) => URL.revokeObjectURL(entry.url));
    replaceEntries([]);
    setActive(null);
  }

  function switchMode(value: Mode) {
    setMode(value);
    setResult(null);
    setInspection(null);
    setMessage("");
    setStatus("idle");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "working") return;
    if (!entries.length) { setStatus("error"); setMessage("请先添加至少一张图片。"); return; }
    if (!accepted) { setStatus("error"); setMessage("请先确认您拥有处理这些图片的权利。"); return; }
    if (mode === "erase" && !regions.trim()) { setStatus("error"); setMessage("区域擦除需要填写 x,y,w,h 坐标。"); return; }

    const form = new FormData();
    entries.forEach(({ file }) => form.append("file", file, file.name));
    form.append("accept_terms", "true");
    if (mode !== "identify") {
      form.append("operation", mode);
      form.append("mark", mark);
      form.append("sensitivity", sensitivity);
      form.append("inpaint_method", inpaint);
      if (regions.trim()) form.append("regions", regions.trim());
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("working"); setResult(null); setInspection(null);
    setMessage(mode === "identify" ? "正在扫描图片来源，请稍候…" : `正在处理 ${entries.length} 张图片，请稍候…`);
    try {
      const response = await fetch(mode === "identify" ? "/api/identify" : "/api/process", {
        method: "POST", body: form, signal: controller.signal,
      });
      const raw: unknown = await response.json();
      const body = raw as Record<string, unknown>;
      if (!response.ok) {
        const detail = body.detail;
        throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? "请求参数不正确，请检查文件和设置。" : `服务器返回错误 ${response.status}`);
      }
      if (mode === "identify") setInspection(raw as IdentifyResponse);
      else setResult(raw as ProcessResponse);
      setStatus("done"); setMessage("");
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "网络请求失败，请检查服务状态。");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  const chosen = entries.find((entry) => entry.id === active) ?? entries[0] ?? null;
  const activeMode = modes.find((item) => item.id === mode)!;
  const busy = status === "working";
  const countText = entries.length ? `${entries.length} / ${config.max_files} 张` : "还未添加图片";

  return (
    <main className="min-h-screen">
      <header className="site-header">
        <div className="site-header-inner">
          <a href="#workspace" className="brand" aria-label="CleanMark 首页"><span className="brand-logo"><Sparkles size={19} /></span><span>cleanmark<span className="brand-dot">.</span></span></a>
          <nav className="header-links" aria-label="主导航">
            <a href="#workspace">处理工作台</a><a href="#about">功能说明</a>
            <a href="https://github.com/ChengSir404/Cleanmark" target="_blank" rel="noopener noreferrer">GitHub <ArrowRight size={13} /></a>
          </nav>
          <span className="header-status"><span className="status-pulse" /> 自托管 · CPU 模式</span>
        </div>
      </header>

      <section className="intro">
        <div className="eyebrow"><span className="eyebrow-line" /> IMAGE PROVENANCE STUDIO <span className="eyebrow-line" /></div>
        <h1>让画面回归<span className="gradient-word">纯粹</span>。</h1>
        <p>识别、清理与修复，尽在一个工作台。为你自己的 AI 图像提供更流畅的处理体验。</p>
        <div className="feature-pills"><span><Check size={14} /> 多图批量处理</span><span><Check size={14} /> 可见标识识别</span><span><Check size={14} /> 元数据与来源检测</span></div>
      </section>

      <section id="workspace" className="workspace" aria-label="图像处理工作台">
        <form onSubmit={onSubmit} noValidate>
          <div className="workspace-top">
            <div className="workspace-heading"><div className="workspace-icon"><Zap size={17} /></div><div><h2>图像工作台</h2><p>UPLOAD &amp; PROCESS</p></div></div>
            <div className="workspace-state"><span className={cn("mini-status", status === "error" && "bad", status === "done" && "good", busy && "running")}><span className="mini-led" />{status === "idle" ? "准备就绪" : status === "working" ? "处理中" : status === "done" ? "已完成" : "需要注意"}</span></div>
          </div>

          <div className="workspace-grid">
            <div className="files-pane">
              <div className="pane-title-row"><div><h3>01 <span>添加图片</span></h3><p>拖放图片或点击上传，支持多张图片排队处理</p></div><span className="count-pill">{countText}</span></div>
              <input ref={inputRef} id="images-input" type="file" accept="image/png,image/jpeg,image/webp,image/bmp,image/tiff" multiple onChange={onFileChange} className="sr-only" aria-label="选择图片" />

              {chosen ? (
                <div className="preview-stage">
                  <div className="preview-topline"><span><FileImage size={15} /> 当前预览</span><span>{fmtSize(chosen.file.size)}</span></div>
                  <img src={chosen.url} alt={`预览：${chosen.file.name}`} className="preview-image" />
                  <div className="preview-bottomline"><span title={chosen.file.name}>{chosen.file.name}</span><span>ORIGINAL</span></div>
                </div>
              ) : (
                <div
                  className={cn("dropzone", dragging && "drag-over")}
                  onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
                  onDrop={onDrop}
                  role="button" tabIndex={0} aria-label="选择或拖入图片"
                  onClick={() => inputRef.current?.click()}
                  onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inputRef.current?.click(); } }}
                >
                  <div className="upload-orb"><UploadCloud size={31} strokeWidth={1.6} /></div>
                  <strong>把图片拖到这里</strong><span>或者点击浏览本地文件</span>
                  <div className="dropzone-types">PNG · JPG · WEBP · BMP · TIFF</div>
                </div>
              )}

              <div className="queue-section">
                <div className="queue-header"><div><h4>待处理文件 <span>{entries.length}</span></h4></div><div className="queue-actions"><button type="button" disabled={busy} onClick={() => inputRef.current?.click()}><ImagePlus size={15} /> 添加图片</button>{entries.length > 0 && <button type="button" disabled={busy} onClick={clearAll} className="clear-btn"><Trash2 size={14} /> 清空</button>}</div></div>
                {entries.length ? (
                  <ul className="file-queue">
                    {entries.map((entry, index) => (
                      <li key={entry.id} className={cn("file-row", chosen?.id === entry.id && "selected")}>
                        <button type="button" disabled={busy} className="file-pick" onClick={() => setActive(entry.id)} aria-label={`预览 ${entry.file.name}`}>
                          <img src={entry.url} alt="" /><span className="file-index">{String(index + 1).padStart(2, "0")}</span>
                          <span className="file-meta"><strong title={entry.file.name}>{entry.file.name}</strong><small>{fmtSize(entry.file.size)} · {entry.file.type.split("/")[1]?.toUpperCase() || "IMAGE"}</small></span>
                        </button>
                        <button type="button" disabled={busy} className="remove-btn" aria-label={`删除 ${entry.file.name}`} title="从待处理列表删除" onClick={() => removeFile(entry.id)}><X size={16} /></button>
                      </li>
                    ))}
                  </ul>
                ) : <div className="queue-empty">添加图片后，文件会在这里排列。可单独删除或清空。</div>}
              </div>
              <p className="file-limits">单张最大 {config.max_upload_mb} MB · 总量最大 {config.max_total_upload_mb} MB · 不会自动上传，点击开始后才发送到服务器</p>
            </div>

            <div className="settings-pane">
              <div className="pane-title-row"><div><h3>02 <span>处理配置</span></h3><p>选择适合当前图像的处理方式</p></div><div className="gear-icon"><WandSparkles size={17} /></div></div>
              <div className="section-label">处理任务</div>
              <div className="mode-grid">
                {modes.map((item) => {
                  const Icon = item.icon;
                  return <button key={item.id} type="button" disabled={busy} className={cn("mode-card", mode === item.id && "active")} aria-pressed={mode === item.id} onClick={() => switchMode(item.id)}>
                    <span className="mode-icon"><Icon size={19} /></span>
                    <span className="mode-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
                    <span className="mode-radio">{mode === item.id && <Check size={12} strokeWidth={3} />}</span>
                  </button>;
                })}
              </div>

              <div className="setting-detail">
                <div className="detail-head"><strong>{activeMode.label}</strong><span><CircleHelp size={14} /> {mode === "identify" ? "只读分析" : "本地 CPU 处理"}</span></div>
                {mode === "visible" && <>
                  <label htmlFor="mark" className="field-label">目标标识</label>
                  <div className="select-wrap"><select id="mark" value={mark} disabled={busy} onChange={(event) => setMark(event.target.value)}>{marks.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><ChevronDown size={16} /></div>
                  <label htmlFor="sensitivity" className="field-label field-spaced">检测灵敏度</label>
                  <div className="select-wrap"><select id="sensitivity" value={sensitivity} disabled={busy} onChange={(event) => setSensitivity(event.target.value)}><option value="auto">自动 · 根据可信来源信息调整</option><option value="strict">严格 · 减少误识别</option></select><ChevronDown size={16} /></div>
                  <p className="field-help">自动模式只处理识别到的受支持标识。对画面中的自定义标识，请使用「区域擦除」。</p>
                </>}
                {mode === "metadata" && <div className="info-text"><ShieldCheck size={17} /> 清理 AI 来源元数据，尽量保持图像像素不变。此操作不等于消除不可见像素水印。</div>}
                {mode === "erase" && <>
                  <label htmlFor="regions" className="field-label">矩形区域坐标（x,y,w,h）</label>
                  <textarea id="regions" value={regions} disabled={busy} onChange={(event) => setRegions(event.target.value)} placeholder={"例如：120,280,160,80\n每行一个矩形，也可用分号分隔"} rows={3} className="regions-field" />
                  <label htmlFor="inpaint" className="field-label field-spaced">填补算法</label>
                  <div className="select-wrap"><select id="inpaint" value={inpaint} disabled={busy} onChange={(event) => setInpaint(event.target.value)}><option value="telea">Telea · 默认快速</option><option value="ns">Navier–Stokes · 纹理延展</option></select><ChevronDown size={16} /></div>
                  <p className="field-help">坐标按原图像素计算，多张不同尺寸图片建议单独处理。</p>
                </>}
                {mode === "identify" && <div className="info-text"><FileSearch size={17} /> 检查可见标识及 C2PA、EXIF 等来源线索。不修改或输出新图片，未检测到信号也不等于图片无水印。</div>}
              </div>

              <label className="consent-row"><input type="checkbox" checked={accepted} disabled={busy} onChange={(event) => setAccepted(event.target.checked)} /><span>我确认有权处理上传的内容，并遵守适用法律与平台规则。</span></label>
              <button type="submit" className="submit-button" disabled={busy || entries.length === 0 || !accepted}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}{busy ? "正在执行，请稍候…" : mode === "identify" ? "开始来源检测" : `开始处理 · ${entries.length} 张`}{!busy && <ArrowRight size={18} className="submit-arrow" />}</button>
              <div className="privacy-hint"><BadgeCheck size={15} /> 服务器临时保存处理结果，默认 24 小时后清理</div>
              {status === "error" && <div className="alert-message" role="alert">{message}</div>}
              {busy && <div className="working-message" role="status"><Loader2 size={15} className="animate-spin" />{message}</div>}
            </div>
          </div>

          {status === "done" && result && <section className="result-panel" aria-live="polite"><div className="result-head"><div><span className="result-check"><CheckCircle2 size={21} /></span><div><h3>处理完成</h3><p>共 ${result.count} 张图片，可选择逐张下载或批量获取</p></div></div><a className="download-all" href={result.download_all_url || result.download_url}><Download size={16} /> 下载{result.count > 1 ? "全部 ZIP" : "结果"}</a></div><div className="result-list">{result.files?.map((file) => <div key={file.download_url} className="result-row"><span><FileImage size={17} /> {file.original_name || file.name}</span><a href={file.download_url}><Download size={15} /> 下载</a></div>)}</div></section>}
          {status === "done" && inspection && <section className="result-panel" aria-live="polite"><div className="result-head"><div><span className="result-check"><FileSearch size={21} /></span><div><h3>来源检测报告</h3><p>共扫描 {inspection.count} 张图片，报告仅供参考</p></div></div></div><div className="result-list">{inspection.reports?.map(({ name, report }, index) => <div className="inspect-report" key={index}><strong><FileImage size={16} />{name}</strong><div className="inspect-grid"><div><small>AI 生成判断</small><span>{report.is_ai_generated === true ? "存在生成信号" : report.is_ai_generated === false ? "未判定为 AI" : "未知"}</span></div><div><small>来源平台</small><span>{valText(report.platform)}</span></div><div><small>置信度</small><span>{valText(report.confidence)}</span></div></div><details><summary>查看完整原始报告</summary><pre>{JSON.stringify(report, null, 2)}</pre></details></div>)}</div></section>}
        </form>
      </section>

      <section className="bottom-grid" id="about"><div className="about-card"><div className="about-icon"><ShieldCheck size={20} /></div><h3>安全且可控的处理流程</h3><p>图片只会在提交处理时上传。系统支持常见图像格式，提供可见标识修复、元数据清理、矩形擦除和来源分析。</p></div><div className="about-card"><div className="about-icon"><RefreshCcw size={20} /></div><h3>保持轻量，按需升级</h3><p>基于 remove-ai-watermarks 的 CPU 功能构建。需要 CUDA 的不可见水印重生成与大型模型修复不在当前部署中提供。</p></div></section>
      <footer className="footer"><span>© CleanMark · Image Provenance Studio</span><span>Made for images you own · Powered by remove-ai-watermarks</span></footer>
    </main>
  );
}

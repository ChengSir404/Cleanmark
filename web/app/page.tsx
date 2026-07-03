"use client";

import { ChangeEvent, DragEvent, FormEvent, useMemo, useRef, useState } from "react";
import { Archive, CheckCircle2, Download, FileImage, Layers3, Loader2, ShieldCheck, Sparkles, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Operation = "visible" | "metadata" | "erase";

type ProcessedFile = {
  name: string;
  original_name: string;
  download_url: string;
};

type ProcessResponse = {
  count: number;
  download_all_url: string;
  download_url: string;
  files: ProcessedFile[];
};

const operations: Array<{
  value: Operation;
  title: string;
  description: string;
  icon: typeof Sparkles;
}> = [
  {
    value: "visible",
    title: "可见水印",
    description: "识别并清理 Gemini、豆包、即梦等常见标识。",
    icon: Sparkles,
  },
  {
    value: "metadata",
    title: "元数据",
    description: "移除 C2PA、EXIF、XMP 等 AI 来源信息。",
    icon: ShieldCheck,
  },
  {
    value: "erase",
    title: "区域擦除",
    description: "通过 x,y,w,h 指定需要擦除的矩形区域。",
    icon: Layers3,
  },
];

const modeTitle: Record<Operation, string> = {
  visible: "已知可见水印",
  metadata: "元数据清理",
  erase: "指定区域擦除",
};

export default function Page() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [operation, setOperation] = useState<Operation>("visible");
  const [mark, setMark] = useState("auto");
  const [regions, setRegions] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"Ready" | "Working" | "Done" | "Error">("Ready");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ProcessResponse | null>(null);

  const previewUrl = useMemo(() => {
    if (!files[0]) return "";
    return URL.createObjectURL(files[0]);
  }, [files]);

  function setSelectedFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setFiles(Array.from(fileList));
    setResult(null);
    setMessage("");
    setStatus("Ready");
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFiles(event.target.files);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    setSelectedFiles(event.dataTransfer.files);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length) {
      setMessage("请先选择图片。");
      setStatus("Error");
      return;
    }

    setStatus("Working");
    setMessage(files.length > 1 ? `正在处理 ${files.length} 张图片，请稍候...` : "处理中，请稍候...");
    setResult(null);

    const form = new FormData();
    files.forEach((file) => form.append("file", file));
    form.append("operation", operation);
    form.append("accept_terms", accepted ? "true" : "false");
    form.append("mark", mark);
    if (regions.trim()) form.append("regions", regions.trim());

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "处理失败");
      setResult(body);
      setStatus("Done");
      setMessage("");
    } catch (error) {
      setStatus("Error");
      setMessage(error instanceof Error ? error.message : "处理失败");
    }
  }

  const fileSummary = files.length
    ? files.length > 1
      ? `${files[0].name} 等 ${files.length} 张图片`
      : files[0].name
    : "支持批量上传 PNG、JPG、WEBP、BMP、TIFF";

  return (
    <main className="min-h-screen overflow-hidden px-4 py-5 sm:px-6 lg:px-8">
      <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between rounded-3xl border border-white/80 bg-white/80 px-4 shadow-sm backdrop-blur-xl">
        <a className="flex items-center gap-3 font-semibold tracking-tight text-slate-950" href="#tool">
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-slate-950 text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </span>
          CleanMark
        </a>
        <div className="hidden items-center gap-1 text-sm font-medium text-slate-500 sm:flex">
          <a className="rounded-full px-4 py-2 hover:bg-slate-100 hover:text-slate-950" href="#tool">
            工具
          </a>
          <a className="rounded-full px-4 py-2 hover:bg-slate-100 hover:text-slate-950" href="#workflow">
            流程
          </a>
          <a className="rounded-full px-4 py-2 hover:bg-slate-100 hover:text-slate-950" href="#notes">
            说明
          </a>
        </div>
      </nav>

      <section id="tool" className="mx-auto grid w-full max-w-6xl gap-12 py-16 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:py-20">
        <div className="space-y-8">
          <div className="space-y-6">
            <Badge className="border-sky-100 bg-white/70 text-sky-700">AI Image Cleanup</Badge>
            <div className="space-y-5">
              <h1 className="max-w-2xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-6xl">
                批量 AI 水印清理
              </h1>
              <p className="max-w-xl text-lg leading-8 text-slate-600">
                面向自托管的极简图片清理工具。批量上传后可清理可见 AI 标记、生成元数据，或擦除指定区域。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {["PNG / JPG / WEBP", "CPU 友好", "批量 ZIP 下载"].map((item) => (
                <Badge key={item}>{item}</Badge>
              ))}
            </div>
          </div>

          <Card className="overflow-hidden border-white/90 bg-white/70 p-3 shadow-xl shadow-slate-200/70">
            <div className="grid gap-3 sm:grid-cols-2">
              <figure className="group relative overflow-hidden rounded-2xl bg-slate-950">
                <img className="aspect-[16/11] h-full w-full object-cover" src="sample-before.webp" alt="清理前示例图" />
                <figcaption className="absolute left-4 top-4 rounded-full bg-slate-950/70 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
                  Before
                </figcaption>
              </figure>
              <figure className="group relative overflow-hidden rounded-2xl bg-slate-950">
                <img className="aspect-[16/11] h-full w-full object-cover" src="sample-after.webp" alt="清理后示例图" />
                <figcaption className="absolute left-4 top-4 rounded-full bg-emerald-600/85 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
                  After
                </figcaption>
              </figure>
            </div>
            <div className="flex flex-col gap-1 px-1 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-slate-950">真实样图处理</p>
              <p className="text-sm text-slate-500">右下角标识已清理，画面细节保留。</p>
            </div>
          </Card>
        </div>

        <Card className="border-white/90 bg-white/90 shadow-2xl shadow-slate-200/80 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-start justify-between gap-6 pb-4">
            <div className="space-y-2">
              <CardDescription className="font-semibold text-emerald-600">在线处理</CardDescription>
              <CardTitle>{modeTitle[operation]}</CardTitle>
            </div>
            <Badge className={cn(status === "Error" && "border-red-100 bg-red-50 text-red-700", status === "Done" && "border-emerald-100 bg-emerald-50 text-emerald-700")}>
              {status}
            </Badge>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={onSubmit}>
              <Label
                className={cn(
                  "relative flex min-h-36 cursor-pointer items-center gap-4 overflow-hidden rounded-3xl border border-dashed border-sky-200 bg-sky-50/70 p-5 transition hover:border-sky-400 hover:bg-sky-50",
                  dragging && "border-sky-500 bg-sky-100",
                  files.length && "min-h-52 items-end",
                )}
                onDragLeave={() => setDragging(false)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDrop={onDrop}
              >
                <input
                  ref={inputRef}
                  className="sr-only"
                  name="file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp,image/tiff"
                  multiple
                  required
                  onChange={onFileChange}
                />
                {previewUrl ? (
                  <>
                    <img className="absolute inset-0 h-full w-full object-cover" src={previewUrl} alt="待处理图片预览" />
                    <span className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-950/10 to-transparent" />
                  </>
                ) : null}
                {!previewUrl ? (
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white text-sky-600 shadow-sm">
                    <Upload className="h-6 w-6" />
                  </span>
                ) : null}
                <span className="relative z-10 grid gap-1">
                  <span className={cn("text-lg font-semibold text-slate-950", previewUrl && "text-white")}>拖入或选择图片</span>
                  <span className={cn("text-sm font-normal text-slate-500", previewUrl && "text-white/80")}>{fileSummary}</span>
                </span>
              </Label>

              <div className="space-y-3">
                <Label>选择处理方式</Label>
                <div className="grid gap-3 sm:grid-cols-3">
                  {operations.map((item) => {
                    const Icon = item.icon;
                    const active = operation === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        className={cn(
                          "grid min-h-32 gap-3 rounded-3xl border border-slate-200 bg-white p-4 text-left transition hover:border-sky-200 hover:shadow-sm",
                          active && "border-sky-300 bg-sky-50 shadow-sm",
                        )}
                        onClick={() => setOperation(item.value)}
                      >
                        <span className="grid h-9 w-9 place-items-center rounded-2xl bg-slate-100 text-slate-600">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="grid gap-1">
                          <span className="font-semibold text-slate-950">{item.title}</span>
                          <span className="text-sm leading-5 text-slate-500">{item.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {operation === "visible" ? (
                <div className="space-y-2">
                  <Label htmlFor="mark">水印类型</Label>
                  <select
                    id="mark"
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-950 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                    value={mark}
                    onChange={(event) => setMark(event.target.value)}
                  >
                    <option value="auto">自动识别</option>
                    <option value="gemini">Gemini / Nano Banana</option>
                    <option value="doubao">豆包</option>
                    <option value="jimeng">即梦</option>
                    <option value="samsung">Samsung Galaxy AI</option>
                  </select>
                </div>
              ) : null}

              {operation === "erase" ? (
                <div className="space-y-2">
                  <Label htmlFor="regions">区域坐标</Label>
                  <Textarea id="regions" placeholder="示例：1640,1930,400,100" value={regions} onChange={(event) => setRegions(event.target.value)} />
                </div>
              ) : null}

              <Label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm font-normal leading-6 text-slate-600">
                <Checkbox checked={accepted} onCheckedChange={(checked) => setAccepted(checked === true)} />
                <span>我确认仅处理自己有权处理的内容，并自行遵守适用法律与平台规则。</span>
              </Label>

              <Button className="h-12 w-full rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={status === "Working"} type="submit">
                {status === "Working" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                开始处理
              </Button>

              <p className="text-center text-xs text-slate-400">处理缓存会按服务器配置自动清理，默认保留 24 小时。</p>

              {message ? (
                <div className={cn("rounded-2xl border p-4 text-sm", status === "Error" ? "border-red-100 bg-red-50 text-red-700" : "border-sky-100 bg-sky-50 text-sky-700")}>
                  {message}
                </div>
              ) : null}

              {result ? (
                <div className="rounded-3xl border border-emerald-100 bg-emerald-50/80 p-4">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4" />
                      处理完成，共 {result.count || 1} 张
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <a href={result.download_all_url || result.download_url}>
                        <Archive className="h-4 w-4" />
                        下载全部
                      </a>
                    </Button>
                  </div>
                  <ul className="grid gap-2">
                    {result.files?.map((file) => (
                      <li key={file.download_url} className="flex items-center justify-between gap-3 rounded-2xl bg-white/80 px-3 py-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2 font-medium text-slate-700">
                          <FileImage className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="truncate">{file.original_name || file.name}</span>
                        </span>
                        <a className="inline-flex items-center gap-1 font-semibold text-sky-700" href={file.download_url}>
                          <Download className="h-3.5 w-3.5" />
                          单独下载
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </section>

      <section id="workflow" className="mx-auto grid w-full max-w-6xl gap-4 py-8 sm:grid-cols-3">
        {[
          ["01", "上传图片", "选择一张或多张待处理图片，页面会显示第一张预览和文件数量。"],
          ["02", "选择模式", "可处理已知可见水印、AI 元数据，或手动擦除指定区域。"],
          ["03", "下载结果", "处理完成后可以下载全部 ZIP，也可以逐张下载。"],
        ].map(([step, title, description]) => (
          <Card key={step} className="bg-white/75">
            <CardContent className="space-y-4 p-5">
              <span className="grid h-9 w-9 place-items-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">{step}</span>
              <div className="space-y-2">
                <h3 className="font-semibold text-slate-950">{title}</h3>
                <p className="text-sm leading-6 text-slate-500">{description}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section id="notes" className="mx-auto mb-10 grid w-full max-w-6xl gap-5 rounded-3xl border border-slate-200 bg-white/75 p-6 shadow-sm sm:grid-cols-[0.8fr_1.2fr] sm:items-center">
        <div>
          <Badge className="mb-3 text-sky-700">Deployment Ready</Badge>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">为自托管准备</h2>
        </div>
        <p className="text-sm leading-7 text-slate-500">
          当前版本默认走 CPU 友好路径，不启用需要 GPU 的扩散重生成。公开部署时建议继续放在 Cloudflare 后面，并按访问量配置限流。
        </p>
      </section>
    </main>
  );
}

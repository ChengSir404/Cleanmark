"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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
  const selectedOperation = operations.find((item) => item.value === operation);

  return (
    <main className="min-h-screen overflow-hidden px-4 py-5 sm:px-6 lg:px-8">
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between rounded-lg border border-slate-200 bg-white/85 px-4 shadow-sm backdrop-blur-xl">
        <a className="flex items-center gap-3 font-semibold tracking-tight text-slate-950" href="#tool">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-950 text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </span>
          CleanMark
        </a>
        <div className="hidden items-center gap-1 text-sm font-medium text-slate-500 sm:flex">
          <a className="rounded-full px-4 py-2 hover:bg-slate-100 hover:text-slate-950" href="#tool">
            工具
          </a>
          <a className="rounded-full px-4 py-2 hover:bg-slate-100 hover:text-slate-950" href="#notes">
            说明
          </a>
        </div>
      </nav>

      <section id="tool" className="mx-auto w-full max-w-6xl py-14 lg:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <Badge className="border-sky-100 bg-white/70 text-sky-700">AI Image Cleanup</Badge>
          <div className="mt-6 space-y-5">
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">CleanMark AI 水印清理工具</h1>
            <p className="mx-auto max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              上传图片，批量清理常见可见 AI 标记、AI 元数据，或擦除指定区域。
            </p>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {["PNG / JPG / WEBP", "CPU 友好", "批量 ZIP 下载"].map((item) => (
              <Badge key={item}>{item}</Badge>
            ))}
          </div>
        </div>

        <Card className="mx-auto mt-10 w-full max-w-5xl overflow-hidden border-slate-200 bg-white/95 shadow-xl shadow-slate-200/70 backdrop-blur-xl">
          <CardHeader className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <CardDescription className="font-semibold text-emerald-600">在线处理</CardDescription>
                <CardTitle className="text-2xl tracking-tight">上传图片开始处理</CardTitle>
              </div>
              <Badge
                className={cn(
                  "w-fit",
                  status === "Error" && "border-red-100 bg-red-50 text-red-700",
                  status === "Done" && "border-emerald-100 bg-emerald-50 text-emerald-700",
                  status === "Working" && "border-sky-100 bg-sky-50 text-sky-700",
                )}
              >
                {status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <form onSubmit={onSubmit}>
              <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                <div className="border-b border-slate-100 bg-slate-50/60 p-5 lg:border-b-0 lg:border-r lg:p-6">
                  <Label
                    className={cn(
                      "flex min-h-[360px] cursor-pointer flex-col justify-between rounded-lg border border-dashed border-slate-300 bg-white p-4 transition hover:border-sky-400 hover:bg-sky-50/30",
                      dragging && "border-sky-500 bg-sky-50",
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
                      <span className="block overflow-hidden rounded-lg bg-slate-950 shadow-sm">
                        <img className="aspect-[4/3] w-full object-contain" src={previewUrl} alt="待处理图片预览" />
                      </span>
                    ) : (
                      <span className="grid min-h-[220px] place-items-center rounded-lg bg-slate-50">
                        <span className="grid place-items-center gap-4 text-center">
                          <span className="grid h-16 w-16 place-items-center rounded-lg bg-white text-sky-600 shadow-sm ring-1 ring-slate-200">
                            <Upload className="h-7 w-7" />
                          </span>
                          <span className="space-y-1">
                            <span className="block text-lg font-semibold text-slate-950">拖入图片开始处理</span>
                            <span className="block text-sm font-normal text-slate-500">也可以点击选择，支持一次上传多张</span>
                          </span>
                        </span>
                      </span>
                    )}
                    <span className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-950">{fileSummary}</span>
                        <span className="mt-1 block text-xs font-normal text-slate-500">第一张图片会在这里预览，批量文件会一起提交</span>
                      </span>
                      <span className="shrink-0 rounded-md bg-slate-950 px-3 py-2 text-xs font-semibold text-white">
                        选择图片
                      </span>
                    </span>
                  </Label>
                </div>

                <div className="space-y-5 p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">处理设置</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{selectedOperation?.description}</p>
                    </div>
                    {files.length ? <Badge>{files.length} 张</Badge> : null}
                  </div>

                  <div className="space-y-2">
                    <Label>选择处理方式</Label>
                    <div className="grid gap-2">
                      {operations.map((item) => {
                        const Icon = item.icon;
                        const active = operation === item.value;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:bg-slate-50",
                              active && "border-slate-950 bg-slate-950 text-white shadow-sm hover:border-slate-950 hover:bg-slate-950",
                            )}
                            onClick={() => setOperation(item.value)}
                            aria-pressed={active}
                          >
                            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600", active && "bg-white/12 text-white")}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold">{item.title}</span>
                              <span className={cn("mt-0.5 block truncate text-xs text-slate-500", active && "text-white/70")}>{item.description}</span>
                            </span>
                            {active ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : null}
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
                        className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
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

                  <Label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-normal leading-6 text-slate-600">
                    <Checkbox checked={accepted} onCheckedChange={(checked) => setAccepted(checked === true)} />
                    <span>我确认仅处理自己有权处理的内容，并自行遵守适用法律与平台规则。</span>
                  </Label>

                  <Button className="h-12 w-full bg-slate-950 text-white hover:bg-slate-800" disabled={status === "Working"} type="submit">
                    {status === "Working" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {status === "Working" ? "正在处理" : "开始处理"}
                  </Button>

                  <p className="text-center text-xs text-slate-400">处理缓存会按服务器配置自动清理，默认保留 24 小时。</p>
                </div>
              </div>

              {(message || result) ? (
                <div className="border-t border-slate-100 bg-white p-5 sm:p-6">
                  {message ? (
                    <div className={cn("rounded-lg border p-4 text-sm", status === "Error" ? "border-red-100 bg-red-50 text-red-700" : "border-sky-100 bg-sky-50 text-sky-700")}>
                      {message}
                    </div>
                  ) : null}

                  {result ? (
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50/80 p-4">
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3 text-sm font-semibold text-emerald-800">
                          <span className="grid h-9 w-9 place-items-center rounded-md bg-white text-emerald-700 shadow-sm">
                            <CheckCircle2 className="h-4 w-4" />
                          </span>
                          <span>
                            <span className="block">处理完成，共 {result.count || 1} 张</span>
                            <span className="mt-0.5 block text-xs font-normal text-emerald-700/70">可以打包下载，也可以逐张保存</span>
                          </span>
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
                          <li key={file.download_url} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2.5 text-sm shadow-sm">
                            <span className="flex min-w-0 items-center gap-2 font-medium text-slate-700">
                              <FileImage className="h-4 w-4 shrink-0 text-slate-400" />
                              <span className="truncate">{file.original_name || file.name}</span>
                            </span>
                            <a className="inline-flex shrink-0 items-center gap-1 font-semibold text-sky-700 hover:text-sky-900" href={file.download_url}>
                              <Download className="h-3.5 w-3.5" />
                              单独下载
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </section>

      <section id="notes" className="mx-auto mb-10 w-full max-w-6xl rounded-lg border border-amber-200 bg-amber-50/70 p-4 text-sm leading-6 text-amber-900">
        当前版本不处理需要 GPU 扩散重生成的不可见水印；如果图片属于这类水印，页面会保留原图或返回处理失败提示。
      </section>

      <section className="mx-auto mb-12 w-full max-w-6xl">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-emerald-600">效果示例</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">原图与清理后对比</h2>
          </div>
          <p className="text-sm text-slate-500">右下角标识已清理，画面细节保留。</p>
        </div>
        <Card className="overflow-hidden border-slate-200 bg-white/80 p-3 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2">
            <figure className="overflow-hidden rounded-lg border border-slate-200 bg-white p-2">
              <figcaption className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-slate-500">
                <span className="text-slate-950">Before</span>
                <span>原图完整显示</span>
              </figcaption>
              <img className="aspect-video w-full rounded-md bg-slate-950 object-contain" src="sample-before.webp" alt="清理前示例图" />
            </figure>
            <figure className="overflow-hidden rounded-lg border border-slate-200 bg-white p-2">
              <figcaption className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-slate-500">
                <span className="text-emerald-700">After</span>
                <span>AI 标识已清理</span>
              </figcaption>
              <img className="aspect-video w-full rounded-md bg-slate-950 object-contain" src="sample-after.webp" alt="清理后示例图" />
            </figure>
          </div>
        </Card>
      </section>
    </main>
  );
}

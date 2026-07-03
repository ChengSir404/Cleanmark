import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "CleanMark AI 水印清理工具",
  description: "自托管 AI 图片水印清理工具，支持批量上传和打包下载。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

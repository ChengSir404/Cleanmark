# AI 水印处理 Web 工具

这是一个给 `wiltodelta/remove-ai-watermarks` 做的轻量 Web 外壳，适合先部署到普通 CPU 服务器上对外访问。

## 功能

- 已知可见 AI 水印处理：Gemini / Nano Banana、豆包、即梦、Samsung Galaxy AI
- AI 相关元数据清理：C2PA、EXIF、XMP 等
- 指定区域擦除：输入 `x,y,w,h` 坐标
- 上传大小限制、处理超时、基础健康检查

当前默认不开放 SynthID / 不可见水印扩散重生成，因为那一路通常需要 GPU、大模型和队列控制。

## 本地运行

```bash
uv sync --extra dev
uv run uvicorn app.main:app --reload
```

打开 `http://127.0.0.1:8000`。

## 服务器部署

1. 复制环境变量样例：

```bash
cp .env.example .env
```

2. 编辑 `.env`：

```bash
PUBLIC_DOMAIN=你的域名
MAX_UPLOAD_MB=20
PROCESS_TIMEOUT_SECONDS=120
```

3. 启动：

```bash
docker compose up -d --build
```

Caddy 会监听 80/443，并自动申请 HTTPS 证书。请先把域名 A 记录指向服务器公网 IP。

## 运维

```bash
docker compose logs -f
docker compose ps
docker compose down
docker compose pull
docker compose up -d --build
```

处理结果保存在 Docker volume `jobs` 中。需要定期清理时可以进入服务器执行：

```bash
docker compose down
docker volume rm remove_jobs
docker compose up -d
```

## 限制

- 这是 CPU 版，不处理需要 GPU 的不可见水印扩散重生成。
- 指定区域擦除需要用户自己填写坐标。
- 公开服务建议放在 Cloudflare 或其他网关后面，再加访问频率限制。
- 使用者需要确认自己有权处理上传内容，并遵守当地法律和平台规则。


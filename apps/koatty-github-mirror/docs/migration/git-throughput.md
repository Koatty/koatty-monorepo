# Git 吞吐分段诊断

新增 `scripts/git-throughput.mjs`，不改变应用转发行为，不需要重建容器。依赖 Node.js 22，无额外 npm 依赖；可通过标准输入在现有 mirror 容器执行。

文件下载快不能代表 Git 快：Release/Raw/归档可能来自不同 CDN；Git upload-pack 需要协商、枚举、压缩，然后发送 pack。本站目前是实时转发，没有 Git 仓库缓存。公网域名若经过 CDN，还多一层代理。

## 在 VPS 工程目录执行

将脚本上传到工程的 `scripts/`，在包含 Compose 配置的目录运行：

```bash
docker compose exec -T \
  -e MIRROR_PERF_REPO=richenlin/pipewright \
  -e MIRROR_PERF_SECONDS=30 \
  -e MIRROR_ORIGIN_BASE_URL=http://127.0.0.1:3000 \
  -e MIRROR_BASE_URL=https://du.koatty.org \
  mirror node --input-type=module < scripts/git-throughput.mjs
```

依次测试容器 → GitHub、容器 → 本地 Koatty → GitHub、容器 → 公网域名 → Koatty → GitHub。各路径使用同一 HEAD 和相同 Git v0/HTTP 1.1/IPv4 请求；顺序执行避免争抢带宽。默认完整历史，每次请求最多 30 秒或 256 MiB，pack 不落盘、不执行 checkout、不读取 Git 凭证、不发起 push。每条路径先测 refs，再测 pack，总耗时最多约 3 分钟。`time-limit` / `byte-limit` 代表采样截断，不能当作完整克隆成功。

同样在本地运行（需要 Node.js 22），比较用户入口线路：

```bash
MIRROR_PERF_REPO=richenlin/pipewright \
MIRROR_BASE_URL=https://du.koatty.org \
node scripts/git-throughput.mjs
```

也可设置 `MIRROR_PERF_SHALLOW=1` 测试仅一层历史，但两轮结果不能直接比较；普通 `pull` 的增量协商也不等于该克隆请求。建议相同配置重复两轮，排除瞬时抖动和上游打包缓存影响。

## 解读 JSON 行

- `phase=discovery`：refs 延迟和 HTTP 状态；不是吞吐测试。
- `phase=pack`：`bytes` / `averageKiBps` 包含等待、协议及进度信息；`packBytes` 仅统计完整 Git 数据包的 pack 字节。
- `firstByteSeconds`：收到首段响应体；可能只是 Counting/Compressing 进度。`firstPackSeconds` 才是收到首个完整 pack 数据包的时间。
- `packKiBps`：从首个完整 pack 数据包到采样结束的近似速率，小样本不可当稳定带宽。`packBytes=0` 时无法判断数据吞吐。
- `status=200` 且匹配 Git Content-Type 才是正常协议响应。检查 `outcome`，`git-error` / `truncated-git-packet` / `connection-error` 等不能算成功。

| VPS 结果 | 优先排查 |
| --- | --- |
| github 本身慢 | VPS 出站到 github.com 的路由、丢包、DNS 选址或 GitHub 打包耗时；换本地缓冲参数无法解决这段问题 |
| github 快，application 慢 | 容器资源/CPU、应用流式转发和并发压力；保留同轮输出进一步定位 |
| application 快，public 慢 | Nginx/Caddy/CDN 链路，核对 Git POST 是否被特殊规则处理；逐层绕过对照后再调整配置 |
| VPS 三项快，本地 public 慢 | 用户到公网入口线路；用同仓库同请求比较绕过 CDN 的受控直连入口 |

公网绕过 CDN 测试应使用已有有效 HTTPS 源站入口或 `curl --resolve` 保持正确 SNI，不能关闭证书校验；不要为测速将 3000 暴露公网。Nginx 流式配置见 [Git 读写部署说明](git-write.md)。不要把增大 `http.postBuffer`、关闭 Git 压缩或增加超时当成下载提速的通用修复。

此次仅增加诊断能力。未更改线上代理配置，也不宣称已解决生产吞吐问题。

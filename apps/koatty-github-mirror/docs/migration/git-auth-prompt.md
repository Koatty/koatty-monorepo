# Git 认证弹窗提示 PAT

GitHub HTTPS Git 不接受账号密码。新版对 GitHub Git 端点的 401 认证挑战返回：

```http
WWW-Authenticate: Basic realm="GitHub - enter a Personal Access Token (PAT) as password, not your account password"
Cache-Control: no-store
```

Basic 是 Git HTTPS 的认证传输机制，用户名填写 GitHub 用户名，password 字段承载 PAT。认证错误码由 UPSTREAM_REJECTED 细化为 GITHUB_AUTH_REQUIRED；中文错误正文明确提示 PAT、账号密码不可用，以及令牌有效期/仓库权限检查。首页 Git 模式同样明确提示。

## 客户端边界

浏览器原生 HTTP 认证弹窗、Git Credential Manager、IDE、系统钥匙串的界面由各客户端生成。有的会显示服务器的 realm，有的只显示 host、Username、Password。服务端不能强制改名这些控件，也不能替换客户端自定义登录窗口。本次保证 HTTP 挑战与错误正文含明确信息，不宣称每个 Git 客户端的弹窗都会展示 realm。

令牌应交互输入，不放进远程 URL 或脚本。若凭证管理器保存了旧账号密码，可以先在仓库内运行以下命令，仅本次绕过 credential helper，再在密码提示处输入 PAT：

```bash
git -c credential.helper= pull
```

验证成功后，在凭证管理器中替换 du.koatty.org 对应的旧密码。pull 至少需要目标仓库的 Contents 读取权限，push 需要相应写权限；组织批准/SSO 等仍由 GitHub 判断。

## 更新

将新版包的 src、static 同步到原构建目录，保留 .env 和代理配置，然后执行：

```bash
docker compose up -d --build --no-deps mirror
```

此更新不需要新增依赖。刷新首页使前端说明更新。用匿名请求访问需要认证的 Git 仓库 info/refs，可检查 401 challenge 中的 PAT 提示；没有真实凭证的探测不能证明某个用户账号已经通过认证。

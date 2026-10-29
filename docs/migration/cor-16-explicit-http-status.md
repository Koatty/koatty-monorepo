# COR-16：显式 HTTP 错误状态与响应体

状态：源码修复，未发布。触发场景：GitHub 下载代理将上游 404 转成安全 JSON 错误后，Trace 原先会因为存在 body 而将 404 改成 200。对其他显式错误响应，原先还会抛出新的异常并改写应用响应体。

现在保留应用设置的状态码与非空响应体；`ctx.respond = false`、已经发送头或已经结束的响应不再进行状态修正。错误状态没有响应体时仍走框架异常处理。

迁移：依赖旧行为的应用须显式设置正确状态，例如成功响应使用 `ctx.status = 200`，不能依赖“404 + body 自动变成成功”。直接设置错误 body 的应用应自行提供所需的安全错误结构；若需要框架标准异常格式，应抛出框架异常，而不是先设置 body。普通 Koa `ctx.body = data` 仍由 Koa 自身将初始状态切换到 200。

回归证据：`packages/koatty-trace/test/regression/COR-16.explicit-http-status.test.ts`；镜像站真实 HTTP 回归位于 `apps/koatty-github-mirror/test/regression/MIRROR-02.http-git.test.js`。生产发布和 VPS 验收单独进行。

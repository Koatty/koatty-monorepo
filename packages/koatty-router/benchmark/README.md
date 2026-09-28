# Benchmarks

## `router-hotpath.js` (PERF-01 / plan D-4)

Compares the legacy per-request router pipeline (fresh array + `koa-compose()` on every
request) with the registration-time handler produced by `createRouteHandler()`.

```bash
cd packages/koatty-router
node benchmark/router-hotpath.js            # 200k iterations
ITERATIONS=1000000 node benchmark/router-hotpath.js
```

It reports ns/op and ops/s for both variants plus the percentage reduction of the
per-request pipeline cost. It is a plain script (not part of `jest`) on purpose:
timing assertions in CI are flaky, so the jest regression test
(`test/regression/PERF-01.handler-hotpath.test.ts`) only asserts structural facts
(`koa-compose` must not be called on the request path, falsy results survive).

Historical development measurement (Node 20 / Apple Silicon, 200k iterations; not reproduced by the A–D remediation and not a result for current source):

```
legacy  (compose per request): 183-201 ns/op  (5.0-5.5M ops/s)
new     (pre-built handler)  : 105-119 ns/op  (8.4-9.5M ops/s)
per-request pipeline cost reduction: 41-43%
```

This is the handler layer only (the plan's D-4 acceptance target of ≥10% RPS applies to
the end-to-end benchmark in §12).

## `http-comparison.cjs`

`node packages/koatty-router/benchmark/http-comparison.cjs`（仓库根目录）。
真实本地 HTTP、16 并发、每轮 5000 请求、7 组交替顺序，对比仓库 HEAD 的旧 handler 与当前源码；输出逐轮 RPS/p99、运行时与基线 commit。它隔离 handler 变更，不能代表两个完整框架版本的性能；`targetMet=false` 时不得宣称达到 ≥10%/p99 不回退目标。

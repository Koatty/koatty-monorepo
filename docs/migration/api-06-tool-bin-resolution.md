# API-06：verify 识别 package.json 声明的可执行入口

状态：源码修复，未发布。

镜像站验证发现：ESLint 已安装且手动 lint 成功，但 `koatty_ai verify --checks lint` 报 DEPENDENCY_MISSING。原因是其复用的 koatty_cli 使用 `require.resolve('eslint/bin/eslint.js')`，而 ESLint 的 exports 不开放该子路径。

现在仍优先使用 Node 模块解析。解析失败时读取可解析的 package.json，并验证请求入口确实在 bin 声明中、真实文件存在且未逃逸包目录。仍要求项目直接声明此工具，不自动安装依赖，不使用 shell，也不运行任意隐藏文件。

用户无需改配置。原本的缺包、缺入口、未声明依赖仍失败。本次变更同时适用于 CLI 与 koatty_ai 复用的 verify。回归：`packages/koatty_cli/test/regression/API-06.exported-tool-bin.test.ts`。

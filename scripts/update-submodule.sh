#!/bin/bash
set -e

SUBMODULE_PATH="packages/koatty"

echo "======================================"
echo "Koatty Submodule 更新脚本"
echo "======================================"
echo ""

# 检查是否是 submodule
if [ ! -f ".gitmodules" ] || [ ! -d "$SUBMODULE_PATH/.git" ]; then
    echo "错误: $SUBMODULE_PATH 不是 submodule"
    echo "请先运行 scripts/setup-submodule.sh 配置 submodule"
    exit 1
fi

echo "更新 submodule 到最新版本..."
git submodule update --remote "$SUBMODULE_PATH"

echo ""
echo "检查 submodule 状态..."
git status "$SUBMODULE_PATH"

echo ""
echo "======================================"
echo "✓ Submodule 更新完成！"
echo "======================================"
echo ""
echo "后续步骤："
echo "1. 检查更新内容: cd $SUBMODULE_PATH && git log --oneline origin/master"
echo "2. 如果需要，提交 submodule 引用的更新: git add $SUBMODULE_PATH && git commit -m 'chore: update koatti submodule'"

#!/bin/bash
set -e

SUBMODULE_URL="https://github.com/Koatty/koatty_container.git"
SUBMODULE_PATH="packages/koatty-container"

echo "======================================"
echo "Koatty Submodule 配置脚本"
echo "======================================"
echo ""

# 检查是否已经在 packages/$SUBMODULE_PATH 目录中
if [ -d "$SUBMODULE_PATH/.git" ]; then
    echo "✓ $SUBMODULE_PATH 已经是 submodule"
    echo ""
    echo "Submodule 信息:"
    git submodule status
    exit 0
fi

# 检查是否已有备份目录
if [ -d "$SUBMODULE_PATH.backup" ]; then
    echo "⚠ 警告: $SUBMODULE_PATH.backup 已存在"
    echo "请手动删除备份目录后再运行此脚本"
    exit 1
fi

# 检查 $SUBMODULE_PATH 是否存在
if [ -d "$SUBMODULE_PATH" ]; then
    echo "检测到现有的 $SUBMODULE_PATH 目录"
    echo ""
    read -p "是否要备份现有代码? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "备份现有的 $SUBMODULE_PATH 到 $SUBMODULE_PATH.backup..."
        mv $SUBMODULE_PATH $SUBMODULE_PATH.backup
        echo "✓ 备份完成"
    else
        echo "跳过备份，继续配置..."
        rm -rf $SUBMODULE_PATH
    fi
fi

# 检查 .gitmodules 文件
if [ ! -f ".gitmodules" ]; then
    echo "创建 .gitmodules 文件..."
    touch .gitmodules
fi

# 添加 submodule
echo ""
echo "添加 submodule..."
git submodule add $SUBMODULE_URL $SUBMODULE_PATH

# 提交
echo ""
echo "提交更改..."
git add .gitmodules $SUBMODULE_PATH
git commit -m "chore: add $SUBMODULE_NAME as submodule"

echo ""
echo "======================================"
echo "✓ Submodule 配置完成！"
echo "======================================"
echo ""
echo "Submodule 信息:"
git submodule status
echo ""
echo "后续步骤："
echo "1. 如果备份了代码，请手动从 $SUBMODULE_NAME.backup 合并到 $SUBMODULE_PATH"
echo "2. 在 CI/CD 中确保启用 submodule 检出"
echo "3. 使用 'git submodule update --remote' 更新 submodule 到最新版本"
echo ""
echo "注意事项："
echo "- 更新 $SUBMODULE_NAME 时需要进入 $SUBMODULE_PATH 目录单独提交"
echo "- monorepo 发布时需要同时更新 submodule 引用"

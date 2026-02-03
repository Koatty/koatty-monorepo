#!/bin/bash
set -e

# 默认值
DEFAULT_SUBMODULE_PATH="packages/koatty"
DEFAULT_SUBMODULE_URL="https://github.com/thinkkoa/koatty.git"
DEFAULT_SUBMODULE_NAME="koatty"

# 显示帮助信息
show_help() {
    cat << EOF
Submodule 配置脚本

用法:
  $0 [路径] [URL] [名称]

参数:
  路径   - Submodule 的本地路径 (默认: packages/koatty)
  URL    - Submodule 的 Git 仓库地址 (默认: https://github.com/thinkkoa/koatty.git)
  名称   - Submodule 的名称，用于提交消息 (默认: 从路径提取)

示例:
  # 使用默认配置
  $0

  # 指定路径和 URL
  $0 packages/koatty-container https://github.com/thinkkoa/koatty_container.git

  # 完整配置
  $0 packages/koatty-container https://github.com/thinkkoa/koatty_container.git koatty-container

  # 添加 tools 目录下的 submodule
  $0 tools/build-tools https://github.com/example/build-tools.git build-tools

支持的操作:
  - 完整性检查
  - 自动修复
  - 验证配置
  - 支持多次执行

EOF
}

# 处理参数
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    show_help
    exit 0
fi

# 检查参数
if [ $# -gt 3 ]; then
    print_error "参数过多"
    echo ""
    show_help
    exit 1
fi

# 解析命令行参数
SUBMODULE_PATH="${1:-$DEFAULT_SUBMODULE_PATH}"
SUBMODULE_URL="${2:-$DEFAULT_SUBMODULE_URL}"
SUBMODULE_NAME="${3:-$(basename "$SUBMODULE_PATH")}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 函数：打印带颜色的消息
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# 函数：验证 URL 格式
validate_url() {
    local url=$1
    if [[ $url =~ ^https?://.+\..+\.git$ ]] || [[ $url =~ ^git@.+:.+\.git$ ]] || [[ $url =~ ^https?://.+\..+$ ]]; then
        return 0
    else
        return 1
    fi
}

# 函数：验证路径格式
validate_path() {
    local path=$1
    if [[ $path =~ ^packages/ ]] || [[ $path =~ ^tools/ ]] || [[ $path =~ ^examples/ ]]; then
        return 0
    else
        return 1
    fi
}

# 函数：检查仓库是否存在
check_repository_exists() {
    local url=$1
    local branch="${2:-master}"

    if [[ $url =~ ^https?:// ]]; then
        local http_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
        if [ "$http_code" != "404" ] && [ "$http_code" != "000" ]; then
            return 0
        fi
    elif [[ $url =~ ^git@ ]]; then
        local repo_name=$(echo "$url" | sed 's/git@//' | sed 's/:.*//' | sed 's/\.git$//')
        local repo_path=$(echo "$url" | sed 's/.*://g' | sed 's/\.git$//')
        local api_url="https://api.github.com/repos/$repo_path"
        if curl -s -f "$api_url" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# 函数：完整性检查
run_integrity_check() {
    echo ""
    echo "======================================"
    echo "完整性检查"
    echo "======================================"
    echo ""

    local has_errors=0
    local has_warnings=0

    # 检查 1: URL 格式
    echo "检查 1: URL 格式"
    if ! validate_url "$SUBMODULE_URL"; then
        print_error "无效的 URL 格式: $SUBMODULE_URL"
        print_info "正确的格式: https://github.com/user/repo.git 或 git@github.com:user/repo.git"
        has_errors=1
    else
        print_success "URL 格式正确"
    fi

    # 检查 2: 路径格式
    echo ""
    echo "检查 2: 路径格式"
    if ! validate_path "$SUBMODULE_PATH"; then
        print_warning "非标准路径: $SUBMODULE_PATH"
        print_info "推荐路径: packages/*, tools/*, examples/*"
        has_warnings=1
    else
        print_success "路径格式正确"
    fi

    # 检查 3: 仓库是否存在
    echo ""
    echo "检查 3: 仓库是否存在"
    if check_repository_exists "$SUBMODULE_URL"; then
        print_success "仓库存在且可访问"
    else
        print_warning "无法验证仓库是否存在: $SUBMODULE_URL"
        print_info "仓库可能不存在或需要认证，将尝试继续..."
        has_warnings=1
    fi

    # 检查 4: 目录冲突
    echo ""
    echo "检查 4: 目录冲突"
    if [ -d "$SUBMODULE_PATH.backup" ]; then
        print_error "备份目录已存在: $SUBMODULE_PATH.backup"
        has_errors=1
    fi

    if [ -d "$SUBMODULE_PATH" ]; then
        if [ -d "$SUBMODULE_PATH/.git" ] || [ -f "$SUBMODULE_PATH/.git" ]; then
            print_warning "目录已存在且是 Git 仓库: $SUBMODULE_PATH"
        else
            print_warning "目录已存在（非 Git 仓库）: $SUBMODULE_PATH"
        fi
        has_warnings=1
    fi

    echo ""
    if [ $has_errors -eq 1 ]; then
        echo "======================================"
        print_error "完整性检查失败，请修复错误后重试"
        echo "======================================"
        exit 1
    fi

    if [ $has_warnings -eq 1 ]; then
        echo "======================================"
        print_warning "完整性检查通过，但有警告"
        echo "======================================"
    else
        echo "======================================"
        print_success "完整性检查通过"
        echo "======================================"
    fi
}

# 函数：自动修复
run_auto_fix() {
    echo ""
    echo "======================================"
    echo "自动修复"
    echo "======================================"
    echo ""

    local needs_fix=0

    # 修复 1: 从 git index 中删除非 submodule
    if git ls-files --error-unmatch "$SUBMODULE_PATH" &> /dev/null; then
        print_info "从 git index 中删除非 submodule 的 $SUBMODULE_PATH..."
        git rm -r --cached "$SUBMODULE_PATH" 2>/dev/null || true
        print_success "已从 git index 中删除"
        needs_fix=1
    fi

    # 修复 2: 清理本地的 submodule git 目录
    if [ -d ".git/modules/$SUBMODULE_PATH" ]; then
        print_info "清理本地的 submodule git 目录..."
        rm -rf ".git/modules/$SUBMODULE_PATH"
        print_success "已清理"
        needs_fix=1
    fi

    # 修复 3: 暂存 .gitmodules 更改
    if [ -f ".gitmodules" ]; then
        git add .gitmodules 2>/dev/null || true
    fi

    if [ $needs_fix -eq 1 ]; then
        print_info "已应用自动修复"
    else
        print_info "无需修复"
    fi
}

# 主函数
main() {
    echo "======================================"
    echo "Submodule 配置脚本"
    echo "======================================"
    echo ""
    echo "配置信息:"
    echo "  名称: $SUBMODULE_NAME"
    echo "  路径: $SUBMODULE_PATH"
    echo "  仓库: $SUBMODULE_URL"
    echo ""

    # 检查 gitmodules 和 submodule 状态
    if git submodule status 2>/dev/null | grep -q "$SUBMODULE_PATH"; then
        print_success "$SUBMODULE_PATH 已经是 submodule"
        echo ""
        echo "Submodule 信息:"
        git submodule status | grep "$SUBMODULE_PATH"
        echo ""
        echo "当前配置:"
        echo "  路径: $SUBMODULE_PATH"
        echo "  仓库: $SUBMODULE_URL"
        echo ""
        exit 0
    fi

    # 运行完整性检查
    run_integrity_check

    # 运行自动修复
    run_auto_fix

    # 询问是否备份
    if [ -d "$SUBMODULE_PATH" ] && [ ! -f "$SUBMODULE_PATH/.git" ]; then
        echo ""
        read -p "是否要备份现有代码? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "备份现有的 $SUBMODULE_PATH 到 $SUBMODULE_PATH.backup..."
            mv $SUBMODULE_PATH $SUBMODULE_PATH.backup
            print_success "备份完成"
        else
            echo "跳过备份，继续配置..."
            rm -rf $SUBMODULE_PATH
        fi
    elif [ -d "$SUBMODULE_PATH" ] && [ -f "$SUBMODULE_PATH/.git" ]; then
        # submodule 的 .git 文件，需要删除整个目录
        echo ""
        print_warning "检测到可能是旧版本的 submodule"
        read -p "是否要删除现有目录重新配置? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf $SUBMODULE_PATH
            print_success "已删除"
        else
            print_error "无法继续，请手动处理后重试"
            exit 1
        fi
    fi

    # 检查 .gitmodules 文件
    if [ ! -f ".gitmodules" ]; then
        print_info "创建 .gitmodules 文件..."
        touch .gitmodules
    fi

    # 添加 submodule
    echo ""
    echo "======================================"
    echo "添加 submodule"
    echo "======================================"
    echo ""
    if git submodule add $SUBMODULE_URL $SUBMODULE_PATH; then
        print_success "Submodule 添加成功"
    else
        print_error "Submodule 添加失败"
        print_info "请检查: 1) URL 是否正确 2) 仓库是否存在 3) 是否有权限访问"
        exit 1
    fi

    # 验证配置
    echo ""
    echo "======================================"
    echo "验证配置"
    echo "======================================"
    echo ""
    if [ -f ".gitmodules" ] && grep -q "path = $SUBMODULE_PATH" .gitmodules; then
        print_success ".gitmodules 配置正确"
    else
        print_error ".gitmodules 配置错误"
        exit 1
    fi

    if [ -d "$SUBMODULE_PATH/.git" ] || [ -f "$SUBMODULE_PATH/.git" ]; then
        print_success "Submodule 目录正确"
    else
        print_error "Submodule 目录不存在或配置错误"
        exit 1
    fi

    # 提交
    echo ""
    echo "======================================"
    echo "提交更改"
    echo "======================================"
    echo ""
    git add .gitmodules $SUBMODULE_PATH
    if git commit -m "chore: add $SUBMODULE_NAME as submodule"; then
        print_success "提交成功"
    else
        print_info "没有需要提交的更改（可能已提交）"
    fi

    # 完成
    echo ""
    echo "======================================"
    print_success "Submodule 配置完成！"
    echo "======================================"
    echo ""
    echo "Submodule 信息:"
    git submodule status | grep "$SUBMODULE_PATH" || git submodule status
    echo ""
    echo "后续步骤："
    echo "1. 如果备份了代码，请手动从 $SUBMODULE_PATH.backup 合并到 $SUBMODULE_PATH"
    echo "2. 在 CI/CD 中确保启用 submodule 检出"
    echo "3. 使用 'git submodule update --remote $SUBMODULE_PATH' 更新 submodule"
    echo ""
    echo "注意事项："
    echo "- 更新 $SUBMODULE_NAME 时需要进入 $SUBMODULE_PATH 目录单独提交"
    echo "- monorepo 发布时需要同时更新 submodule 引用"
}

# 运行主函数
main

#!/bin/bash
set -e

# 显示帮助信息
show_help() {
    cat << EOF
移除指定的 Git submodule

用法:
  $0 <submodule_path> [选项]

参数:
  submodule_path   - Submodule 的本地路径，如 packages/koatty-consul（必填）

选项:
  -y, --yes         - 不确认，直接执行
  -n, --dry-run     - 仅打印将执行的操作，不实际执行
  -h, --help        - 显示此帮助

示例:
  # 移除 packages/koatty-consul
  $0 packages/koatty-consul

  # 先预览再执行
  $0 packages/koatty-consul --dry-run
  $0 packages/koatty-consul -y

  # 从仓库根目录执行（推荐）
  ./scripts/remove-submodule.sh packages/koatty-consul

说明:
  1. 必须在 Git 仓库根目录执行
  2. 会执行: deinit -> git rm -> 清理 .git/modules 缓存
  3. 变更会处于暂存状态，需自行 commit

EOF
}

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error()   { echo -e "${RED}✗${NC} $1"; }
print_info()    { echo -e "${BLUE}ℹ${NC} $1"; }

# 解析参数
SUBMODULE_PATH=""
DRY_RUN=0
CONFIRM=1

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -n|--dry-run)
            DRY_RUN=1
            shift
            ;;
        -y|--yes)
            CONFIRM=0
            shift
            ;;
        -*)
            print_error "未知选项: $1"
            show_help
            exit 1
            ;;
        *)
            if [ -z "$SUBMODULE_PATH" ]; then
                SUBMODULE_PATH="$1"
            else
                print_error "多余参数: $1"
                exit 1
            fi
            shift
            ;;
    esac
done

# 必须提供路径
if [ -z "$SUBMODULE_PATH" ]; then
    print_error "请指定 submodule 路径"
    echo ""
    show_help
    exit 1
fi

# 必须在仓库根目录
if [ ! -f ".gitmodules" ]; then
    print_error "未找到 .gitmodules，请在 Git 仓库根目录执行"
    exit 1
fi

# 检查是否为已配置的 submodule
if ! grep -q "path = $SUBMODULE_PATH" .gitmodules 2>/dev/null; then
    print_error "未在 .gitmodules 中找到路径: $SUBMODULE_PATH"
    echo ""
    print_info "当前 .gitmodules 中的 submodule 路径："
    grep "path = " .gitmodules | sed 's/^/  /'
    exit 1
fi

# 显示将要执行的操作
echo ""
echo "======================================"
echo "移除 Submodule"
echo "======================================"
echo ""
print_info "路径: $SUBMODULE_PATH"
echo ""
echo "将执行以下操作:"
echo "  1. git submodule deinit -f $SUBMODULE_PATH"
echo "  2. git rm -f $SUBMODULE_PATH"
echo "  3. rm -rf .git/modules/$SUBMODULE_PATH"
echo ""

if [ $DRY_RUN -eq 1 ]; then
    print_warning "[dry-run] 未执行任何修改"
    exit 0
fi

if [ $CONFIRM -eq 1 ]; then
    read -p "确认移除? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "已取消"
        exit 0
    fi
fi

# 执行移除
echo ""

if git submodule status "$SUBMODULE_PATH" &>/dev/null || true; then
    print_info "正在 deinit submodule..."
    git submodule deinit -f "$SUBMODULE_PATH"
    print_success "deinit 完成"
else
    print_warning "submodule 未初始化或已 deinit，跳过 deinit"
fi

print_info "正在从索引移除..."
git rm -f "$SUBMODULE_PATH"
print_success "已从索引移除"

if [ -d ".git/modules/$SUBMODULE_PATH" ]; then
    print_info "正在清理 .git/modules 缓存..."
    rm -rf ".git/modules/$SUBMODULE_PATH"
    print_success "缓存已清理"
fi

echo ""
echo "======================================"
print_success "Submodule 已移除"
echo "======================================"
echo ""
print_info "变更已暂存，可执行以下命令提交:"
echo "  git commit -m \"chore: remove submodule $SUBMODULE_PATH\""
echo ""

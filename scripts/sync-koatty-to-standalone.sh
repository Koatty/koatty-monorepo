#!/usr/bin/env bash
# Sync packages/koatty to standalone repo (Koatty/koatty), branch: monorepo
#
# Usage:
#   SYNC_TOKEN=<github-pat> bash scripts/sync-koatty-to-standalone.sh
#
# Required env:
#   SYNC_TOKEN  — GitHub PAT with push access to Koatty/koatty
#
# Optional env:
#   STANDALONE_REPO_URL  — override repo URL (default: https://github.com/Koatty/koatty.git)
#   SYNC_BRANCH          — override target branch (default: monorepo)
#   DRY_RUN              — set to 1 to skip the git push

set -euo pipefail

REPO_URL="${STANDALONE_REPO_URL:-https://github.com/Koatty/koatty.git}"
BRANCH="${SYNC_BRANCH:-monorepo}"
PACKAGE_DIR="packages/koatty"
MONOREPO_ROOT="$(git rev-parse --show-toplevel)"

# Resolve absolute path in case this script is called from another cwd
PACKAGE_ABS="${MONOREPO_ROOT}/${PACKAGE_DIR}"

if [[ ! -d "${PACKAGE_ABS}" ]]; then
  echo "❌ Package directory not found: ${PACKAGE_ABS}"
  exit 1
fi

VERSION=$(node -p "require('${PACKAGE_ABS}/package.json').version" 2>/dev/null)
echo "📦 Syncing koatty@${VERSION} → ${REPO_URL} (branch: ${BRANCH})"

# Build authenticated URL
if [[ -n "${SYNC_TOKEN:-}" ]]; then
  AUTH_URL="https://x-access-token:${SYNC_TOKEN}@${REPO_URL#https://}"
else
  AUTH_URL="${REPO_URL}"
  echo "⚠️  SYNC_TOKEN not set — push may fail if repo requires auth"
fi

# Configure git identity if not already set
git config --global user.email "$(git config user.email 2>/dev/null || echo 'github-actions@github.com')"
git config --global user.name "$(git config user.name 2>/dev/null || echo 'GitHub Actions')"

TEMP_REPO=$(mktemp -d)   # standalone repo clone (has .git/)
TEMP_STAGE=$(mktemp -d) # clean staging area (no .git/, avoids macOS rsync bug)
trap 'rm -rf "${TEMP_REPO}" "${TEMP_STAGE}"' EXIT

echo "🔍 Checking branch '${BRANCH}' on standalone repo..."
if git ls-remote --exit-code --heads "${AUTH_URL}" "refs/heads/${BRANCH}" >/dev/null 2>&1; then
  echo "  Branch exists — cloning..."
  git clone --branch "${BRANCH}" --single-branch --depth 1 "${AUTH_URL}" "${TEMP_REPO}"
else
  echo "  Branch not found — creating from default branch..."
  git clone --depth 1 "${AUTH_URL}" "${TEMP_REPO}"
  git -C "${TEMP_REPO}" checkout -b "${BRANCH}"
fi

# Clear existing tracked files via git (preserves .git/ structure)
echo "🧹 Clearing existing content..."
git -C "${TEMP_REPO}" rm -rf . --quiet 2>/dev/null || true

# Step 1: rsync to a clean staging dir (no .git/ → avoids macOS BSD rsync 2.6.9 bug)
# Use --exclude='.git' without trailing slash to exclude both .git files (gitlink) and .git dirs
echo "📋 Copying source files from ${PACKAGE_DIR}/..."
rsync -a \
  --exclude='.git' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='temp/' \
  --exclude='coverage/' \
  --exclude='*.tsbuildinfo' \
  --exclude='pnpm-lock.yaml' \
  --exclude='jest_html_reporters.html' \
  --exclude='jest-html-reporters-attach/' \
  --exclude='rollup.config-*.cjs' \
  --exclude='reports/' \
  "${PACKAGE_ABS}/" "${TEMP_STAGE}/"

# Step 2: copy from staging into the git repo dir
cp -r "${TEMP_STAGE}/." "${TEMP_REPO}/"

# Commit and push
cd "${TEMP_REPO}"
git add -A

if git diff --cached --quiet; then
  echo "✅ No changes detected — standalone repo is already up to date"
  exit 0
fi

COMMIT_MSG="chore: sync from koatty-monorepo v${VERSION}"
git commit -m "${COMMIT_MSG}"
echo "📝 Committed: ${COMMIT_MSG}"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "🔵 DRY_RUN=1 — skipping push"
else
  git push origin "${BRANCH}"
  echo "✅ Pushed to ${BRANCH}"
fi

echo ""
echo "✅ Sync complete: koatty@${VERSION} → ${REPO_URL}#${BRANCH}"

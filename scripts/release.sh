#!/usr/bin/env bash
# webcvt release script
#   1. Build playground + docs
#   2. Deploy both to Cloudflare Pages via wrangler
#   3. Publish all @catlabtech/webcvt-* packages to npm (with confirmation)
#
# Prerequisites (run once):
#   npm i -g wrangler
#   wrangler login                # browser auth
#   npm login                     # browser auth → npmjs.com (user: junhui20)
#   Create npm org "catlabtech" at https://www.npmjs.com/org/create (if not already)
#
# Usage:
#   bash scripts/release.sh                 # full release
#   bash scripts/release.sh --skip-deploy   # skip CF Pages, only npm publish
#   bash scripts/release.sh --skip-publish  # only deploy, no npm publish
#   bash scripts/release.sh --dry-run       # build + show what would happen
set -euo pipefail

# ─── colors ────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[34m'; N=$'\e[0m'; BOLD=$'\e[1m'
else
  R=""; G=""; Y=""; B=""; N=""; BOLD=""
fi
say()  { printf '%s▸%s %s\n' "$B" "$N" "$*"; }
ok()   { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '%s✗%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

# ─── flags ─────────────────────────────────────────────────────────────────
SKIP_DEPLOY=0
SKIP_PUBLISH=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --skip-deploy)  SKIP_DEPLOY=1 ;;
    --skip-publish) SKIP_PUBLISH=1 ;;
    --dry-run)      DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *) die "unknown flag: $arg" ;;
  esac
done

# ─── repo root ─────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
[ -f pnpm-workspace.yaml ] || die "must be run from webcvt repo root (got $REPO_ROOT)"

# ─── prerequisite checks ───────────────────────────────────────────────────
say "checking prerequisites"

command -v pnpm >/dev/null    || die "pnpm not installed"
command -v node >/dev/null    || die "node not installed"

if [ "$SKIP_DEPLOY" -eq 0 ]; then
  command -v wrangler >/dev/null || die "wrangler not installed → npm i -g wrangler"
  wrangler whoami >/dev/null 2>&1 || die "wrangler not logged in → wrangler login"
  ok "wrangler ready ($(wrangler whoami 2>&1 | grep -oE '[a-zA-Z0-9._@-]+@[a-zA-Z0-9.-]+' | head -1 || echo authenticated))"
fi

if [ "$SKIP_PUBLISH" -eq 0 ]; then
  command -v npm >/dev/null || die "npm not installed"
  NPM_USER="$(npm whoami 2>/dev/null)" || die "npm not logged in → npm login"
  ok "npm logged in as $NPM_USER"

  # check org membership (catch missing catlabtech org early — most common failure)
  if ! npm org ls catlabtech >/dev/null 2>&1; then
    die "you are not a member of npm org 'catlabtech' → create it at https://www.npmjs.com/org/create"
  fi
  ok "npm org 'catlabtech' accessible"
fi

# ─── build ─────────────────────────────────────────────────────────────────
say "building playground"
pnpm --filter @catlabtech/webcvt-playground build
[ -d apps/playground/dist ] || die "playground build did not produce dist/"
ok "playground built ($(du -sh apps/playground/dist | awk '{print $1}'))"

say "building docs"
pnpm --filter @catlabtech/webcvt-docs build
[ -d apps/docs/.vitepress/dist ] || die "docs build did not produce .vitepress/dist/"
ok "docs built ($(du -sh apps/docs/.vitepress/dist | awk '{print $1}'))"

if [ "$DRY_RUN" -eq 1 ]; then
  warn "dry-run: stopping before deploy/publish"
  exit 0
fi

# ─── deploy to Cloudflare Pages ────────────────────────────────────────────
if [ "$SKIP_DEPLOY" -eq 0 ]; then
  say "deploying playground → webcvt.pages.dev"
  wrangler pages deploy apps/playground/dist \
    --project-name=webcvt \
    --branch=main \
    --commit-dirty=true
  ok "playground deployed"

  say "deploying docs → webcvt-docs.pages.dev"
  wrangler pages deploy apps/docs/.vitepress/dist \
    --project-name=webcvt-docs \
    --branch=main \
    --commit-dirty=true
  ok "docs deployed"
else
  warn "skipping CF Pages deploy (--skip-deploy)"
fi

# ─── npm publish ───────────────────────────────────────────────────────────
if [ "$SKIP_PUBLISH" -eq 0 ]; then
  say "npm publish dry-run (preview)"
  pnpm publish -r --access public --dry-run --no-git-checks 2>&1 | tail -30

  printf '\n%s%sIRREVERSIBLE%s: this will publish all @catlabtech/webcvt-* packages to npm.\n' "$BOLD" "$R" "$N"
  printf 'You CANNOT unpublish a version after 24 hours, and a re-published version is forbidden.\n'
  printf 'Continue? [y/N] '
  read -r REPLY
  case "$REPLY" in
    y|Y|yes|YES) ;;
    *) warn "aborted by user"; exit 0 ;;
  esac

  say "publishing to npm (this takes ~2-5 min for 21 packages)"
  pnpm publish -r --access public --no-git-checks
  ok "all packages published"
else
  warn "skipping npm publish (--skip-publish)"
fi

printf '\n%s🎉 release complete%s\n' "$G" "$N"
printf '   • playground: https://webcvt.pages.dev\n'
printf '   • docs:       https://webcvt-docs.pages.dev\n'
printf '   • npm:        https://www.npmjs.com/org/catlabtech\n'

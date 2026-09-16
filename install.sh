#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
skills_dir="${CODEX_SKILLS_DIR:-${HOME}/.codex/skills}"

mkdir -p "$skills_dir"
rsync -a "$repo_dir/mapeador-de-esteiras-de-ofertas/" "$skills_dir/mapeador-de-esteiras-de-ofertas/"
rsync -a "$repo_dir/clonador-landing-pages/" "$skills_dir/clonador-landing-pages/"

printf 'Skills instaladas em %s\n' "$skills_dir"

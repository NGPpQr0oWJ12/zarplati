#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="${SERVICE_NAME:-zarplati}"
APP_USER="${APP_USER:-zarplati}"
APP_DIR="${APP_DIR:-/opt/zarplati}"
BRANCH="${BRANCH:-main}"

usage() {
  cat <<'USAGE'
Update an existing zarplati deployment.

Usage:
  sudo bash scripts/update.sh
  curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/update.sh | sudo bash

Options:
  --branch NAME       Git branch to update from. Default: main.
  --app-dir PATH      Code directory. Default: /opt/zarplati.
  --service NAME      systemd service name. Default: zarplati.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --app-dir) APP_DIR="${2:-}"; shift 2 ;;
    --service) SERVICE_NAME="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root: sudo bash scripts/update.sh" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "${APP_DIR} is not a Git checkout. Run deploy.sh first." >&2
  exit 1
fi

if ! systemctl cat "${SERVICE_NAME}.service" >/dev/null 2>&1; then
  echo "systemd service ${SERVICE_NAME}.service was not found. Run deploy.sh first." >&2
  exit 1
fi

cd "$APP_DIR"
git fetch --prune origin
git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"
npm ci
npm run build
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
systemctl restart "${SERVICE_NAME}.service"

echo "Update complete."
systemctl --no-pager --full status "${SERVICE_NAME}.service" || true

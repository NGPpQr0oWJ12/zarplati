#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="${SERVICE_NAME:-zarplati}"
APP_USER="${APP_USER:-zarplati}"
APP_HOME="${APP_HOME:-/home/${APP_USER}}"
APP_DIR="${APP_DIR:-}"
BRANCH="${BRANCH:-main}"

usage() {
  cat <<'USAGE'
Обновление уже установленного Zarplati.

Использование:
  sudo bash scripts/update.sh
  curl -fL --progress-bar https://raw.githubusercontent.com/NGPpQr0oWJ12/zarplati/main/scripts/update.sh | sudo bash

Параметры:
  --branch NAME       Ветка Git. По умолчанию: main.
  --app-home PATH     Корневая папка приложения. По умолчанию: /home/zarplati.
  --app-dir PATH      Папка кода. По умолчанию: /home/zarplati/app.
  --service NAME      Имя systemd-сервиса. По умолчанию: zarplati.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --app-home) APP_HOME="${2:-}"; shift 2 ;;
    --app-dir) APP_DIR="${2:-}"; shift 2 ;;
    --service) SERVICE_NAME="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Неизвестный параметр: $1" >&2; usage; exit 2 ;;
  esac
done

APP_DIR="${APP_DIR:-${APP_HOME}/app}"

git_app() {
  git -c "safe.directory=${APP_DIR}" -C "$APP_DIR" "$@"
}

if [[ "${EUID}" -ne 0 ]]; then
  echo "Запустите скрипт от root: sudo bash scripts/update.sh" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "${APP_DIR} не является Git-копией. Сначала запустите deploy.sh." >&2
  exit 1
fi

if ! systemctl cat "${SERVICE_NAME}.service" >/dev/null 2>&1; then
  echo "systemd-сервис ${SERVICE_NAME}.service не найден. Сначала запустите deploy.sh." >&2
  exit 1
fi

echo "Обновляется код из ветки ${BRANCH}."
git_app fetch --prune origin
git_app checkout "$BRANCH"
git_app reset --hard "origin/${BRANCH}"
cd "$APP_DIR"
echo "Устанавливаются зависимости."
if command -v g++-10 >/dev/null 2>&1 && command -v gcc-10 >/dev/null 2>&1; then
  echo "Для native-модулей используется gcc-10/g++-10 с поддержкой C++20."
  CC=gcc-10 CXX=g++-10 npm ci
else
  npm ci
fi
echo "Собираются production-файлы."
npm run build
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
echo "Перезапускается systemd-сервис ${SERVICE_NAME}."
systemctl restart "${SERVICE_NAME}.service"

echo "Обновление завершено."
systemctl --no-pager --full status "${SERVICE_NAME}.service" || true

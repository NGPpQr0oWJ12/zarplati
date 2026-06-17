#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-zarplati}"
SERVICE_NAME="${SERVICE_NAME:-zarplati}"
APP_USER="${APP_USER:-zarplati}"
APP_HOME="${APP_HOME:-/home/${APP_USER}}"
APP_DIR="${APP_DIR:-}"
STORAGE_DIR="${STORAGE_DIR:-}"
ENV_DIR="${ENV_DIR:-}"
ENV_FILE="${ENV_FILE:-}"
BRANCH="${BRANCH:-main}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-}"
MODE="${MODE:-}"
REPO_URL="${REPO_URL:-}"
ADMIN_LOGIN="${ADMIN_LOGIN:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
CURRENT_STEP="startup"

on_error() {
  local code=$?
  echo >&2
  echo "Деплой остановлен на шаге: ${CURRENT_STEP}" >&2
  echo "Код ошибки: ${code}" >&2
  exit "$code"
}

trap on_error ERR

step() {
  CURRENT_STEP="$1"
  echo
  echo "==> ${CURRENT_STEP}"
}

usage() {
  cat <<'USAGE'
Установка Zarplati на Linux-сервер с systemd.

Использование:
  sudo bash scripts/deploy.sh
  curl -fL --progress-bar https://raw.githubusercontent.com/NGPpQr0oWJ12/zarplati/main/scripts/deploy.sh | sudo bash -s -- --repo https://github.com/NGPpQr0oWJ12/zarplati.git

Параметры:
  --mode deploy          Режим установки. Сейчас поддерживается только deploy.
  --repo URL             URL публичного GitHub-репозитория.
  --branch NAME          Ветка Git. По умолчанию: main.
  --port PORT            Локальный порт приложения.
  --host HOST            Адрес прослушивания. По умолчанию: 127.0.0.1.
  --app-home PATH        Корневая папка приложения. По умолчанию: /home/zarplati.
  --app-dir PATH         Папка кода. По умолчанию: /home/zarplati/app.
  --storage-dir PATH     Папка базы и подписей. По умолчанию: /home/zarplati/data.
  --env-file PATH        dotenv-файл. По умолчанию: /home/zarplati/config/.env.
  --service NAME         Имя systemd-сервиса. По умолчанию: zarplati.
  --admin-login LOGIN    Логин администратора. Обязательный параметр.
  --admin-password PASS  Пароль администратора. Обязательный параметр.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --host) HOST="${2:-}"; shift 2 ;;
    --app-home) APP_HOME="${2:-}"; shift 2 ;;
    --app-dir) APP_DIR="${2:-}"; shift 2 ;;
    --storage-dir) STORAGE_DIR="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; ENV_DIR="$(dirname "$ENV_FILE")"; shift 2 ;;
    --service) SERVICE_NAME="${2:-}"; shift 2 ;;
    --admin-login) ADMIN_LOGIN="${2:-}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Неизвестный параметр: $1" >&2; usage; exit 2 ;;
  esac
done

APP_DIR="${APP_DIR:-${APP_HOME}/app}"
STORAGE_DIR="${STORAGE_DIR:-${APP_HOME}/data}"
ENV_DIR="${ENV_DIR:-${APP_HOME}/config}"
ENV_FILE="${ENV_FILE:-${ENV_DIR}/.env}"
ENV_DIR="$(dirname "$ENV_FILE")"

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Запустите скрипт от root: sudo bash scripts/deploy.sh" >&2
    exit 1
  fi
}

validate_port() {
  local value="$1"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
    echo "Порт должен быть целым числом от 1 до 65535." >&2
    exit 1
  fi
}

can_prompt() {
  [[ -r /dev/tty && -w /dev/tty ]]
}

prompt_if_empty() {
  local variable_name="$1"
  local prompt="$2"
  local default_value="${3:-}"
  local current_value="${!variable_name:-}"
  if [[ -n "$current_value" ]]; then
    return
  fi
  if ! can_prompt; then
    if [[ -n "$default_value" ]]; then
      printf -v "$variable_name" '%s' "$default_value"
      return
    fi
    echo "Не указано обязательное значение: ${variable_name}" >&2
    exit 1
  fi

  local answer=""
  if [[ -n "$default_value" ]]; then
    read -r -p "${prompt} [${default_value}]: " answer < /dev/tty
    printf -v "$variable_name" '%s' "${answer:-$default_value}"
  else
    read -r -p "${prompt}: " answer < /dev/tty
    printf -v "$variable_name" '%s' "$answer"
  fi
}

prompt_mode() {
  if [[ -n "$MODE" ]]; then
    return
  fi
  if ! can_prompt; then
    MODE="deploy"
    return
  fi

  local answer=""
  echo
  echo "Выберите режим установки:"
  echo "  1) deploy - установить или переустановить приложение"
  read -r -p "Введите номер или название режима [1]: " answer < /dev/tty
  case "${answer:-1}" in
    1|deploy) MODE="deploy" ;;
    *) echo "Неизвестный режим: ${answer}. Доступен только 1 или deploy." >&2; exit 1 ;;
  esac
}

prompt_password_if_empty() {
  if [[ -n "$ADMIN_PASSWORD" ]]; then
    return
  fi
  if ! can_prompt; then
    echo "Не указано обязательное значение: ADMIN_PASSWORD" >&2
    exit 1
  fi
  local answer=""
  while [[ -z "$answer" ]]; do
    read -r -s -p "Пароль администратора: " answer < /dev/tty
    echo
  done
  ADMIN_PASSWORD="$answer"
}

detect_repo_url() {
  if [[ -n "$REPO_URL" ]]; then
    return
  fi
  if [[ -d .git ]]; then
    REPO_URL="$(git config --get remote.origin.url || true)"
  fi
}

repair_ubuntu_apt_mirror() {
  local backup_suffix
  local changed=0
  local file
  local files=(/etc/apt/sources.list /etc/apt/sources.list.d/*.list)

  backup_suffix="$(date +%Y%m%d%H%M%S)"
  for file in "${files[@]}"; do
    [[ -f "$file" ]] || continue
    if grep -qE 'https?://mirror\.docker\.ru/ubuntu' "$file"; then
      cp -a "$file" "${file}.bak-${backup_suffix}"
      sed -i \
        -e 's#http://mirror.docker.ru/ubuntu#http://archive.ubuntu.com/ubuntu#g' \
        -e 's#https://mirror.docker.ru/ubuntu#http://archive.ubuntu.com/ubuntu#g' \
        "$file"
      echo "Источник apt исправлен: ${file}. Резервная копия: ${file}.bak-${backup_suffix}"
      changed=1
    fi
  done

  if [[ "$changed" -eq 1 ]]; then
    return 0
  fi
  return 1
}

apt_install_base_packages() {
  echo "Используется apt-get."
  if ! apt-get -o Acquire::Retries=3 update; then
    echo
    echo "apt-get update завершился с ошибкой. Проверяю известную проблему с mirror.docker.ru/ubuntu."
    if repair_ubuntu_apt_mirror; then
      echo "Повторяю apt-get update после замены недоступного Ubuntu mirror."
      apt-get -o Acquire::Retries=3 update
    else
      echo "Автоматически исправить apt sources не удалось." >&2
      return 1
    fi
  fi

  if DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y --fix-missing ca-certificates curl git openssl build-essential python3 make gcc-10 g++-10; then
    return
  fi

  echo
  echo "apt-get не смог скачать часть пакетов. Проверяю известную проблему с mirror.docker.ru/ubuntu."
  if repair_ubuntu_apt_mirror; then
    echo "Повторяю apt-get update/install после замены недоступного Ubuntu mirror."
    apt-get -o Acquire::Retries=3 update
    DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y --fix-missing ca-certificates curl git openssl build-essential python3 make gcc-10 g++-10
    return
  fi

  echo "Автоматически исправить apt sources не удалось." >&2
  echo "Проверьте /etc/apt/sources.list и /etc/apt/sources.list.d/*.list, затем повторите установку." >&2
  return 1
}

install_base_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    apt_install_base_packages
    return
  fi
  if command -v dnf >/dev/null 2>&1; then
    echo "Используется dnf."
    dnf install -y ca-certificates curl git openssl gcc gcc-c++ make python3
    return
  fi
  if command -v yum >/dev/null 2>&1; then
    echo "Используется yum."
    yum install -y ca-certificates curl git openssl gcc gcc-c++ make python3
    return
  fi
  if command -v pacman >/dev/null 2>&1; then
    echo "Используется pacman."
    pacman -Sy --noconfirm ca-certificates curl git openssl base-devel python
    return
  fi
  echo "Поддерживаемый пакетный менеджер не найден; установка системных пакетов пропущена."
}

node_major_version() {
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0
}

ensure_node() {
  local major
  major="$(node_major_version)"
  if (( major >= 20 )); then
    echo "Node.js $(node -v) уже установлен."
    return
  fi

  echo "Устанавливается Node.js 22.x, потому что требуется Node.js 20+."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fL --progress-bar https://deb.nodesource.com/setup_22.x | bash -
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nodejs npm
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm nodejs npm
  else
    echo "Установите Node.js 20+ и запустите скрипт повторно." >&2
    exit 1
  fi

  major="$(node_major_version)"
  if (( major < 20 )); then
    echo "Требуется Node.js 20+, найдено: $(node -v 2>/dev/null || echo не найден)." >&2
    exit 1
  fi
}

open_firewall_port() {
  local port="$1"
  local opened=0

  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi "Status: active"; then
    ufw allow "${port}/tcp"
    ufw allow "${port}/udp"
    opened=1
  fi

  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port="${port}/tcp"
    firewall-cmd --permanent --add-port="${port}/udp"
    firewall-cmd --reload
    opened=1
  fi

  if [[ "$opened" -eq 0 ]]; then
    echo "Активный ufw/firewalld не найден; правила системного firewall не изменялись."
  else
    echo "Открыт TCP- и UDP-порт ${port} в активном системном firewall."
  fi
}

create_user_and_dirs() {
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    local nologin_shell="/usr/sbin/nologin"
    if [[ ! -x "$nologin_shell" && -x "/sbin/nologin" ]]; then
      nologin_shell="/sbin/nologin"
    fi
    useradd --system --user-group --home "$APP_HOME" --create-home --shell "$nologin_shell" "$APP_USER"
  fi

  mkdir -p "$APP_HOME" "$APP_DIR" "$STORAGE_DIR" "$ENV_DIR"
  chown "$APP_USER:$APP_USER" "$APP_HOME"
  chmod 750 "$APP_HOME"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  chown -R "$APP_USER:$APP_USER" "$STORAGE_DIR"
  chown root:"$APP_USER" "$ENV_DIR"
  chmod 750 "$ENV_DIR"
  chmod 750 "$STORAGE_DIR"
  chmod 750 "$APP_DIR"
}

git_app() {
  git -c "safe.directory=${APP_DIR}" -C "$APP_DIR" "$@"
}

trust_app_checkout() {
  git config --global --add safe.directory "$APP_DIR" || true
}

checkout_code() {
  if [[ -d "$APP_DIR/.git" ]]; then
    echo "Обновляется существующая копия в ${APP_DIR}."
    trust_app_checkout
    git_app fetch --prune origin
    git_app checkout "$BRANCH"
    git_app reset --hard "origin/${BRANCH}"
  else
    if [[ -e "$APP_DIR" ]] && [[ -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      echo "${APP_DIR} уже существует и не является пустой Git-копией." >&2
      exit 1
    fi
    echo "Клонируется ${REPO_URL} в ${APP_DIR}."
    git clone --progress --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
}

install_app() {
  cd "$APP_DIR"
  echo "Устанавливаются зависимости Node через npm ci."
  if command -v g++-10 >/dev/null 2>&1 && command -v gcc-10 >/dev/null 2>&1; then
    echo "Для native-модулей используется gcc-10/g++-10 с поддержкой C++20."
    CC=gcc-10 CXX=g++-10 npm ci
  else
    npm ci
  fi
  echo "Собираются production-файлы."
  npm run build
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
}

quote_env_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/}"
  printf '"%s"' "$value"
}

write_environment() {
  echo "Записывается dotenv-конфиг в ${ENV_FILE}. Пароль в вывод не печатается."
  umask 077
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
HOST=$(quote_env_value "$HOST")
PORT=${PORT}
STORAGE_DIR=$(quote_env_value "$STORAGE_DIR")
ADMIN_LOGIN=$(quote_env_value "$ADMIN_LOGIN")
ADMIN_PASSWORD=$(quote_env_value "$ADMIN_PASSWORD")
ENV
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
}

write_service() {
  local node_bin
  node_bin="$(command -v node)"

  echo "Записывается systemd-сервис /etc/systemd/system/${SERVICE_NAME}.service."
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<SERVICE
[Unit]
Description=Zarplati payout app
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${node_bin} node_modules/tsx/dist/cli.mjs server/index.ts --production
User=${APP_USER}
Group=${APP_USER}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
LogRateLimitIntervalSec=30
LogRateLimitBurst=200
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=false
ProtectSystem=full
ReadWritePaths=${STORAGE_DIR}

[Install]
WantedBy=multi-user.target
SERVICE

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}.service"
  systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
}

main() {
  step "Запуск установки Zarplati"
  require_root
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "Скрипт деплоя поддерживает только Linux-серверы." >&2
    exit 1
  fi

  step "Чтение параметров установки"
  detect_repo_url
  prompt_mode
  if [[ "$MODE" != "deploy" ]]; then
    echo "Сейчас поддерживается только режим deploy." >&2
    exit 1
  fi
  prompt_if_empty REPO_URL "URL публичного GitHub-репозитория"
  prompt_if_empty PORT "Порт приложения" "3000"
  validate_port "$PORT"
  prompt_if_empty ADMIN_LOGIN "Логин администратора"
  prompt_password_if_empty

  step "Установка системных пакетов"
  install_base_packages
  step "Проверка Node.js"
  ensure_node
  step "Создание пользователя и папок"
  create_user_and_dirs
  step "Загрузка кода приложения"
  checkout_code
  step "Установка зависимостей и сборка"
  install_app
  step "Запись dotenv-файла"
  write_environment
  step "Установка systemd-сервиса"
  write_service
  step "Открытие порта в firewall"
  open_firewall_port "$PORT"

  step "Установка завершена"
  cat <<SUMMARY

Установка завершена.
Сервис: ${SERVICE_NAME}
Домашняя папка: ${APP_HOME}
Код: ${APP_DIR}
Данные: ${STORAGE_DIR}
Dotenv: ${ENV_FILE}
Адрес: http://${HOST}:${PORT}
Логин администратора: ${ADMIN_LOGIN}
Пароль администратора: сохранен в ${ENV_FILE}

Полезные команды:
  systemctl status ${SERVICE_NAME}
  journalctl -u ${SERVICE_NAME} -f
  systemctl restart ${SERVICE_NAME}
SUMMARY
}

main "$@"

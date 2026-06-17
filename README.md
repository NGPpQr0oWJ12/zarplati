# Выплаты

Локальное веб-приложение для создания зарплатных ведомостей, импорта сотрудников из Excel/CSV, подписи на планшете и выгрузки отчета XLSX.

## Запуск

```bash
npm install
npm run dev
```

Сервер слушает `0.0.0.0:3000`, поэтому доступен с этого компьютера и из локальной сети. После запуска в терминале будет показано:

```txt
Выплаты доступны:
- http://localhost:3000
- http://192.168.x.x:3000
```

На планшете, подключенном к той же Wi-Fi/локальной сети, откройте адрес вида `http://192.168.x.x:3000`.

Если нужен другой порт:

```bash
PORT=3001 npm run dev
```

## Вход

Логин и пароль задаются только через `.env` или переменные окружения:

```dotenv
ADMIN_LOGIN=your-admin-login
ADMIN_PASSWORD="your-strong-password"
```

Пароль с `#` нужно держать в кавычках. Для локального примера есть `.env.example`; реальный `.env` игнорируется Git.

## Формат импорта

Поддерживаются `.xlsx`, `.xls`, `.csv`. Нужны две колонки:

- `ФИО`
- `Сумма`

Пример лежит в `examples/payout-template.csv`.

## Хранение

- SQLite-база: `storage/app.db`
- Подписи: `storage/signatures/`
- Отчеты не накапливаются, а генерируются при скачивании.

## Перенос на другой сервер

В боковой панели есть блок `Перенос базы`.

- `Экспорт базы` скачивает JSON-резервную копию со всеми выплатами, строками и PNG-подписями.
- `Импорт базы` загружает такой JSON на новом сервере и заменяет текущую локальную базу вместе с подписями.

## Логи

Приложение не пишет access/request-логи в файлы и не накапливает собственные runtime-логи. В штатном режиме сервер выводит в `stdout` только адреса при запуске, а в `stderr` — только критическую ошибку запуска.

Если приложение запускается через внешний стек, который сохраняет `stdout`/`stderr` в файлы, включите ротацию на стороне этого стека: лимит 1-2 МБ на файл и 2-3 старых файла достаточно для этой локальной ведомости. Например, для PM2 используйте `pm2-logrotate` с `max_size=1M` и `retain=3`; для Docker ограничивайте `json-file` через `max-size` и `max-file`.

## Автодеплой с GitHub

Скрипты лежат в `scripts/deploy.sh` и `scripts/update.sh`. Они рассчитаны на Linux-сервер с `systemd` и публичный репозиторий [NGPpQr0oWJ12/zarplati](https://github.com/NGPpQr0oWJ12/zarplati).

Установка одной bash-командой. Копируйте команду целиком в одну строку:

```bash
curl -fL --progress-bar https://raw.githubusercontent.com/NGPpQr0oWJ12/zarplati/main/scripts/deploy.sh | sudo bash -s -- --repo https://github.com/NGPpQr0oWJ12/zarplati.git
```

В интерактивном CLI-режиме скрипт задает вопросы на русском языке. На выборе режима можно просто нажать Enter: будет выбран `1) deploy`. По умолчанию production-сервис слушает `127.0.0.1`, то есть приложение доступно только локально на сервере: `http://127.0.0.1:<порт>`.

Пример установки без вопросов, на порт `3000`. Значения логина и пароля замените на свои:

```bash
curl -fL --progress-bar https://raw.githubusercontent.com/NGPpQr0oWJ12/zarplati/main/scripts/deploy.sh | sudo bash -s -- --mode deploy --repo https://github.com/NGPpQr0oWJ12/zarplati.git --port 3000 --admin-login 'your-admin-login' --admin-password 'your-strong-password'
```

При установке скрипт:

- клонирует код в `/home/zarplati/app`;
- хранит базу и подписи в `/home/zarplati/data`;
- пишет dotenv-настройки в `/home/zarplati/config/.env`;
- создает `systemd`-сервис `zarplati`;
- ставит build-зависимости для native-модуля SQLite, включая `gcc-10`/`g++-10` на Ubuntu 20.04;
- корректно обновляет уже скачанный `/home/zarplati/app`, даже если Git включает защиту `safe.directory`;
- открывает введенный порт для TCP и UDP в активном `ufw` или `firewalld`, если такой firewall включен;
- не пишет файловые runtime-логи, сервис уходит в `journald` с rate limit.

Если установка остановилась на шаге `Установка системных пакетов` с ошибкой `mirror.docker.ru`, значит на сервере прописано недоступное Ubuntu-зеркало. Новый `deploy.sh` делает резервную копию apt source-файла, заменяет только `mirror.docker.ru/ubuntu` на `archive.ubuntu.com/ubuntu` и повторяет установку пакетов.

Обновление уже установленного сервера:

```bash
curl -fL --progress-bar https://raw.githubusercontent.com/NGPpQr0oWJ12/zarplati/main/scripts/update.sh | sudo bash
```

Если используются нестандартные путь, ветка или имя сервиса:

```bash
curl -fL --progress-bar https://raw.githubusercontent.com/NGPpQr0oWJ12/zarplati/main/scripts/update.sh | sudo bash -s -- --app-dir /home/zarplati/app --branch main --service zarplati
```

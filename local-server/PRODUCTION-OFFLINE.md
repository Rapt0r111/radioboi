# Production offline: LAN-сервер Radioboi без интернета

Документ описывает, как **собрать**, **перенести**, **запустить** и **проверить**
production-пакет для Windows-машины **без интернета** (LAN-турнир, офлайн-класс и т.п.).

Связанные файлы:

| Путь | Назначение |
|------|------------|
| `local-server/pack.ps1` | Сборка portable-пакета (нужен интернет) |
| `local-server/start.ps1` / `start.bat` | Запуск production + worker |
| `local-server/stop.ps1` / `stop.bat` | Остановка |
| `local-server/verify.ps1` / `verify.bat` | Проверка целостности и smoke |
| `local-server/allow-firewall.*` | Правила Windows Firewall |
| `scripts/start-local.ps1` | Фактический старт web + worker |

---

## 1. Архитектура offline production

На air-gapped ПК поднимается **один** процесс Node 18 (Windows 8.1 / 10 / 11):

| Слушатель | Порт (по умолчанию) | Режим | Зачем |
|-----------|---------------------|--------|--------|
| **Web** | `3000` | Статический Next export | UI, коды комнат на клиенте |
| **Worker** | `8787` | Node `lan-server.cjs` | Realtime WebSocket, игровая логика |

```text
  [игроки в LAN]
        |
        |  http://<любой-IP-сервера>:3000
        v
  +------------------+          ws://<тот-же-хост>:8787
  | Next standalone  | --------------------------------+
  | (Node, prod)     |                                 |
  +------------------+                                 v
                                          +------------------------+
                                          | Wrangler / workerd     |
                                          | GameRoom Durable Object|
                                          +------------------------+
```

Важные свойства:

1. **IP-agnostic WebSocket** — клиент берёт hostname из адресной строки браузера
   (`ws://192.168.x.x:8787` если страница открыта с этого IP). Не нужно
   прописывать IP при сборке.
2. **Без Cloudflare KV** — `createRoomAction` / `joinRoomAction` в standalone
   генерируют/принимают 6-символьный код локально; комната создаётся в Worker
   при первом WebSocket-подключении.
3. **Без системного Bun/Node/wrangler** — в `runtime\node\` лежит Node 18.20.8.
4. **Без registry** — UI и worker уже собраны; на сервере ничего не устанавливается.

---

## 2. Требования

### Машина сборки (есть интернет)

- Windows 10/11 x64
- PowerShell 5+
- [Bun](https://bun.sh) `1.3.14+` (как в `packageManager`)
- Интернет (пакет качает Node 18.20.8)
- ~1–2 GB свободного места
- Репозиторий Radioboi, зависимости установлены:

```powershell
cd C:\path\to\radioboi
bun install --frozen-lockfile
```

### Машина-сервер (без интернета)

- Windows 8.1 x64 (**build 9600**) или Windows 10/11 x64
- PowerShell 4+ (есть в Windows 8.1)
- Права на запуск `.bat` / PowerShell
- Для LAN: один раз **Администратор** для firewall
- Системные Bun/Node **не нужны**
- Браузер игроков на Win 8.1: Chrome 109 или Firefox 115 ESR
- Если `node.exe` не стартует: [KB2999226](https://support.microsoft.com/help/2999226) (Universal C Runtime). Не копируйте `ucrtbase.dll` из Windows 10 — этот файл не загрузится на 8.1.

---

## 3. Сборка offline-пакета (на машине с интернетом)

Из **корня репозитория**:

```powershell
bun run server:pack
```

Эквивалент:

```powershell
powershell -ExecutionPolicy Bypass -File local-server\pack.ps1
```

Опции:

```powershell
# Без zip (только папка offline\)
powershell -ExecutionPolicy Bypass -File local-server\pack.ps1 -SkipZip

# Другой каталог вывода
powershell -ExecutionPolicy Bypass -File local-server\pack.ps1 -OutputDir D:\share\Radioboi-LAN
```

### Что делает `pack.ps1`

1. Создаёт/очищает `local-server/offline/`
2. Скачивает **Node.js 18.20.8** (последний официальный для Windows 8.1) + DLL Universal CRT
3. Копирует monorepo в `app\` (без `node_modules`, `.git`, `.next`, …)
4. Собирает статический UI (`RADIOBOI_LAN_STATIC=1`, Chrome 109 / Firefox 115)
5. Бандлит Node-воркер `apps/worker/dist/lan-server.cjs` (без wrangler/workerd)
6. Кладёт `out/` и `lan-server.cjs` в пакет
7. Пишет `VERSION.txt`, `OFFLINE_PACKAGE`
8. Кладёт `start/stop/verify/allow-firewall` в корень пакета
9. Опционально zip → `local-server/offline-zip/Radioboi-LAN-Offline-win64-*.zip`

### Результат

```text
local-server/offline/                 ← КОПИРОВАТЬ НА СЕРВЕР ЦЕЛИКОМ
  runtime/
    bun.exe
    bunx.exe          (если был)
    node/
      node.exe
  cache/              ← Bun package cache
  app/                ← monorepo + node_modules + .next/standalone
  lib/
  start.bat / start.ps1
  stop.bat  / stop.ps1
  verify.bat / verify.ps1
  allow-firewall.bat / .ps1
  README.md
  VERSION.txt
  OFFLINE_PACKAGE

local-server/offline-zip/
  Radioboi-LAN-Offline-win64-YYYYMMDD-HHMMSS.zip
```

---

## 4. Перенос на офлайн-ПК

1. Скопируйте **всю** папку `offline\` (USB, LAN share, zip).
2. На сервере, например: `D:\Radioboi-LAN\`  
   (внутри должны быть `start.bat`, `app\`, `runtime\`, `cache\` на одном уровне).
3. **Не** копируйте только `app\` — без `runtime` и `cache` пакет не стартует.
4. После копирования **junctions** в `node_modules` указывают на старый путь —
   это нормально: `start` перепривяжет их офлайн из `cache\`.

---

## 5. Запуск production на офлайн-сервере

### 5.1. Firewall (один раз, от Администратора)

Правый клик → **Запуск от имени администратора**:

```bat
allow-firewall.bat
```

Открывает **входящий** TCP `3000` и `8787` с локальной подсети (Private profile).

Удалить правила (из monorepo):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\allow-lan-firewall.ps1 -Remove
```

### 5.2. Старт

Двойной клик:

```bat
start.bat
```

или с портами / preferred host:

```bat
start.bat 3000 8787
start.bat 3001 8788
start.bat 3000 8787 192.168.1.10
```

PowerShell (больше опций):

```powershell
cd D:\Radioboi-LAN
powershell -ExecutionPolicy Bypass -File .\start.ps1
powershell -ExecutionPolicy Bypass -File .\start.ps1 -Production
powershell -ExecutionPolicy Bypass -File .\start.ps1 -WebPort 3001 -WorkerPort 8788
powershell -ExecutionPolicy Bypass -File .\start.ps1 -ForceOfflineInstall
powershell -ExecutionPolicy Bypass -File .\start.ps1 -Dev
```

| Параметр | Смысл |
|----------|--------|
| (по умолчанию offline) | Production web, если есть standalone |
| `-Production` | Явно production |
| `-Dev` | `next dev` вместо standalone |
| `-ForceOfflineInstall` | Переустановить deps из `cache\` |
| `-SkipInstall` | Не трогать `node_modules` |
| `-ForceBuild` | Пересобрать web (долго; на офлайн-ПК обычно не нужно) |
| `-PublicHost` | Только «предпочтительный» URL в консоли |
| `-BakeWsUrl` | Устарело: зашить IP в WS (не нужно для LAN) |

### 5.3. Что происходит при старте

1. Определяется layout: `offline` (есть `app\package.json`) vs monorepo.
2. В `PATH` добавляются `runtime\` и `runtime\node\`.
3. Если путь/lockfile не совпал с маркером — `bun install --frozen-lockfile --offline`  
   (**только** workspace `node_modules`, **не** трогает `.next/standalone`).
4. Стартуют worker (wrangler) и web (Node standalone).
5. В консоли печатаются URL, например:

```text
http://192.168.1.10:3000   (preferred)
http://127.0.0.1:3000
WebSocket: same host as the page, port 8787
```

### 5.4. Игроки

1. Открыть `http://<IP-сервера>:3000` в браузере (Chrome/Edge).
2. Создать комнату или ввести код.
3. WebSocket пойдёт на `ws://<тот-же-IP>:8787` автоматически.

### 5.5. Остановка

```bat
stop.bat
```

---

## 6. Проверка пакета

### На машине сборки (сравнить с monorepo)

```powershell
bun run server:verify
# или
powershell -ExecutionPolicy Bypass -File local-server\verify.ps1
```

Проверяет:

- наличие runtime, cache, app, standalone `server.js`
- запуск `bun.exe` / `node.exe` из пакета
- **хэши ключевых файлов** vs актуальный monorepo (устаревший пакет → FAIL)

### Smoke (реальный старт HTTP)

```powershell
bun run server:verify:smoke
# или
powershell -ExecutionPolicy Bypass -File local-server\verify.ps1 -StartSmoke
```

Поднимет production, проверит HTTP на `:3000` / `:8787`, остановит стек.

### На офлайн-сервере

```bat
verify.bat
verify.bat smoke
```

Сравнение с monorepo там недоступно (нет исходников снаружи) — только структура/runtime/smoke.

---

## 7. Команды monorepo (сводка)

| Команда | Назначение |
|---------|------------|
| `bun run server:pack` | Собрать `local-server/offline/` (+ zip) |
| `bun run server:verify` | Проверить пакет vs monorepo |
| `bun run server:verify:smoke` | Проверка + live start/stop |
| `bun run server:start` | LAN start (monorepo; prod если есть build) |
| `bun run server:start:prod` | LAN start с `-Production` |
| `bun run server:stop` | Остановить |
| `bun run dev:lan:prod` | То же production LAN из `scripts/start-local.ps1` |
| `bun run lan:firewall` | Firewall (нужен Admin) |

---

## 8. Типичные проблемы

| Симптом | Причина / действие |
|---------|-------------------|
| `bun install --offline failed` | Неполный `cache\` или обрезанное копирование. Пересобрать `server:pack`, копировать **всю** `offline\`. |
| Страница есть, WebSocket нет | Firewall: `allow-firewall.bat` от Admin. Проверить, что открыт порт 8787. |
| Порт занят | `stop.bat` или `start.bat 3001 8788` |
| Долгий первый старт после USB | Норма: re-link `node_modules` (1–3 мин) |
| `standalone server missing` | Пакет собран без build / повреждён. Перепаковать. |
| `Cannot find module '@swc/helpers/...'` | Старый пакет **без** `repair-standalone`. Пересобрать `bun run server:pack` (в pack теперь materialize + hoist). В новом пакете `start` сам чинит layout при старте. |
| `Cannot find module 'esbuild'` (wrangler) | После копирования не отработал offline re-link. Удалить `app\.offline-install-ok` и снова `start.bat`, либо `start.ps1 -ForceOfflineInstall`. |
| `OUTDATED vs monorepo` в verify | Код изменился после pack. `bun run server:pack` снова. |
| Create room ок, join «не найден» | В offline join принимает любой валидный 6-символьный код; пустая комната создаётся при WS. Убедитесь, что оба игрока на **одном** worker (один сервер). |
| Нужен dev Hot Reload | `powershell -File .\start.ps1 -Dev` (медленнее, не production) |

---

## 9. Что нельзя делать

- Удалять `runtime\`, `cache\`, `app\apps\web\.next\`
- Запускать «голый» `next start` без `scripts/start-standalone.mjs` (не скопирует static/public)
- Ожидать общий lobby registry между **разными** ПК без своего бэкенда — offline = один LAN-сервер
- Собирать пакет на одной архитектуре для другой (только **Windows x64**)

---

## 10. Чеклист перед офлайн-мероприятием

- [ ] `bun install --frozen-lockfile` на машине сборки
- [ ] `bun run server:pack` без ошибок
- [ ] `bun run server:verify` — 0 failures
- [ ] `bun run server:verify:smoke` — web + worker OK, `production=true`
- [ ] Zip/папка скопированы **целиком**
- [ ] На сервере: `verify.bat` OK
- [ ] `allow-firewall.bat` (Admin)
- [ ] `start.bat` → страница с телефона/ноута в той же Wi‑Fi/LAN
- [ ] Два браузера: create + join, WebSocket connected
- [ ] `stop.bat` после мероприятия

---

## 11. Размер и обновление

- Типичный размер: **~0.8–1.5 GB** (зависит от lockfile / workerd).
- Любое изменение game-логики / UI / worker → **полная пересборка** `server:pack` и повторное копирование на сервер.
- `VERSION.txt` внутри пакета — дата сборки и версии Bun/Node.

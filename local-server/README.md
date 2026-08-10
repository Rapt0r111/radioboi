# Локальный / offline production LAN-сервер Radioboi

Папка для запуска игры как сервера в локальной сети, в том числе на машине
**без интернета**, в режиме **production** (Next standalone + wrangler worker).

**Полная инструкция:** [PRODUCTION-OFFLINE.md](./PRODUCTION-OFFLINE.md)

---

## Как получить переносимый пакет

На машине **с интернетом** (Windows x64, Bun + Node):

```powershell
# из корня репозитория
bun install --frozen-lockfile
bun run server:pack
```

или:

```powershell
cd local-server
powershell -ExecutionPolicy Bypass -File .\pack.ps1
```

Опции `pack.ps1`:

```powershell
.\pack.ps1 -SkipZip                 # не создавать zip
.\pack.ps1 -OutputDir D:\share\LAN  # другой каталог вывода
```

### Что получится

```text
local-server/offline/                 ← КОПИРОВАТЬ НА СЕРВЕР ЦЕЛИКОМ
  runtime/bun.exe
  runtime/node/node.exe
  cache/                              ← кэш Bun (офлайн install)
  app/                                ← исходники + node_modules + production build
  start.bat / stop.bat / verify.bat
  allow-firewall.bat
  README.md
  VERSION.txt

local-server/offline-zip/
  Radioboi-LAN-Offline-win64-*.zip
```

На целевом сервере **не нужны** Bun/Node в системе и **не нужен интернет**.

Размер пакета обычно порядка **1 GB**.

---

## Запуск на сервере без интернета

1. Скопируйте папку `offline\` (или распакуйте zip), например `D:\Radioboi-LAN\`.
2. (Рекомендуется) `verify.bat`
3. **Один раз** от администратора: `allow-firewall.bat`
4. `start.bat`
   - После копирования на новый путь Bun **перепривяжет** workspace `node_modules`
     из `cache\` (без сети). Первый раз 1–3 минуты.
   - **Не** удаляется production standalone (`.next/standalone`).
   - Web = **production**, worker = wrangler local.
5. Откройте `http://192.168.x.x:3000`
6. Остановка: `stop.bat`

### IP-адреса

- Слушает `0.0.0.0` (все интерфейсы).
- WebSocket = **тот же хост**, что в браузере + порт `8787`.
- DHCP / несколько сетевых карт — без ручной настройки IP.

### Порты

```bat
start.bat
start.bat 3000 8787
start.bat 3001 8788
```

### Проверка

```bat
verify.bat
verify.bat smoke
```

Из monorepo:

```powershell
bun run server:verify
bun run server:verify:smoke
```

---

## Режим monorepo (разработка / есть интернет)

```powershell
bun run server:start
# production web:
bun run server:start:prod
# или
bun run dev:lan
local-server\start.bat
```

---

## Почему так устроено

| Проблема | Решение в пакете |
|----------|------------------|
| На сервере нет Bun/Node | `runtime\` внутри пакета |
| Нет интернета для registry | `cache\` + `bun install --offline` |
| Junctions ломаются после копирования | При старте re-link только workspace `node_modules` |
| Нельзя сносить standalone `node_modules` | Install-OfflineDeps не трогает `.next/**` |
| Разные IP в LAN | WS от hostname страницы, bind `0.0.0.0` |
| Нет Cloudflare KV | create/join без KV; DO создаётся по WS |
| Нужен production, не dev | `pack.ps1` кладёт standalone; start его использует |

---

## Файлы

| Файл | Назначение |
|------|------------|
| `pack.ps1` | Собрать offline-пакет (нужен интернет) |
| `start.bat` / `start.ps1` | Запуск LAN production |
| `stop.bat` / `stop.ps1` | Остановка |
| `verify.bat` / `verify.ps1` | Целостность + optional smoke |
| `allow-firewall.bat` / `.ps1` | Порты 3000/8787 (Admin) |
| `lib\*` | monorepo/offline paths + offline install |
| `PRODUCTION-OFFLINE.md` | Подробная инструкция |

`local-server/offline/` и `offline-zip/` в git **не** коммитятся.

---

## Типичные проблемы

| Симптом | Что делать |
|---------|------------|
| `bun install --offline failed` | Пересоберите пакет (`pack.ps1`); копируйте `offline` целиком |
| `Cannot find module '@swc/helpers/...'` | Старый zip без repair-standalone. Пересоберите: `bun run server:pack` |
| `Cannot find module 'esbuild'` (worker) | `start.ps1 -ForceOfflineInstall` (re-link после копирования) |
| Страница есть, игра не коннектится | `allow-firewall.bat` от Admin |
| Порт занят | `stop.bat` или другие порты |
| Долгий первый старт | Нормально: offline re-link после смены пути |
| verify: OUTDATED | `bun run server:pack` заново |
| Принудительный reinstall deps | `powershell -File .\start.ps1 -ForceOfflineInstall` |

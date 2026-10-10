# claude anon — инкогнито-режим для Claude Code

Режим «как приватное окно браузера»: Claude работает без знания о пользователе,
не оставляет следов на диске и глушит телеметрию, а клиент визуально
перекрашивается в фиолетовый, пока режим активен.

## Что отключено

1. **Чистый контекст** — Claude не видит auto-memory/MEMORY.md, CLAUDE.md, историю
   подсказок и не берёт её из пер-ходовых вложений памяти; строка включённой сессии
   снимается из `history.jsonl`, todos-файлы и file-history снапшоты удаляются при
   выходе.
2. **Не сохранять сессию** — транскрипт удаляется при выходе (и при хард-килле —
   дочищивается на следующем старте по манифесту).
3. **Не писать память** — Write/Edit под каталогом сессий движка отказаны.
4. **Без телеметрии** — DISABLE_TELEMETRY, DISABLE_ERROR_REPORTING,
   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC.

## Как включить

Мод ставится плагином в обычный клиент Claude Code и работает прямо в нём —
ничего отдельно запускать не нужно. Команда `/anon [on|off]` или **Shift+Tab**
(биндинг ниже). Контекст, уже загруженный к моменту включения, остаётся (об
этом честно говорит полоса — `context loaded before going anon`, а первое
включение с загруженным личным контекстом предложит очистить беседу); всё, что
движок собрал бы после включения, не уходит: секции памяти системного промпта
срезаются, пер-ходовые вложения памяти (реколл, ре-инъекция CLAUDE.md/
MEMORY.md, team-контекст) глушатся, в новой беседе (после `/clear`)
персональные блоки первого хода вырезаются — полоса покажет `memory
unloaded`. Сессия, где `/anon` хоть раз включали, не сохраняется даже после
off (sticky).

Первое включение идёт через диалог согласия (аналог WARNING
`dangerously-skip-permissions`): что произойдёт, что не возвращается назад и
`No (default)` / `Yes, I accept`. Согласие запоминается между сессиями, диалог
больше не повторяется; Esc — отклонение, ничего не включается.

## Установка

```bash
claude plugin marketplace add eveiljuice/claude-anon
claude plugin install anon-mode@claude-anon
```

Те же два шага доступны изнутри запущенной сессии: `/plugin marketplace add eveiljuice/claude-anon`,
затем `/plugin install anon-mode@claude-anon`.

Из локальной копии (для разработки — правки мода подхватываются без
переустановки):

```bash
claude plugin marketplace add <путь к этому каталогу>
claude plugin install anon-mode@claude-anon
```

### Shift+Tab (опционально)

Плагины регистрируют команду `/anon`, но не клавиши. Чтобы Shift+Tab
переключал режим (и не съедал родной цикл permission-режимов — тот переехал
на `meta+m`), добавьте в `~/.claude/keybindings.json` (создайте файл, если нет):

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "$docs": "https://code.claude.com/docs/en/keybindings",
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "shift+tab": "command:anon",
        "meta+m": "chat:cycleMode"
      }
    }
  ]
}
```

Биндинг действует во всех сессиях, где плагин установлен и включён. Если
отключили плагин — Shift+Tab даст `Unknown command: /anon`: уберите биндинг
или верните `shift+tab` на `chat:cycleMode`.

## Статус и лицензия

Экспериментальный мод. Лицензия — [MIT](LICENSE).

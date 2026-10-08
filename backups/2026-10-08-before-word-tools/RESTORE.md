# Backup before "Word-like tools" in the meeting-minutes editor (2026-10-08)

The user asked to keep a backup in case the new editor is not liked. To go back to the previous editor:

| Backup file | Restore to |
|---|---|
| `rich-editor.tsx` | `apps/web/src/app/(app)/meetings/_components/rich-editor.tsx` |
| `html.ts` | `apps/api/src/modules/meetings/html.ts` |
| `globals.css` | `apps/web/src/app/globals.css` |
| `web-package.json` | `apps/web/package.json` (then `npm install`) |

PowerShell (run in `pas-platform`):

```
Copy-Item backups/2026-10-08-before-word-tools/rich-editor.tsx "apps/web/src/app/(app)/meetings/_components/rich-editor.tsx"
Copy-Item backups/2026-10-08-before-word-tools/html.ts apps/api/src/modules/meetings/html.ts
Copy-Item backups/2026-10-08-before-word-tools/globals.css apps/web/src/app/globals.css
Copy-Item backups/2026-10-08-before-word-tools/web-package.json apps/web/package.json
npm install
```

Minutes already saved with the new formatting stay readable after a restore: the old filter simply drops the
extra styling (alignment, colour, size) when a minute is saved again; text is never lost.

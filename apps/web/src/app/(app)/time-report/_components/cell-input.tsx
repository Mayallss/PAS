'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { hours, parseDuration } from '@/lib/format';
import type { Entry, Policy } from '@/lib/types';

export function validateMinutes(minutes: number, policy: Policy): string | null {
  if (Number.isNaN(minutes)) return 'อ่านค่าเวลาไม่ออก — พิมพ์เช่น 2, 2.5, 2:30 หรือ 90m';
  if (minutes <= 0) return 'เวลาต้องมากกว่า 0';
  if (minutes % policy.incrementMinutes !== 0) return `บันทึกได้ครั้งละ ${policy.incrementMinutes / 60} ชม. (${policy.incrementMinutes} นาที)`;
  if (minutes > policy.maxEntryMinutes) return `รายการเดียวต้องไม่เกิน ${policy.maxEntryMinutes / 60} ชม.`;
  return null;
}

/** Moves focus inside the grid. Cells carry data-cell="row:col". */
export function focusCell(scope: string, row: number, col: number) {
  const el = document.querySelector<HTMLInputElement>(`[data-scope="${scope}"][data-cell="${row}:${col}"]`);
  el?.focus();
}

interface Props {
  scope: string;
  row: number;
  col: number;
  entry: Entry | undefined;
  policy: Policy;
  readOnly: boolean;
  label: string;
  className?: string;
  onCommit: (minutes: number | null) => void;
  onFocusCell?: () => void;
}

/**
 * Spreadsheet-style cell: type hours and move on. Saves on blur/Enter, Esc reverts.
 * ↑↓ move between tasks, ←→ between days (when the caret is at the edge), Enter = save and go down.
 */
export const CellInput = memo(function CellInput({ scope, row, col, entry, policy, readOnly, label, className = '', onCommit, onFocusCell }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  // Guards against double commit: keyboard navigation commits, then the resulting blur would commit again.
  const editing = useRef(false);
  const current = entry && !entry.deleted ? entry.durationMinutes : 0;
  const value = draft ?? hours(current);

  // After a commit the draft keeps showing the new value until the cache catches up (no one-frame flash).
  useEffect(() => {
    if (!editing.current) setDraft(null);
  }, [current]);

  function commit() {
    if (!editing.current || draft === null) return;
    editing.current = false;
    setDraft(null);
    const minutes = parseDuration(draft);
    if (minutes === null) {
      if (current) {
        setDraft('');
        onCommit(null);
      }
      return;
    }
    if (minutes === current) return;
    const error = validateMinutes(minutes, policy);
    if (error) {
      toast.error(error);
      return;
    }
    setDraft(hours(minutes));
    onCommit(minutes);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length;
    const allSelected = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    const move = (r: number, c: number) => {
      e.preventDefault();
      commit();
      focusCell(scope, r, c);
    };
    if (e.key === 'Enter') move(row + (e.shiftKey ? -1 : 1), col);
    else if (e.key === 'ArrowDown') move(row + 1, col);
    else if (e.key === 'ArrowUp') move(row - 1, col);
    else if (e.key === 'ArrowRight' && (atEnd || allSelected)) move(row, col + 1);
    else if (e.key === 'ArrowLeft' && (atStart || allSelected)) move(row, col - 1);
    else if (e.key === 'Escape') {
      editing.current = false;
      setDraft(null);
      el.blur();
    }
  }

  const hasNote = !!entry?.description && !entry.deleted;
  return (
    <div className="relative">
      <input
        data-scope={scope}
        data-cell={`${row}:${col}`}
        aria-label={label}
        inputMode="decimal"
        autoComplete="off"
        readOnly={readOnly}
        value={value}
        placeholder={readOnly ? '' : '·'}
        onFocus={(e) => {
          if (!readOnly) {
            editing.current = true;
            setDraft(hours(current));
          }
          onFocusCell?.();
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => {
          // Typing always counts as editing — focus may have stayed in this cell after a previous Enter.
          editing.current = true;
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={`h-11 w-full rounded-md bg-transparent text-center text-[15px] tabular-nums outline-none placeholder:text-gray-300 focus:bg-white focus:ring-2 focus:ring-brand-600 ${
          current ? 'font-semibold text-gray-900' : 'text-gray-500'
        } ${entry?.pending ? 'animate-pulse text-brand-700' : ''} ${readOnly ? 'cursor-default' : 'hover:bg-gray-100/70'} ${className}`}
      />
      {hasNote && <span className="pointer-events-none absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-sky-500" aria-hidden />}
    </div>
  );
});

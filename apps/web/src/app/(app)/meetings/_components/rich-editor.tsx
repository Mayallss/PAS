'use client';

import { Highlight } from '@tiptap/extension-highlight';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Columns3,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Rows3,
  Strikethrough,
  Subscript as SubIcon,
  Superscript as SupIcon,
  Table2,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LINE_SPACINGS, ParagraphFormat } from './paragraph-format';

/**
 * Rich-text editor for meeting minutes (replaces the legacy CKEditor), with Word-style tools: paragraph styles,
 * font size, colour, highlight, alignment, line spacing, indent, sub/superscript, tables. Output is HTML; the API
 * sanitises it with an allow-list (fixed style values only), so the editor is a convenience, not a trust boundary.
 * Previous version: backups/2026-10-08-before-word-tools.
 */

const STYLES = [
  { key: 'p', label: 'ข้อความปกติ' },
  { key: 'h2', label: 'หัวเรื่อง 1' },
  { key: 'h3', label: 'หัวเรื่อง 2 (วาระ)' },
  { key: 'h4', label: 'หัวเรื่อง 3' },
] as const;
const SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'];
const TEXT_COLORS = ['#111827', '#6b7280', '#b91c1c', '#c2410c', '#a16207', '#15803d', '#0e7490', '#1d4ed8', '#2e3192', '#7e22ce'];
const HIGHLIGHTS = ['#fef08a', '#bbf7d0', '#bae6fd', '#fbcfe8', '#fed7aa', '#e5e7eb'];

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
function countWords(text: string) {
  if (!segmenter) return text.split(/\s+/).filter(Boolean).length;
  let n = 0;
  for (const s of segmenter.segment(text)) if (s.isWordLike) n++;
  return n;
}

export default function RichEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const [full, setFull] = useState(false);
  const editor = useEditor({
    immediatelyRender: false, // avoid SSR hydration mismatch
    shouldRerenderOnTransaction: true, // keep toolbar active-states in sync (documents are small)
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false, autolink: true, protocols: ['https', 'http', 'mailto'] } }),
      TableKit.configure({ table: { resizable: false } }),
      TextStyle,
      Color,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
      Subscript,
      Superscript,
      ParagraphFormat,
      Placeholder.configure({ placeholder: 'พิมพ์สรุปการประชุม… (Tab = ย่อหน้า, Ctrl+B ตัวหนา, Ctrl+Z เลิกทำ)' }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { class: 'minutes px-5 py-4', 'aria-label': 'เนื้อหารายงานการประชุม' } },
  });

  // Esc leaves full-screen.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  if (!editor) return <div className="skeleton h-[380px] rounded-xl" />;
  const text = editor.getText();
  return (
    <div
      className={`minutes-editor flex flex-col overflow-hidden bg-white ${
        full ? 'fixed inset-0 z-50' : 'rounded-xl shadow-card ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-brand-500'
      }`}
    >
      <Toolbar editor={editor} full={full} onFull={() => setFull((f) => !f)} />
      <div className={full ? 'flex-1 overflow-y-auto bg-gray-100 py-6' : ''}>
        <div className={full ? 'mx-auto max-w-[52rem] rounded-sm bg-white shadow-card' : ''}>
          <EditorContent editor={editor} />
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/80 px-3 py-1 text-[11.5px] text-gray-500">
        <span>
          {countWords(text).toLocaleString('th-TH')} คำ · {text.length.toLocaleString('th-TH')} ตัวอักษร
        </span>
        <span className="hidden sm:inline">Tab ย่อหน้า · Shift+Tab ถอย · Ctrl+B/I/U · Ctrl+Z/Y{full ? ' · Esc ออกจากเต็มจอ' : ''}</span>
      </div>
    </div>
  );
}

function Btn({ active = false, label, onClick, Icon, disabled = false }: { active?: boolean; label: string; onClick: () => void; Icon: typeof Bold; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the text selection
      onClick={onClick}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition ${active ? 'bg-brand-100 text-brand-700' : 'text-gray-600 hover:bg-gray-100'} disabled:opacity-30`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-gray-200" />;

/** Small native select that keeps the editor selection (applies on change, then refocuses). */
function Pick({ label, value, options, onPick, width }: { label: string; value: string; options: { value: string; label: string }[]; onPick: (v: string) => void; width: string }) {
  return (
    <select
      title={label}
      aria-label={label}
      value={value}
      onChange={(e) => onPick(e.target.value)}
      className={`h-8 shrink-0 rounded-md border-0 bg-transparent py-0 pr-7 pl-2 text-[12.5px] text-gray-700 ring-1 ring-gray-200 ring-inset hover:bg-white focus:ring-2 focus:ring-brand-500 ${width}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Colour button with a swatch popover (text colour / highlight). */
function Swatches({ label, Icon, current, colors, onPick, onClear, clearLabel }: { label: string; Icon: typeof Bold; current: string | null; colors: string[]; onPick: (c: string) => void; onClear: () => void; clearLabel: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-0.5 rounded-md px-1.5 text-gray-600 hover:bg-gray-100"
      >
        <span className="relative">
          <Icon className="h-4 w-4" />
          <span className="absolute inset-x-0 -bottom-1 h-1 rounded-sm" style={{ background: current ?? 'transparent', outline: current ? undefined : '1px solid #d1d5db' }} />
        </span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute top-9 left-0 z-20 w-44 rounded-lg bg-white p-2 shadow-pop ring-1 ring-gray-200">
          <div className="grid grid-cols-5 gap-1.5">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                aria-label={c}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
                className={`h-6 w-6 rounded ring-1 ring-black/10 ${current === c ? 'ring-2 ring-brand-600' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="mt-2 w-full rounded-md px-2 py-1 text-left text-[12px] text-gray-600 hover:bg-gray-100"
          >
            {clearLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function Toolbar({ editor, full, onFull }: { editor: Editor; full: boolean; onFull: () => void }) {
  const c = () => editor.chain().focus();
  const inTable = editor.isActive('table');
  const style = editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : editor.isActive('heading', { level: 4 }) ? 'h4' : 'p';
  const size = (editor.getAttributes('textStyle').fontSize as string | undefined) ?? '';
  const spacing = (editor.getAttributes('paragraph').lineSpacing as string | null) ?? (editor.getAttributes('heading').lineSpacing as string | null) ?? '';
  const color = (editor.getAttributes('textStyle').color as string | undefined) ?? null;
  const mark = (editor.getAttributes('highlight').color as string | undefined) ?? null;
  const align = (['center', 'right', 'justify'] as const).find((a) => editor.isActive({ textAlign: a })) ?? 'left';

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('ลิงก์ (https://…) — เว้นว่างเพื่อลบลิงก์', prev ?? 'https://');
    if (url === null) return;
    if (!url.trim()) c().unsetLink().run();
    else if (/^(https?:\/\/|mailto:)/.test(url.trim())) c().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  return (
    <div className="border-b border-gray-100 bg-gray-50/80" role="toolbar" aria-label="จัดรูปแบบ">
      {/* Row 1 — like Word's Home tab: style, font, character formatting */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 pt-1.5 pb-1">
        <Pick
          label="ลักษณะย่อหน้า"
          width="w-36"
          value={style}
          options={STYLES.map((s) => ({ value: s.key, label: s.label }))}
          onPick={(v) => (v === 'p' ? c().setParagraph().run() : c().setHeading({ level: Number(v.slice(1)) as 2 | 3 | 4 }).run())}
        />
        <Pick
          label="ขนาดตัวอักษร"
          width="w-[5.5rem]"
          value={size}
          options={[{ value: '', label: 'ขนาด' }, ...SIZES.map((s) => ({ value: s, label: s.replace('px', '') }))]}
          onPick={(v) => (v ? c().setFontSize(v).run() : c().unsetFontSize().run())}
        />
        <Sep />
        <Btn active={editor.isActive('bold')} label="ตัวหนา (Ctrl+B)" onClick={() => c().toggleBold().run()} Icon={Bold} />
        <Btn active={editor.isActive('italic')} label="ตัวเอียง (Ctrl+I)" onClick={() => c().toggleItalic().run()} Icon={Italic} />
        <Btn active={editor.isActive('underline')} label="ขีดเส้นใต้ (Ctrl+U)" onClick={() => c().toggleUnderline().run()} Icon={Underline} />
        <Btn active={editor.isActive('strike')} label="ขีดฆ่า" onClick={() => c().toggleStrike().run()} Icon={Strikethrough} />
        <Btn active={editor.isActive('subscript')} label="ตัวห้อย" onClick={() => c().toggleSubscript().run()} Icon={SubIcon} />
        <Btn active={editor.isActive('superscript')} label="ตัวยก" onClick={() => c().toggleSuperscript().run()} Icon={SupIcon} />
        <Swatches label="สีตัวอักษร" Icon={Baseline} current={color} colors={TEXT_COLORS} onPick={(v) => c().setColor(v).run()} onClear={() => c().unsetColor().run()} clearLabel="สีอัตโนมัติ" />
        <Swatches label="ไฮไลต์" Icon={Highlighter} current={mark} colors={HIGHLIGHTS} onPick={(v) => c().setHighlight({ color: v }).run()} onClear={() => c().unsetHighlight().run()} clearLabel="ไม่มีไฮไลต์" />
        <Btn label="ล้างรูปแบบ" onClick={() => c().unsetAllMarks().clearNodes().run()} Icon={RemoveFormatting} />
        <Btn active={editor.isActive('link')} label="ลิงก์" onClick={setLink} Icon={Link2} />
        <span className="ml-auto flex">
          <Btn label="เลิกทำ (Ctrl+Z)" onClick={() => c().undo().run()} Icon={Undo2} disabled={!editor.can().undo()} />
          <Btn label="ทำซ้ำ (Ctrl+Y)" onClick={() => c().redo().run()} Icon={Redo2} disabled={!editor.can().redo()} />
          <Btn active={full} label={full ? 'ออกจากเต็มจอ (Esc)' : 'เขียนแบบเต็มจอ'} onClick={onFull} Icon={full ? Minimize2 : Maximize2} />
        </span>
      </div>
      {/* Row 2 — paragraph: alignment, spacing, lists, indent, insert */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 pb-1.5">
        <Btn active={align === 'left'} label="ชิดซ้าย" onClick={() => c().setTextAlign('left').run()} Icon={AlignLeft} />
        <Btn active={align === 'center'} label="กึ่งกลาง" onClick={() => c().setTextAlign('center').run()} Icon={AlignCenter} />
        <Btn active={align === 'right'} label="ชิดขวา" onClick={() => c().setTextAlign('right').run()} Icon={AlignRight} />
        <Btn active={align === 'justify'} label="กระจายเต็มบรรทัด" onClick={() => c().setTextAlign('justify').run()} Icon={AlignJustify} />
        <Pick
          label="ระยะห่างบรรทัด"
          width="w-[6.5rem]"
          value={spacing}
          options={[{ value: '', label: 'ระยะบรรทัด' }, ...LINE_SPACINGS.map((s) => ({ value: s, label: `${s} เท่า` }))]}
          onPick={(v) => c().setLineSpacing(v || null).run()}
        />
        <Sep />
        <Btn active={editor.isActive('bulletList')} label="รายการจุด" onClick={() => c().toggleBulletList().run()} Icon={List} />
        <Btn active={editor.isActive('orderedList')} label="รายการตัวเลข" onClick={() => c().toggleOrderedList().run()} Icon={ListOrdered} />
        <Btn label="ลดย่อหน้า (Shift+Tab)" onClick={() => c().outdent().run()} Icon={IndentDecrease} />
        <Btn label="เพิ่มย่อหน้า (Tab)" onClick={() => c().indent().run()} Icon={IndentIncrease} />
        <Sep />
        <Btn active={editor.isActive('blockquote')} label="ข้อความอ้างอิง" onClick={() => c().toggleBlockquote().run()} Icon={Quote} />
        <Btn label="เส้นคั่น" onClick={() => c().setHorizontalRule().run()} Icon={Minus} />
        <Btn label="แทรกตาราง 3×3" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} Icon={Table2} disabled={inTable} />
        {inTable && (
          <>
            <Sep />
            <span className="px-1 text-[11.5px] text-gray-400">ตาราง:</span>
            <Btn label="เพิ่มแถวด้านล่าง" onClick={() => c().addRowAfter().run()} Icon={Rows3} />
            <Btn label="เพิ่มคอลัมน์ทางขวา" onClick={() => c().addColumnAfter().run()} Icon={Columns3} />
            <Btn label="ลบแถว" onClick={() => c().deleteRow().run()} Icon={Minus} />
            <Btn label="ลบคอลัมน์" onClick={() => c().deleteColumn().run()} Icon={Minus} />
            <Btn label="รวมเซลล์" onClick={() => c().mergeCells().run()} Icon={TableCellsMerge} disabled={!editor.can().mergeCells()} />
            <Btn label="แยกเซลล์" onClick={() => c().splitCell().run()} Icon={TableCellsSplit} disabled={!editor.can().splitCell()} />
            <Btn label="ลบตาราง" onClick={() => c().deleteTable().run()} Icon={Trash2} />
          </>
        )}
      </div>
    </div>
  );
}

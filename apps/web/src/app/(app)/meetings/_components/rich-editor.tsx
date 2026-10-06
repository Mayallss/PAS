'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { Bold, Heading3, Italic, Link2, List, ListOrdered, Quote, Redo2, Rows3, Table2, Trash2, Underline, Undo2 } from 'lucide-react';

/**
 * Rich-text editor for meeting minutes (replaces the legacy CKEditor).
 * Output is HTML; the API sanitises it with an allow-list, so the editor is a convenience, not a trust boundary.
 */
export default function RichEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    immediatelyRender: false, // avoid SSR hydration mismatch
    shouldRerenderOnTransaction: true, // keep toolbar active-states in sync (documents are small)
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false, autolink: true, protocols: ['https', 'http', 'mailto'] } }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: 'พิมพ์สรุปการประชุม… (หัวข้อวาระ รายการ ตาราง ใช้ปุ่มด้านบน)' }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { class: 'minutes px-5 py-4', 'aria-label': 'เนื้อหารายงานการประชุม' } },
  });
  if (!editor) return <div className="skeleton h-[380px] rounded-xl" />;
  const state = {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    h3: editor.isActive('heading', { level: 3 }),
    bullet: editor.isActive('bulletList'),
    ordered: editor.isActive('orderedList'),
    quote: editor.isActive('blockquote'),
    link: editor.isActive('link'),
    table: editor.isActive('table'),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };

  const btn = (active: boolean, label: string, onClick: () => void, Icon: typeof Bold, disabled = false) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the text selection
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-md transition ${active ? 'bg-brand-100 text-brand-700' : 'text-gray-600 hover:bg-gray-100'} disabled:opacity-30`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
  const c = () => editor.chain().focus();
  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('ลิงก์ (https://…) — เว้นว่างเพื่อลบลิงก์', prev ?? 'https://');
    if (url === null) return;
    if (!url.trim()) c().unsetLink().run();
    else if (/^(https?:\/\/|mailto:)/.test(url.trim())) c().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  return (
    <div className="minutes-editor overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-brand-500">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-100 bg-gray-50/80 px-2 py-1.5" role="toolbar" aria-label="จัดรูปแบบ">
        {btn(state.h3, 'หัวข้อวาระ', () => c().toggleHeading({ level: 3 }).run(), Heading3)}
        <span className="mx-1 h-5 w-px bg-gray-200" />
        {btn(state.bold, 'ตัวหนา', () => c().toggleBold().run(), Bold)}
        {btn(state.italic, 'ตัวเอียง', () => c().toggleItalic().run(), Italic)}
        {btn(state.underline, 'ขีดเส้นใต้', () => c().toggleUnderline().run(), Underline)}
        {btn(state.link, 'ลิงก์', setLink, Link2)}
        <span className="mx-1 h-5 w-px bg-gray-200" />
        {btn(state.bullet, 'รายการจุด', () => c().toggleBulletList().run(), List)}
        {btn(state.ordered, 'รายการตัวเลข', () => c().toggleOrderedList().run(), ListOrdered)}
        {btn(state.quote, 'ข้อความอ้างอิง', () => c().toggleBlockquote().run(), Quote)}
        <span className="mx-1 h-5 w-px bg-gray-200" />
        {btn(false, 'แทรกตาราง', () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), Table2, state.table)}
        {state.table && btn(false, 'เพิ่มแถว', () => c().addRowAfter().run(), Rows3)}
        {state.table && btn(false, 'ลบตาราง', () => c().deleteTable().run(), Trash2)}
        <span className="ml-auto flex">
          {btn(false, 'เลิกทำ', () => c().undo().run(), Undo2, !state.canUndo)}
          {btn(false, 'ทำซ้ำ', () => c().redo().run(), Redo2, !state.canRedo)}
        </span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

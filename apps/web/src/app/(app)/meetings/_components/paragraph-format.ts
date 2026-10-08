import { type CommandProps, Extension } from '@tiptap/core';

/**
 * Word-style paragraph formatting for headings and paragraphs: indent (Tab / Shift+Tab, 2em steps) and line spacing.
 * Rendered as inline `margin-left` / `line-height`, which the API's sanitiser allows only with fixed value patterns.
 */
export const LINE_SPACINGS = ['1', '1.15', '1.5', '2', '2.5', '3'] as const;
const MAX_INDENT = 8;
const TYPES = ['paragraph', 'heading'];

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
      setLineSpacing: (value: string | null) => ReturnType;
    };
  }
}

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  // Below lists and tables so their own Tab handling (nest list item, next cell) wins.
  priority: 50,

  addGlobalAttributes() {
    return [
      {
        types: TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => {
              const m = /^(\d+)em$/.exec(el.style.marginLeft || '');
              return m ? Math.min(MAX_INDENT, Math.round(Number(m[1]) / 2)) : 0;
            },
            renderHTML: (attrs) => (attrs.indent ? { style: `margin-left: ${attrs.indent * 2}em` } : {}),
          },
          lineSpacing: {
            default: null,
            parseHTML: (el) => (LINE_SPACINGS as readonly string[]).includes(el.style.lineHeight) ? el.style.lineHeight : null,
            renderHTML: (attrs) => (attrs.lineSpacing ? { style: `line-height: ${attrs.lineSpacing}` } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    const step =
      (delta: number) =>
      () =>
      ({ editor, chain, tr, state, dispatch }: CommandProps) => {
        if (editor.isActive('listItem')) return delta > 0 ? chain().sinkListItem('listItem').run() : chain().liftListItem('listItem').run();
        let changed = false;
        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
          if (!TYPES.includes(node.type.name)) return;
          const next = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent ?? 0) + delta));
          if (next !== node.attrs.indent) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
            changed = true;
          }
        });
        return changed && !!dispatch;
      };
    return {
      indent: step(1),
      outdent: step(-1),
      setLineSpacing:
        (value) =>
        ({ commands }) =>
          TYPES.map((t) => commands.updateAttributes(t, { lineSpacing: value })).some(Boolean),
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => (this.editor.isActive('table') ? false : this.editor.commands.indent()),
      'Shift-Tab': () => (this.editor.isActive('table') ? false : this.editor.commands.outdent()),
    };
  },
});

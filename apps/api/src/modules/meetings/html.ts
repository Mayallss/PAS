import { diffArrays } from 'diff';
import sanitize from 'sanitize-html';

/**
 * Rich text for meeting minutes. Allow-list only: formatting, lists, tables, safe links.
 * Everything else (scripts, event handlers, styles, iframes, images with remote src) is stripped.
 */
const OPTIONS: sanitize.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'span', 'ins', 'del'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    ins: ['class'],
    del: ['class'],
  },
  allowedSchemes: ['https', 'http', 'mailto'],
  allowedClasses: { ins: ['diff-ins'], del: ['diff-del'] },
  transformTags: {
    a: sanitize.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
    // Legacy CKEditor markup
    font: 'span',
    center: 'p',
  },
};

export function sanitizeRichText(html: string): string {
  return sanitize(html, OPTIONS).trim();
}

/** Plain text of minutes, whitespace-normalised — used to verify that an objection quotes real content. */
export function htmlToText(html: string): string {
  return normalize(sanitize(html.replace(/<\/(p|li|h[2-4]|tr|td|th|blockquote)>|<br\s*\/?>/gi, ' $& '), { allowedTags: [], allowedAttributes: {} }));
}

export function normalize(text: string): string {
  return text.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Word-level HTML diff (Thai-aware)
// ---------------------------------------------------------------------------

const segmenter = new Intl.Segmenter('th', { granularity: 'word' });

/** Tags stay whole; text is split into words (Thai has no spaces, so the ICU word segmenter is used). */
function tokenize(html: string): string[] {
  const tokens: string[] = [];
  for (const part of html.split(/(<[^>]+>)/g)) {
    if (!part) continue;
    if (part.startsWith('<')) tokens.push(part);
    else for (const s of segmenter.segment(part)) tokens.push(s.segment);
  }
  return tokens;
}

const isTag = (t: string) => t.startsWith('<');

/**
 * Returns the NEW version's HTML with additions wrapped in <ins class="diff-ins"> and removed words shown
 * as <del class="diff-del"> at the place they were removed. Structure (tags) always follows the new version,
 * so the result is well-formed; the output is sanitised again before it is returned.
 */
export function diffHtml(oldHtml: string, newHtml: string): { html: string; added: number; removed: number } {
  const parts = diffArrays(tokenize(oldHtml), tokenize(newHtml));
  let out = '';
  let added = 0;
  let removed = 0;
  const wrap = (tokens: string[], tag: 'ins' | 'del') => {
    // Tags pass through (only from the new version); consecutive text runs are wrapped once.
    let run = '';
    const flush = () => {
      // Keep surrounding whitespace outside the highlight so marks hug the words.
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(run)!;
      out += m[2] ? `${m[1]}<${tag} class="diff-${tag}">${m[2]}</${tag}>${m[3]}` : run;
      run = '';
    };
    for (const t of tokens) {
      if (isTag(t)) {
        flush();
        if (tag === 'ins') out += t;
      } else run += t;
    }
    flush();
  };
  for (const p of parts) {
    if (p.added) {
      added += p.value.filter((t) => !isTag(t) && t.trim()).length;
      wrap(p.value, 'ins');
    } else if (p.removed) {
      removed += p.value.filter((t) => !isTag(t) && t.trim()).length;
      wrap(p.value, 'del');
    } else out += p.value.join('');
  }
  return { html: sanitizeRichText(out), added, removed };
}

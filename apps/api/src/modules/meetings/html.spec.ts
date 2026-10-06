import { diffHtml, htmlToText, sanitizeRichText } from './html';

describe('sanitizeRichText', () => {
  it('keeps formatting, lists and tables', () => {
    const html = '<h3>วาระ</h3><ol><li><strong>ปิดงบ</strong></li></ol><table><tbody><tr><td colspan="2">A</td></tr></tbody></table>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it('strips scripts, event handlers, styles, iframes and javascript: links', () => {
    const out = sanitizeRichText(
      '<p onclick="x()" style="color:red">ok<script>alert(1)</script></p><img src=x onerror=alert(1)><iframe src="//evil"></iframe><a href="javascript:alert(1)">l</a>',
    );
    expect(out).not.toMatch(/script|onclick|onerror|style=|iframe|javascript:|<img/i);
    expect(out).toContain('ok');
  });

  it('forces safe link attributes', () => {
    expect(sanitizeRichText('<a href="https://pas-acc.com">x</a>')).toBe('<a href="https://pas-acc.com" target="_blank" rel="noopener noreferrer nofollow">x</a>');
  });
});

describe('htmlToText', () => {
  it('flattens blocks with spaces and normalises whitespace', () => {
    expect(htmlToText('<p>ข้อ 1</p><p>ข้อ&nbsp;2</p><ul><li>ก</li><li>ข</li></ul>')).toBe('ข้อ 1 ข้อ 2 ก ข');
  });
});

describe('diffHtml', () => {
  it('highlights only the changed Thai words, not the whole sentence', () => {
    const d = diffHtml('<p>ที่ประชุมมีมติให้ปิดงบภายในไตรมาส</p>', '<p>ที่ประชุมมีมติให้ปิดงบภายในเดือนหน้า</p>');
    expect(d.html).toBe('<p>ที่ประชุมมีมติให้ปิดงบภายใน<del class="diff-del">ไตรมาส</del><ins class="diff-ins">เดือนหน้า</ins></p>');
    expect(d.added).toBeGreaterThan(0);
    expect(d.removed).toBe(1);
  });

  it('marks a newly added paragraph as inserted and keeps the markup well-formed', () => {
    const d = diffHtml('<p>ข้อ 1</p>', '<p>ข้อ 1</p><p>ข้อ 2 ใหม่</p>');
    expect(d.html).toBe('<p>ข้อ 1</p><p><ins class="diff-ins">ข้อ 2 ใหม่</ins></p>');
    expect(d.removed).toBe(0);
  });

  it('shows removed text inline as deleted', () => {
    const d = diffHtml('<p>A B C</p>', '<p>A C</p>');
    expect(d.html).toContain('<del class="diff-del">B</del>');
  });

  it('cannot be used to smuggle markup through the diff', () => {
    const d = diffHtml('<p>x</p>', '<p>x</p><p><img src=x onerror=alert(1)>y</p>');
    expect(d.html).not.toMatch(/onerror|<img/);
  });

  it('reports no change for identical content', () => {
    expect(diffHtml('<p>same</p>', '<p>same</p>')).toEqual({ html: '<p>same</p>', added: 0, removed: 0 });
  });
});

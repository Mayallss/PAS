/** Fades/slides children in as they scroll into view (pure CSS, see .reveal in globals.css). `i` staggers siblings. */
export function Reveal({
  children,
  i = 0,
  className = '',
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  i?: number;
  className?: string;
  as?: 'div' | 'li' | 'section' | 'article' | 'figure';
}) {
  return (
    <Tag className={`reveal ${className}`} style={{ '--i': i } as React.CSSProperties}>
      {children}
    </Tag>
  );
}

import { useEffect, useState } from 'react';

// Shared helpers for the rich-text fields (Task/Defect description, QA
// feedback comments, Peer Review comments, Resolution) - these are
// stored as sanitized HTML (see backend/src/common/sanitize-rich-text.ts,
// the actual security boundary; useSanitizedHtml below is a client-side
// defense-in-depth pass, not a replacement for that).

const ALLOWED_TAGS = ['p', 'strong', 'em', 'u', 'h2', 'ul', 'ol', 'li', 'br'];

// Plain-text preview for every compact context that was never meant to
// render markup - table cells, `title` tooltip attributes, and
// line-clamped previews (Task Backlog, My Tasks, QA Review queue, Team
// Tasks, Escalations, Peer Review queue). A raw HTML tag showing up
// mid-tooltip or getting cut off mid-tag by a CSS clamp looks broken, so
// these contexts always get plain text, never the rendered markup.
export function stripHtmlForPreview(value) {
  if (!value) return '';
  return value
    .replace(/<\/(p|li|h2)>|<br\s*\/?>/gi, '$& ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Sanitizes rich-text HTML for use in dangerouslySetInnerHTML, for the
// full read views (task detail page's description/resolution/comment
// blocks). DOMPurify only works in a real browser (it needs `window`),
// so it's imported dynamically inside an effect rather than at module
// top level - safe to import this file from anywhere, including a page
// that also renders during Next.js's server/build pass, without
// crashing that pass.
export function useSanitizedHtml(value) {
  const [safeHtml, setSafeHtml] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setSafeHtml('');
      return;
    }
    import('dompurify').then(({ default: DOMPurify }) => {
      if (cancelled) return;
      setSafeHtml(DOMPurify.sanitize(value, { ALLOWED_TAGS, ALLOWED_ATTR: ['style'] }));
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return safeHtml;
}

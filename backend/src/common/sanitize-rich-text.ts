import sanitizeHtml from 'sanitize-html';

// Shared sanitizer for every rich-text field the app stores (Task/Defect
// description, QA feedback comment, Peer Review comment, Resolution) -
// the toolbar (frontend/components/ui/RichTextEditor.js) only ever
// produces this exact set of tags/attributes, so anything outside this
// allowlist can only have arrived by someone bypassing the editor UI and
// calling the API directly. Applied server-side regardless of what the
// client sent, since the client-side editor is not a security boundary.
const ALLOWED_TAGS = ['p', 'strong', 'em', 'u', 'h2', 'ul', 'ol', 'li', 'br'];

export function sanitizeRichText(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      p: ['style'],
      h2: ['style'],
      ul: ['style'],
      ol: ['style'],
      li: ['style'],
    },
    // Only text-align is ever produced by the toolbar's alignment
    // buttons - no other inline style is allowed through.
    allowedStyles: {
      '*': {
        'text-align': [/^(left|center|right|justify)$/],
      },
    },
    // Empty <p></p>/<h2></h2> left behind by editing are harmless, but
    // strip any tag sanitize-html would otherwise leave as bare text
    // content (e.g. a disallowed <script> tag's body).
    disallowedTagsMode: 'discard',
  }).trim();
}

// Plain-text preview for contexts that were never meant to render markup
// at all - table cells, tooltips (`title` attributes), truncated/clamped
// previews, and notification emails. Inserts a space at each block
// boundary before stripping tags, so "<p>A</p><p>B</p>" reads as "A B",
// not "AB" (sanitize-html's tag removal alone doesn't add one back).
export function richTextToPlainText(value: string): string {
  const withBoundarySpaces = value.replace(/<\/(p|li|h2)>|<br\s*\/?>/gi, '$& ');
  return sanitizeHtml(withBoundarySpaces, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

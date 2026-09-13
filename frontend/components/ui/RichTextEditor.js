import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Heading2,
} from 'lucide-react';
import styles from './RichTextEditor.module.css';

function ToolbarButton({ onClick, active, label, children }) {
  return (
    <button
      type="button"
      className={`${styles.toolbarButton} ${active ? styles.toolbarButtonActive : ''}`}
      // Without this, clicking a toolbar button blurs the editor first,
      // losing the text selection the button was supposed to act on.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
    </button>
  );
}

// Replaces a plain <textarea> for Task/Defect description, QA feedback
// comments, Peer Review comments, and Resolution - stores/emits an HTML
// string (via onChange) instead of plain text. The toolbar only ever
// produces bold/italic/underline, left/center/right alignment, bullet/
// numbered lists, and one "heading" (H2) style - matching exactly what
// backend/src/common/sanitize-rich-text.ts allows through server-side;
// nothing else is reachable from this UI.
//
// `required` isn't enforced natively (this isn't a real form control the
// browser can validate) - callers should check the emitted HTML
// themselves (e.g. via lib/richText.js's stripHtmlForPreview) before
// submitting, the same way several forms already validate other fields
// manually rather than relying solely on the `required` attribute.
export default function RichTextEditor({ value, onChange, placeholder, id }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2] } }),
      Underline,
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
      Placeholder.configure({ placeholder: placeholder || '' }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: styles.editorContent, id },
    },
    // Next.js renders this on the server first render; TipTap's own DOM
    // measurement warns/mismatches unless this is explicitly disabled -
    // same reasoning react-quill needs `ssr: false` for.
    immediatelyRender: false,
  });

  // Keeps the editor in sync when `value` changes from outside (loading
  // an existing item's saved content once it arrives, or a Cancel button
  // resetting the form) - never fires during normal typing, since the
  // editor's own onUpdate already keeps `value` equal to editor.getHTML()
  // at that point.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = value || '';
    if (next !== current) {
      editor.commands.setContent(next, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar} role="toolbar" aria-label="Text formatting">
        <ToolbarButton
          label="Bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <BoldIcon size={15} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <ItalicIcon size={15} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon size={15} aria-hidden="true" />
        </ToolbarButton>
        <span className={styles.divider} aria-hidden="true" />
        <ToolbarButton
          label="Align left"
          active={editor.isActive({ textAlign: 'left' })}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
        >
          <AlignLeft size={15} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Align center"
          active={editor.isActive({ textAlign: 'center' })}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
        >
          <AlignCenter size={15} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Align right"
          active={editor.isActive({ textAlign: 'right' })}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
        >
          <AlignRight size={15} aria-hidden="true" />
        </ToolbarButton>
        <span className={styles.divider} aria-hidden="true" />
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={15} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={15} aria-hidden="true" />
        </ToolbarButton>
        <span className={styles.divider} aria-hidden="true" />
        <ToolbarButton
          label="Section heading"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={15} aria-hidden="true" />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

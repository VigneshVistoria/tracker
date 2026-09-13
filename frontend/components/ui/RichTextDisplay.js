import { useSanitizedHtml } from '../../lib/richText';
import styles from './RichTextDisplay.module.css';

// Renders a stored rich-text HTML value (Task/Defect description, QA
// feedback comment, Peer Review comment, Resolution) for the full read
// views - never used for compact/clamped previews or tooltips, see
// lib/richText.js's stripHtmlForPreview for those.
export default function RichTextDisplay({ value, className = '' }) {
  const safeHtml = useSanitizedHtml(value);
  if (!value) return null;
  return <div className={`${styles.content} ${className}`} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}

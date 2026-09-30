import { formatDate } from './formatDate';

// Admin/PM-defined custom fields on test cases - mirrors CustomFieldType
// in backend/src/test-cases/test-case-custom-field.entity.ts. Values are
// stored on the test case keyed by field id (TestCase.customFields).
export const FIELD_TYPE = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  DROPDOWN: 'Dropdown',
};

export const FIELD_TYPE_OPTIONS = [FIELD_TYPE.TEXT, FIELD_TYPE.NUMBER, FIELD_TYPE.DATE, FIELD_TYPE.DROPDOWN];

export function formatCustomFieldValue(field, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (field.fieldType === FIELD_TYPE.DATE) return formatDate(value);
  if (field.fieldType === FIELD_TYPE.NUMBER) return Number(value).toLocaleString('en-US');
  return String(value);
}

// Strips the "data:...;base64," prefix FileReader.readAsDataURL adds -
// the backend expects raw base64 only (same as pages/admin/issues-bulk.js).
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

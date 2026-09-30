import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppShell from '../../../components/AppShell';
import styles from '../../../styles/issues.module.css';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../lib/toast';
import { FIELD_TYPE, FIELD_TYPE_OPTIONS } from '../../../lib/testCaseFields';

const EMPTY_FIELD = { name: '', fieldType: FIELD_TYPE.TEXT, optionsText: '', isRequired: false };

// One option per line - options may contain commas, so a comma-separated
// input would be ambiguous.
function parseOptions(text) {
  return text.split('\n').map((o) => o.trim()).filter(Boolean);
}

// Admin/Program Manager-only catalog of custom fields on test cases
// (backend TestCaseCustomFieldsController). A field's name is also the
// column header bulk import matches on.
export default function TestCaseFieldsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [fields, setFields] = useState([]);
  const [newField, setNewField] = useState(EMPTY_FIELD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () =>
    apiFetch('/test-case-custom-fields')
      .then(setFields)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    const role = JSON.parse(storedUser).role;
    if (role !== 'admin' && role !== 'program_manager') {
      router.replace('/qa/test-cases');
      return;
    }
    load();
  }, [router]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/test-case-custom-fields', {
        method: 'POST',
        body: JSON.stringify({
          name: newField.name,
          fieldType: newField.fieldType,
          options: newField.fieldType === FIELD_TYPE.DROPDOWN ? parseOptions(newField.optionsText) : undefined,
          isRequired: newField.isRequired,
          sortOrder: fields.length === 0 ? 0 : Math.max(...fields.map((f) => f.sortOrder)) + 1,
        }),
      });
      setNewField(EMPTY_FIELD);
      showToast('Field added', 'success');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpdate = async (id, changes) => {
    setError('');
    try {
      await apiFetch(`/test-case-custom-fields/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });
      showToast('Field updated', 'success');
    } catch (err) {
      setError(err.message);
    }
    load();
  };

  const handleToggleActive = async (field) => {
    setError('');
    try {
      await apiFetch(`/test-case-custom-fields/${field.id}/${field.isActive ? 'deactivate' : 'activate'}`, { method: 'PATCH' });
      showToast(field.isActive ? 'Field deactivated' : 'Field activated', 'info');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (field) => {
    if (!confirm(`Delete "${field.name}"? This cannot be undone.`)) return;
    setError('');
    try {
      await apiFetch(`/test-case-custom-fields/${field.id}`, { method: 'DELETE' });
      showToast('Field deleted', 'info');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Test Case Fields</h1>
          <p className={styles.pageSubtitle}>
            Extra fields for test cases, shown on the test case form and imported from the spreadsheet column with the same name.
            A field's type can't be changed after it's created. Deactivate a field to hide it without losing saved values; a
            field can only be deleted while no test case uses it. Every change is audit-logged.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Link href="/admin/labels" className={styles.buttonSecondary}>Manage Labels</Link>
          <Link href="/qa/test-cases" className={styles.buttonSecondary}>Back to Test Cases</Link>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {loading && <div className={styles.empty}>Loading...</div>}

      {!loading && (
        <div className={styles.card}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Name (= import column)</th>
                  <th>Type</th>
                  <th>Dropdown Options</th>
                  <th>Required</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {fields.length === 0 && (
                  <tr>
                    <td colSpan={7} className={styles.empty}>No custom fields yet - add one below.</td>
                  </tr>
                )}
                {fields.map((field) => (
                  <tr key={`${field.id}-${field.updatedAt}`}>
                    <td style={{ width: 80 }}>
                      <input
                        className={styles.input}
                        type="number"
                        aria-label={`Display order for ${field.name}`}
                        defaultValue={field.sortOrder}
                        onBlur={(e) => Number(e.target.value) !== field.sortOrder && handleUpdate(field.id, { sortOrder: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        className={styles.input}
                        aria-label={`Name of ${field.name}`}
                        defaultValue={field.name}
                        onBlur={(e) => e.target.value.trim() !== field.name && handleUpdate(field.id, { name: e.target.value })}
                      />
                    </td>
                    <td>{field.fieldType}</td>
                    <td>
                      {field.fieldType === FIELD_TYPE.DROPDOWN ? (
                        <textarea
                          className={styles.textarea}
                          aria-label={`Options for ${field.name}, one per line`}
                          rows={Math.min(6, Math.max(2, field.options.length))}
                          defaultValue={field.options.join('\n')}
                          onBlur={(e) => {
                            const options = parseOptions(e.target.value);
                            if (options.join('\n') !== field.options.join('\n')) handleUpdate(field.id, { options });
                          }}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${field.name} is required`}
                        checked={field.isRequired}
                        onChange={(e) => handleUpdate(field.id, { isRequired: e.target.checked })}
                      />
                    </td>
                    <td>
                      <span className={`${styles.badge} ${field.isActive ? styles.badgeQa : styles.badgeOpen}`}>
                        {field.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button className={styles.buttonSecondary} type="button" onClick={() => handleToggleActive(field)}>
                          {field.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button className={styles.buttonSecondary} type="button" onClick={() => handleDelete(field)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.helpText}>
            Making a field required applies to new test cases and imports. Existing test cases without a value are asked for one
            the next time they're edited.
          </p>

          <h2 style={{ fontSize: '1rem', marginTop: 'var(--space-5)' }}>Add a field</h2>
          <form onSubmit={handleAdd}>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className={styles.field} style={{ margin: 0, flex: '1 1 220px' }}>
                <label className={styles.label} htmlFor="newFieldName">Name</label>
                <input
                  className={styles.input}
                  id="newFieldName"
                  required
                  maxLength={60}
                  placeholder="e.g. Browser, Environment, Test Type"
                  value={newField.name}
                  onChange={(e) => setNewField({ ...newField, name: e.target.value })}
                />
              </div>
              <div className={styles.field} style={{ margin: 0, flex: '0 1 180px' }}>
                <label className={styles.label} htmlFor="newFieldType">Type</label>
                <select
                  className={styles.select}
                  id="newFieldType"
                  value={newField.fieldType}
                  onChange={(e) => setNewField({ ...newField, fieldType: e.target.value })}
                >
                  {FIELD_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={newField.isRequired}
                  onChange={(e) => setNewField({ ...newField, isRequired: e.target.checked })}
                />
                Required
              </label>
            </div>
            {newField.fieldType === FIELD_TYPE.DROPDOWN && (
              <div className={styles.field} style={{ marginTop: 'var(--space-3)' }}>
                <label className={styles.label} htmlFor="newFieldOptions">Options (one per line)</label>
                <textarea
                  className={styles.textarea}
                  id="newFieldOptions"
                  required
                  placeholder={'Chrome\nFirefox\nSafari'}
                  value={newField.optionsText}
                  onChange={(e) => setNewField({ ...newField, optionsText: e.target.value })}
                />
              </div>
            )}
            <div className={styles.actions}>
              <button className={`${styles.button} ${styles.buttonAccent}`} type="submit">Add Field</button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}

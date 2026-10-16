import { useEffect, useId, useState } from 'react';
import styles from '../../styles/projectTimeline.module.css';

// Searchable project list for Project Timeline. A keyboard-operable
// combobox (arrow keys, Enter, Escape) - SearchSelectField is mouse-only,
// and this page has to meet STYLE.md's keyboard rule. Typing only filters;
// a project is chosen only by picking a real option.
export default function ProjectPicker({ projects, value, onChange }) {
  const id = useId();
  const listId = `${id}-list`;
  const selected = projects.find((p) => p.id === value) || null;
  const [query, setQuery] = useState(selected ? selected.name : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setQuery(selected ? selected.name : '');
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const typed = query.trim().toLowerCase();
  const filtered = typed && !(selected && selected.name.toLowerCase() === typed)
    ? projects.filter((p) => p.name.toLowerCase().includes(typed))
    : projects;

  const choose = (p) => {
    setOpen(false);
    setQuery(p.name);
    if (p.id !== value) onChange(p.id);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && filtered[active]) {
      e.preventDefault();
      choose(filtered[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery(selected ? selected.name : '');
    }
  };

  return (
    <div className={styles.picker}>
      <label className={styles.label} htmlFor={id}>
        Project
      </label>
      <input
        id={id}
        className={styles.input}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${filtered[active].id}` : undefined}
        autoComplete="off"
        placeholder="Type to search projects"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => {
          setOpen(false);
          setQuery(selected ? selected.name : '');
        }, 150)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listId} role="listbox" className={styles.listbox} aria-label="Projects">
          {filtered.length === 0 && <li className={styles.option}>No project matches “{query}”</li>}
          {filtered.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${p.id}`}
              role="option"
              aria-selected={p.id === value}
              className={`${styles.option} ${i === active ? styles.optionActive : ''}`}
              onMouseDown={() => choose(p)}
              onMouseEnter={() => setActive(i)}
            >
              <span>{p.name}</span>
              <span className={styles.optionMeta}>{p.rowCount ? `${p.rowCount} rows` : 'No plan yet'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

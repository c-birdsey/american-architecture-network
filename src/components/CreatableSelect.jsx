import { useEffect, useRef, useState } from "react";

// Hints for LastPass/1Password/Bitwarden/Dashlane/Proton Pass to leave
// this search field alone -- it's not a login, but password managers
// often misidentify plain text inputs and clutter them with icons.
const NO_AUTOFILL = {
  autoComplete: "off",
  "data-lpignore": "true",
  "data-1p-ignore": "true",
  "data-bwignore": "true",
  "data-protonpass-ignore": "true",
  "data-form-type": "other",
};

/**
 * A searchable, optionally-multi-select, optionally-creatable dropdown.
 * Ported from the archive app's component of the same name -- same
 * props, same chip/menu behavior.
 *
 * options: [{ value, label }]
 * selected: array of values currently chosen (used for both single and multi)
 * multiple: allow more than one selection
 * allowCreate: show an "Add '<query>'" option when the typed text doesn't
 *   match anything existing
 */
export default function CreatableSelect({
  options,
  selected,
  onChange,
  multiple = false,
  allowCreate = false,
  placeholder = "Search…",
  renderLabel = (value, label) => label,
  dropUp = false,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selectedSet = new Set(selected);
  const q = query.trim().toLowerCase();

  const filtered = options.filter(
    (o) => !selectedSet.has(o.value) && o.label.toLowerCase().includes(q)
  );

  const exactExists = options.some((o) => o.label.toLowerCase() === q);
  const showCreate = allowCreate && q.length > 0 && !exactExists;

  function choose(value) {
    if (multiple) {
      if (!selectedSet.has(value)) onChange([...selected, value]);
    } else {
      onChange([value]);
      setOpen(false);
    }
    setQuery("");
  }

  function remove(value) {
    onChange(selected.filter((v) => v !== value));
  }

  const selectedLabels = selected.map(
    (v) => options.find((o) => o.value === v)?.label ?? v
  );

  return (
    <div className="creatable" ref={wrapRef}>
      <div className="creatable-chips">
        {selected.map((v, i) => (
          <span className="chip" key={v}>
            {renderLabel(v, selectedLabels[i])}
            <button type="button" onClick={() => remove(v)} aria-label={`Remove ${selectedLabels[i]}`}>
              &times;
            </button>
          </span>
        ))}
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && showCreate) {
              e.preventDefault();
              choose(query.trim());
            }
          }}
          {...NO_AUTOFILL}
        />
      </div>

      {open && q.length > 0 && (filtered.length > 0 || showCreate) && (
        <div className={dropUp ? "creatable-menu creatable-menu-up" : "creatable-menu"}>
          {filtered.map((o) => (
            <button
              type="button"
              key={o.value}
              className="creatable-option"
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o.value);
              }}
            >
              {o.label}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              className="creatable-option creatable-new"
              onMouseDown={(e) => {
                e.preventDefault();
                choose(query.trim());
              }}
            >
              Add “{query.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { EditableFieldType } from "./lead-detail-shared";

type LeadInlineFieldProps = {
  label: string;
  value: string;
  editable?: boolean;
  isEditing?: boolean;
  type?: EditableFieldType;
  selectOptions?: string[];
  placeholder?: string;
  deferCommit?: boolean;
  onActivateEdit?: () => void;
  onChange?: (value: string) => void;
  onFinishEdit?: () => void;
  onCancelEdit?: () => void;
};

export function LeadInlineField({
  label,
  value,
  editable = false,
  isEditing = false,
  type = "input",
  selectOptions = [],
  placeholder,
  deferCommit = false,
  onActivateEdit,
  onChange,
  onFinishEdit,
  onCancelEdit,
}: LeadInlineFieldProps) {
  const displayValue = value?.trim() ? value : "-";
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    if (isEditing) {
      setDraftValue(value);
    }
  }, [isEditing, value]);

  const cancelEdit = () => {
    setDraftValue(value);
    onCancelEdit?.();
  };

  const commitEdit = () => {
    if (deferCommit) {
      onChange?.(draftValue);
    }
    onFinishEdit?.();
  };

  const currentValue = deferCommit ? draftValue : value;
  const updateValue = (next: string) => {
    if (deferCommit) {
      setDraftValue(next);
      return;
    }
    onChange?.(next);
  };

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        isEditing
          ? "border-slate-500/70 bg-slate-900/75 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)]"
          : "border-border/80 bg-slate-950/40"
      } ${editable && !isEditing ? "cursor-pointer transition hover:border-slate-600/80 hover:bg-slate-900/70" : ""}`}
      onClick={() => {
        if (editable && !isEditing) onActivateEdit?.();
      }}
      role={editable && !isEditing ? "button" : undefined}
      tabIndex={editable && !isEditing ? 0 : -1}
      onKeyDown={(event) => {
        if (editable && !isEditing && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onActivateEdit?.();
        }
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.09em] text-muted">{label}</p>
      </div>

      {editable && isEditing ? (
        type === "textarea" ? (
          <textarea
            className="field mt-1.5 min-h-16 px-2.5 py-1.5 text-sm"
            value={currentValue}
            placeholder={placeholder}
            onChange={(event) => updateValue(event.target.value)}
            onBlur={commitEdit}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEdit();
              }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                commitEdit();
              }
            }}
          />
        ) : type === "select" ? (
          <select
            className="field mt-1.5 h-9 px-2.5 py-1.5 text-sm"
            value={currentValue}
            onChange={(event) => {
              const next = event.target.value;
              if (deferCommit) {
                setDraftValue(next);
                onChange?.(next);
              } else {
                onChange?.(next);
              }
              onFinishEdit?.();
            }}
            onBlur={() => {
              if (!deferCommit) onFinishEdit?.();
            }}
          >
            {selectOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : type === "date" ? (
          <input
            className="field mt-1.5 h-9 px-2.5 py-1.5 text-sm"
            type="date"
            value={currentValue}
            onChange={(event) => updateValue(event.target.value)}
            onBlur={commitEdit}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEdit();
              }
              if (event.key === "Enter") {
                event.preventDefault();
                commitEdit();
              }
            }}
          />
        ) : (
          <input
            className="field mt-1.5 h-9 px-2.5 py-1.5 text-sm"
            value={currentValue}
            placeholder={placeholder}
            onChange={(event) => updateValue(event.target.value)}
            onBlur={commitEdit}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEdit();
              }
              if (event.key === "Enter") {
                event.preventDefault();
                commitEdit();
              }
            }}
          />
        )
      ) : (
        <p className="mt-1.5 text-sm text-slate-100">{displayValue}</p>
      )}
    </div>
  );
}

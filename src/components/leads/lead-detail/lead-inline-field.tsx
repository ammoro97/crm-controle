import { EditableFieldType } from "./lead-detail-shared";

type LeadInlineFieldProps = {
  label: string;
  value: string;
  editable?: boolean;
  isEditing?: boolean;
  type?: EditableFieldType;
  selectOptions?: string[];
  placeholder?: string;
  onActivateEdit?: () => void;
  onChange?: (value: string) => void;
};

export function LeadInlineField({
  label,
  value,
  editable = false,
  isEditing = false,
  type = "input",
  selectOptions = [],
  placeholder,
  onActivateEdit,
  onChange,
}: LeadInlineFieldProps) {
  const displayValue = value?.trim() ? value : "-";

  return (
    <div
      className={`rounded-lg border border-border/80 bg-slate-950/40 px-3 py-2.5 ${editable && !isEditing ? "cursor-pointer transition hover:border-slate-600/80 hover:bg-slate-900/70" : ""}`}
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
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange?.(event.target.value)}
          />
        ) : type === "select" ? (
          <select className="field mt-1.5 h-9 px-2.5 py-1.5 text-sm" value={value} onChange={(event) => onChange?.(event.target.value)}>
            {selectOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : type === "date" ? (
          <input className="field mt-1.5 h-9 px-2.5 py-1.5 text-sm" type="date" value={value} onChange={(event) => onChange?.(event.target.value)} />
        ) : (
          <input
            className="field mt-1.5 h-9 px-2.5 py-1.5 text-sm"
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange?.(event.target.value)}
          />
        )
      ) : (
        <p className="mt-1.5 text-sm text-slate-100">{displayValue}</p>
      )}
    </div>
  );
}

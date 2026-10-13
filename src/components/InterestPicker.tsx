import type { Interest } from "../../shared/types.ts";
import { INTEREST_ICON } from "../lib/icons.ts";
import { capitalize } from "../lib/format.ts";
import Icon from "./Icon.tsx";

export default function InterestPicker({
  options,
  value,
  onChange,
  label = "Intereses",
}: {
  options: Interest[];
  value: Interest[];
  onChange: (v: Interest[]) => void;
  label?: string;
}) {
  const toggle = (i: Interest) => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i]);
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((i) => (
        <button
          type="button"
          key={i}
          className={`chip ${value.includes(i) ? "on" : ""}`}
          aria-pressed={value.includes(i)}
          onClick={() => toggle(i)}
        >
          <Icon name={INTEREST_ICON[i] ?? "sparkles"} size={16} />
          {capitalize(i)}
        </button>
      ))}
    </div>
  );
}

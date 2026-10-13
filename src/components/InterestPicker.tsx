import type { Interest } from "../../shared/types.ts";
import { INTEREST_EMOJI } from "../lib/format.ts";

export default function InterestPicker({
  options,
  value,
  onChange,
}: {
  options: Interest[];
  value: Interest[];
  onChange: (v: Interest[]) => void;
}) {
  const toggle = (i: Interest) => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i]);
  return (
    <div className="chips" role="group" aria-label="Intereses">
      {options.map((i) => (
        <button
          type="button"
          key={i}
          className={`chip ${value.includes(i) ? "on" : ""}`}
          aria-pressed={value.includes(i)}
          onClick={() => toggle(i)}
        >
          <span aria-hidden>{INTEREST_EMOJI[i]}</span> {i}
        </button>
      ))}
    </div>
  );
}

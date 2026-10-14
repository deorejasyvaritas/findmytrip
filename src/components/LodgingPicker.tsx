import type { Style } from "../../shared/types.ts";
import Segmented from "./Segmented.tsx";

// Económico / Confort / Premium se refiere al alojamiento (y con él, al nivel de gastos diarios).
// Lo decimos con todas las letras: solo, "Confort" no se entendía.
export const LODGING_HINT: Record<Style, string> = {
  low: "Hostel, posada u hotel de 2 a 3 estrellas",
  mid: "Hotel de 3 a 4 estrellas o depto completo",
  high: "Hotel de 4 a 5 estrellas o boutique",
};

export default function LodgingPicker({ value, onChange, hint = true }: { value: Style; onChange: (s: Style) => void; hint?: boolean }) {
  return (
    <div className="lodging-picker">
      <span className="lodging-label" aria-hidden="true">
        Alojamiento
      </span>
      <Segmented
        label="Tipo de alojamiento"
        value={value}
        onChange={onChange}
        options={[
          { value: "low", label: "Económico" },
          { value: "mid", label: "Confort" },
          { value: "high", label: "Premium" },
        ]}
      />
      {hint && <span className="lodging-hint">{LODGING_HINT[value]}</span>}
    </div>
  );
}

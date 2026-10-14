import type { MealPlan, Style } from "../../shared/types.ts";
import { MealPlanSelect } from "./HotelBadges.tsx";
import Segmented from "./Segmented.tsx";

// Económico / Confort / Premium se refiere al alojamiento (y con él, al nivel de gastos diarios).
// Lo decimos con todas las letras: solo, "Confort" no se entendía.
export const LODGING_HINT: Record<Style, string> = {
  low: "Hostel, posada u hotel de 2 a 3 estrellas",
  mid: "Hotel de 3 a 4 estrellas o depto completo",
  high: "Hotel de 4 a 5 estrellas o boutique",
};

const AI_HINT: Record<Style, string> = {
  low: "Resort all inclusive de 3 estrellas",
  mid: "Resort all inclusive de 4 estrellas",
  high: "Resort all inclusive de 5 estrellas",
};

export default function LodgingPicker({
  value,
  onChange,
  hint = true,
  mealPlan,
  onMealPlan,
}: {
  value: Style;
  onChange: (s: Style) => void;
  hint?: boolean;
  /** Régimen (solo alojamiento, desayuno, media pensión, all inclusive): si se pasa, se muestra al lado. */
  mealPlan?: MealPlan;
  onMealPlan?: (m: MealPlan) => void;
}) {
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
      {mealPlan && onMealPlan && <MealPlanSelect value={mealPlan} onChange={onMealPlan} />}
      {hint && <span className="lodging-hint">{mealPlan === "all" ? `${AI_HINT[value]} (precio estimado por persona)` : LODGING_HINT[value]}</span>}
    </div>
  );
}

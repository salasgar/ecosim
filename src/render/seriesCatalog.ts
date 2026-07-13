import type { StatsMessage } from "../sim/protocol";

// Every StatsMessage field that a chart can plot on its Y axis. "type" is
// the message discriminant and "tick" is always the X axis, so both are
// excluded here.
export type PlottableKey = Exclude<keyof StatsMessage, "type" | "tick">;

export interface SeriesDescriptor {
  key: PlottableKey;
  label: string;
  color: string;
}

export const SERIES_CATALOG: SeriesDescriptor[] = [
  { key: "creatureCount", label: "Criaturas", color: "#4ade80" },
  { key: "foodCount", label: "Comida", color: "#86efac" },
  { key: "meanSpeedGene", label: "Gen velocidad medio", color: "#c084fc" },
  { key: "meanKinTolerance", label: "Umbral parentesco medio", color: "#fb923c" },
  { key: "meanReserveGene", label: "ReservaGen medio", color: "#38bdf8" },
  { key: "meanPrefSpeed", label: "Vel. preferida media", color: "#a78bfa" },
  { key: "meanPrefReserve", label: "Reserva preferida media", color: "#f472b6" },
  { key: "meanSpecialization", label: "Especialización media", color: "#facc15" },
  { key: "meanKinTradeBias", label: "Sesgo parentesco en comercio", color: "#fb7185" },
  { key: "totalPredations", label: "Depredaciones totales", color: "#f87171" },
  { key: "totalMatings", label: "Uniones totales", color: "#34d399" },
  { key: "totalTrades", label: "Comercios totales", color: "#60a5fa" },
  { key: "climateMultiplier", label: "Multiplicador clima", color: "#e879f9" },
];

export function seriesLabel(key: PlottableKey): string {
  return SERIES_CATALOG.find((s) => s.key === key)?.label ?? key;
}

export function seriesColor(key: PlottableKey): string {
  return SERIES_CATALOG.find((s) => s.key === key)?.color ?? "#e5e7eb";
}

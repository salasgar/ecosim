// Tunable knobs, factored out of world.ts so the same definitions drive the
// simulation defaults, the live setParams protocol, and the UI panel that
// lets a user edit them mid-run. Engine-geometry constants (perception
// radius, eat radius, gene bounds, energy caps) stay as plain constants in
// world.ts — this file only covers values meant to be experimented with.
export interface SimParams {
  foodRegrowthProbability: number;
  metabolismBase: number;
  metabolismSpeedFactor: number;
  foodEnergy: number;

  mutationStdDev: number;
  genomeMutationStdDev: number;
  kinToleranceMutationStdDev: number;

  predationHungerThreshold: number;
  predationEfficiency: number;
  attackRadius: number;

  climatePeriodTicks: number;
  climateScarcityMultiplier: number;
  climateAbundanceMultiplier: number;
  mateSeekRadius: number;
  reproduceThreshold: number;

  tradeRadius: number;
  tradeChunk: number;
  kinTradeBiasMutationStdDev: number;
}

export const DEFAULT_PARAMS: SimParams = {
  foodRegrowthProbability: 0.05,
  metabolismBase: 4,
  metabolismSpeedFactor: 3,
  foodEnergy: 40,

  mutationStdDev: 0.05,
  genomeMutationStdDev: 0.05,
  kinToleranceMutationStdDev: 0.1,

  predationHungerThreshold: 35,
  predationEfficiency: 0.55,
  attackRadius: 8,

  climatePeriodTicks: 6000,
  climateScarcityMultiplier: 0.3,
  climateAbundanceMultiplier: 1.8,
  mateSeekRadius: 40,
  reproduceThreshold: 80,

  tradeRadius: 30,
  tradeChunk: 10,
  kinTradeBiasMutationStdDev: 0.1,
};

export interface ParamDescriptor {
  key: keyof SimParams;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
}

export const PARAM_DESCRIPTORS: ParamDescriptor[] = [
  { key: "foodRegrowthProbability", label: "Regrowth de comida", group: "Alimento", min: 0, max: 0.3, step: 0.01 },
  { key: "metabolismBase", label: "Metabolismo base", group: "Alimento", min: 0, max: 15, step: 0.5 },
  { key: "metabolismSpeedFactor", label: "Metabolismo por velocidad", group: "Alimento", min: 0, max: 10, step: 0.5 },
  { key: "foodEnergy", label: "Energía por comida", group: "Alimento", min: 5, max: 100, step: 5 },

  { key: "mutationStdDev", label: "Mutación (rasgos generales)", group: "Genética", min: 0, max: 0.3, step: 0.01 },
  { key: "genomeMutationStdDev", label: "Mutación (marcadores/genoma)", group: "Genética", min: 0, max: 0.3, step: 0.01 },
  { key: "kinToleranceMutationStdDev", label: "Mutación (umbral parentesco)", group: "Genética", min: 0, max: 0.5, step: 0.01 },

  { key: "predationHungerThreshold", label: "Umbral de hambre para atacar", group: "Depredación (Exp. 1)", min: 0, max: 100, step: 5 },
  { key: "predationEfficiency", label: "Eficiencia de digestión", group: "Depredación (Exp. 1)", min: 0, max: 1, step: 0.05 },
  { key: "attackRadius", label: "Radio de ataque", group: "Depredación (Exp. 1)", min: 2, max: 40, step: 1 },

  { key: "climatePeriodTicks", label: "Periodo del ciclo climático", group: "Clima y pareja (Exp. 2)", min: 500, max: 20000, step: 500 },
  { key: "climateScarcityMultiplier", label: "Multiplicador de escasez", group: "Clima y pareja (Exp. 2)", min: 0.05, max: 1, step: 0.05 },
  { key: "climateAbundanceMultiplier", label: "Multiplicador de abundancia", group: "Clima y pareja (Exp. 2)", min: 1, max: 4, step: 0.1 },
  { key: "mateSeekRadius", label: "Radio de búsqueda de pareja", group: "Clima y pareja (Exp. 2)", min: 5, max: 100, step: 5 },
  { key: "reproduceThreshold", label: "Energía mínima para reproducirse", group: "Clima y pareja (Exp. 2)", min: 20, max: 200, step: 5 },

  { key: "tradeRadius", label: "Radio de comercio", group: "Comercio (Exp. 3)", min: 5, max: 100, step: 5 },
  { key: "tradeChunk", label: "Tamaño del intercambio", group: "Comercio (Exp. 3)", min: 1, max: 30, step: 1 },
  { key: "kinTradeBiasMutationStdDev", label: "Mutación (sesgo de parentesco)", group: "Comercio (Exp. 3)", min: 0, max: 0.5, step: 0.01 },
];

/**
 * Sample gates (design §7). A metric/segment below gate is suppressed or
 * labeled exploratory — this is how the engine surfaces FEW conclusions
 * instead of many underpowered ones.
 */

import { DEFAULT_SAMPLE_GATES, type SampleGates } from "../config";

export interface GateInput {
  exposedPopulation: number;
  events: number;
  resolvedOutcomes: number;
  missingnessPct: number;
  historicalPeriods: number;
}

export type GateVerdict = "pass" | "exploratory" | "suppress";

export interface GateResult {
  verdict: GateVerdict;
  failures: string[];
}

export function evaluateGates(
  input: GateInput,
  gates: SampleGates = DEFAULT_SAMPLE_GATES,
): GateResult {
  const failures: string[] = [];

  // Hard suppression: below the minimum event / resolved floor.
  if (input.events < gates.minEvents) failures.push(`events ${input.events} < ${gates.minEvents}`);
  if (input.resolvedOutcomes < gates.minResolvedOutcomes)
    failures.push(`resolved ${input.resolvedOutcomes} < ${gates.minResolvedOutcomes}`);
  if (failures.length > 0) return { verdict: "suppress", failures };

  // Soft (exploratory) conditions.
  const soft: string[] = [];
  if (input.exposedPopulation < gates.minExposedPopulation)
    soft.push(`exposed ${input.exposedPopulation} < ${gates.minExposedPopulation}`);
  if (input.missingnessPct > gates.maxMissingnessPct)
    soft.push(`missingness ${input.missingnessPct}% > ${gates.maxMissingnessPct}%`);
  if (input.historicalPeriods < gates.minHistoricalPeriods)
    soft.push(`periods ${input.historicalPeriods} < ${gates.minHistoricalPeriods}`);

  return soft.length > 0
    ? { verdict: "exploratory", failures: soft }
    : { verdict: "pass", failures: [] };
}

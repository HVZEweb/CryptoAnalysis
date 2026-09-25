/**
 * Helpers for scoring individual ensemble components against realised prices.
 */

import type { PredictionDirection } from "@/types";

export function isComponentCorrect(
  direction: PredictionDirection,
  entry: number,
  exit: number,
  minMovePct = 0.15
): boolean {
  const ret = ((exit - entry) / entry) * 100;
  if (direction === "LONG") return ret > minMovePct;
  if (direction === "SHORT") return ret < -minMovePct;
  return Math.abs(ret) < minMovePct * 0.6;
}

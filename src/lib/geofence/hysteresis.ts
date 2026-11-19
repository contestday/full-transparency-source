/**
 * Geofence entry/exit state machine with accuracy-aware hysteresis.
 *
 * signedDistanceM: distance from the reading to the fence boundary; positive
 * inside, negative outside.
 *
 * A reading only counts as "confidently inside" when it is inside by more than
 * the margin (base + share of the reported accuracy), and "confidently outside"
 * when outside by more than the same margin. Readings in the band between are
 * ambiguous and never change state. A transition also needs `confirmations`
 * consecutive confident readings, which suppresses single-point jitter.
 */

export interface GeofenceRuntimeState {
  inside: boolean;
  pendingInside: boolean | null;
  pendingCount: number;
}

export interface Reading {
  signedDistanceM: number;
  accuracyM: number | null;
}

export interface HysteresisOptions {
  baseMarginM: number;
  accuracyFactor: number;
  maxAccuracyM: number;
  confirmations: number;
  /** Assumed accuracy when the source did not report one. */
  defaultAccuracyM: number;
}

export const DEFAULT_HYSTERESIS: HysteresisOptions = {
  baseMarginM: 15,
  accuracyFactor: 0.5,
  maxAccuracyM: 250,
  confirmations: 2,
  defaultAccuracyM: 50,
};

export type Transition = "enter" | "exit" | null;

export function classify(reading: Reading, opts: HysteresisOptions): "inside" | "outside" | "ambiguous" | "unusable" {
  const accuracy = reading.accuracyM ?? opts.defaultAccuracyM;
  if (accuracy > opts.maxAccuracyM) return "unusable";
  const margin = opts.baseMarginM + opts.accuracyFactor * accuracy;
  if (reading.signedDistanceM >= margin) return "inside";
  if (reading.signedDistanceM <= -margin) return "outside";
  return "ambiguous";
}

export function nextState(
  state: GeofenceRuntimeState,
  reading: Reading,
  opts: HysteresisOptions = DEFAULT_HYSTERESIS,
): { state: GeofenceRuntimeState; transition: Transition } {
  const c = classify(reading, opts);
  if (c === "unusable" || c === "ambiguous") {
    // Keep any pending count; ambiguous readings neither confirm nor cancel.
    return { state, transition: null };
  }
  const observedInside = c === "inside";
  if (observedInside === state.inside) {
    return { state: { inside: state.inside, pendingInside: null, pendingCount: 0 }, transition: null };
  }
  const count = state.pendingInside === observedInside ? state.pendingCount + 1 : 1;
  if (count >= opts.confirmations) {
    return {
      state: { inside: observedInside, pendingInside: null, pendingCount: 0 },
      transition: observedInside ? "enter" : "exit",
    };
  }
  return { state: { inside: state.inside, pendingInside: observedInside, pendingCount: count }, transition: null };
}

import type { Trajectory } from "../src/types";

export const SEED: number;
export const FIXTURE_PATH: string;
/** The fixture rows for a seed. The same seed always gives the same rows. */
export function generate(seed?: number): Trajectory[];

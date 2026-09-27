/**
 * A mined session, described once for the console: how many manual steps it took, and each
 * step as one line of prose with the seconds since the one before. The prose is the compiler's
 * own rendering (`renderStep`, its f_low), so the page says exactly what the prompts said, and
 * the page never has to evaluate the compiler itself.
 */
import { countManualActions, renderStep, secondsBetween, type Trajectory } from "@lantern/capability";

export type RenderedStep = { line: string; seconds: number };

export type DescribedTrajectory = {
  trajectory: Trajectory;
  manualActions: number;
  rendered: RenderedStep[];
};

export function describeTrajectory(trajectory: Trajectory): DescribedTrajectory {
  const rendered = trajectory.steps.map((step, index) => {
    const previous = trajectory.steps[index - 1];
    return { line: renderStep(step), seconds: previous ? secondsBetween(previous.t, step.t) : 0 };
  });
  return { trajectory, manualActions: countManualActions(trajectory.steps), rendered };
}

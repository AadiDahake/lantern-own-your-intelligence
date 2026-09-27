import type {
  AnswerSource,
  EscalationOffer,
  EscalationView,
  FeedbackRating,
  PlanSummary,
  ProbeName,
  ProbeResult,
  ReportBlock,
  Step,
  Verdict,
} from '../types';

export type ProbeState = { status: 'pending' | 'running' | 'done'; result?: ProbeResult };

export type Answer = {
  text: string;
  steps: Step[] | null;
  escalation: EscalationOffer;
  /** The agent recorded the gap for the developers on its own. */
  noted?: boolean;
  /** Where the steps came from and how many there are, fixed for the whole walk. */
  plan?: PlanSummary;
  /** The documentation the answer rests on. */
  sources?: AnswerSource[];
};

export type Turn = {
  id: string;
  question: string;
  probes: Record<ProbeName, ProbeState>;
  feature?: string;
  /** What the agent already knew about this visitor when the turn started. */
  memory?: string[];
  verdict?: Verdict;
  answer?: Answer;
  messageId?: string;
  error?: string;
  reporting?: boolean;
  reportBlocked?: ReportBlock;
  escalationId?: string;
  escalation?: EscalationView;
  /** Set once the visitor has said whether this answer helped. */
  rating?: FeedbackRating;
};

export function newTurn(id: string, question: string): Turn {
  return {
    id,
    question,
    probes: {
      docs: { status: 'pending' },
      interface: { status: 'pending' },
      repository: { status: 'pending' },
    },
  };
}

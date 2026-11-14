export const VERDICTS = ['done', 'rejected', 'needs_human'] as const;

export type Verdict = (typeof VERDICTS)[number];

export interface PreviousStep {
  stepId: string;
  specialist: string;
  verdict: Verdict;
  summary: string;
}

export interface HumanDecision {
  stepId: string;
  question: string;
  answer: string;
  /** Who answered: a person, the autopilot of the queue or an observer. */
  by: 'human' | 'autopilot' | 'observer';
  /** Number of the attempt that asked the question. */
  attemptSeq?: number;
}

export interface HumanMessage {
  text: string;
  /** When the daemon accepted the message (ms). */
  at: number;
}

/** A file the person attached to the task. */
export interface InputAttachment {
  fileName: string;
  size: number;
  mediaType: string;
}

export interface StepInput {
  prompt: string;
  groupTitle: string;
  stepId: string;
  specialistName: string;
  skills: string[];
  previous: PreviousStep[];
  feedback: string | null;
  humanAnswer: string | null;
  decisions: HumanDecision[];
  /** A message the human sent to the specialist while the previous attempt ran. */
  message?: HumanMessage | null;
  /** The step was resumed by the answer to a human review: its `done` goes on without a new review. */
  reviewed?: boolean;
  /** The step stops for a human review after `done`. */
  humanReview?: boolean;
  /** Files attached to the task; absent when there are none. */
  attachments?: InputAttachment[];
}

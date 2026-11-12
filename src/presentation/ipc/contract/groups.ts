import { VERDICTS } from '../../../feature/agents/types/index.ts';
import {
  FEEDBACK_LIMIT,
  OPTIONS_LIMIT,
  OPTION_LIMIT,
  QUESTIONS_LIMIT,
  QUESTION_TEXT_LIMIT,
  RECOMMENDATION_LIMIT,
  SUMMARY_LIMIT,
} from '../../../feature/runs/types/index.ts';
import { proposedGroupSchema, target } from './runs.ts';
import { z } from 'zod';

export const humanQuestionSchema = z.object({
  text: z.string().trim().min(1).max(QUESTION_TEXT_LIMIT),
  options: z.array(z.string().trim().min(1).max(OPTION_LIMIT)).min(1).max(OPTIONS_LIMIT).nullish(),
  recommendation: z.string().trim().min(1).max(RECOMMENDATION_LIMIT).nullish(),
});

export const reportParamsSchema = z.object({
  token: z.string().min(1),
  verdict: z.enum(VERDICTS),
  summary: z.string().min(1).max(SUMMARY_LIMIT),
  feedback: z.string().max(FEEDBACK_LIMIT).nullish(),
  questions: z.array(humanQuestionSchema).min(1).max(QUESTIONS_LIMIT).nullish(),
  human_only: z.boolean().nullish(),
});

/** Longest message a human can send to a running specialist. */
export const MESSAGE_TEXT_LIMIT = 20_000;

export const groupsRequests = [
  z.object({
    method: z.literal('group'),
    params: z.object({ ...target, tailLines: z.number().int().min(1).max(500).optional() }),
  }),
  z.object({ method: z.literal('group_spec'), params: z.object(target) }),
  z.object({
    method: z.literal('group_file_diff'),
    params: z.object({ ...target, path: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('answer'),
    params: z.object({ ...target, answer: z.string().trim().min(1) }),
  }),
  z.object({
    method: z.literal('message'),
    params: z.object({
      ...target,
      seq: z.number().int().positive(),
      text: z.string().trim().min(1).max(MESSAGE_TEXT_LIMIT),
    }),
  }),
  z.object({ method: z.literal('report'), params: reportParamsSchema }),
  z.object({
    method: z.literal('worker_run_show'),
    params: z.object({
      token: z.string().min(1),
      run: z.string().trim().min(1),
      group: z.string().min(1).optional(),
      tailLines: z.number().int().min(1).max(500).optional(),
    }),
  }),
  z.object({
    method: z.literal('split'),
    params: z.object({ token: z.string().min(1), groups: z.array(proposedGroupSchema) }),
  }),
] as const;

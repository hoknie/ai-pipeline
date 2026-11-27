import { z } from 'zod';
import {
  REVIEW_ID_LIMIT,
  REVIEW_ITEMS_LIMIT,
  REVIEW_ORIGINS,
  REVIEW_SEVERITIES,
  REVIEW_TEXT_LIMIT,
} from '../../../../feature/agents/types/index.ts';

const text = z
  .string()
  .min(1)
  .max(REVIEW_TEXT_LIMIT)
  .refine((value) => value.trim() !== '', 'must not be blank');
const id = z
  .string()
  .min(1)
  .max(REVIEW_ID_LIMIT)
  .refine((value) => value.trim() !== '', 'must not be blank');
const finding = z.object({
  id,
  severity: z.enum(REVIEW_SEVERITIES),
  file: text,
  scenario: text,
  expected: text,
  evidence: text,
  origin: z.enum(REVIEW_ORIGINS),
  reason: text,
});

export const reviewReportSchema = z.object({
  findings: z.array(finding).max(REVIEW_ITEMS_LIMIT),
  resolved: z.array(z.object({ id, evidence: text })).max(REVIEW_ITEMS_LIMIT),
});
export const implementationReportSchema = z.object({
  files: z.array(text).max(REVIEW_ITEMS_LIMIT),
  resolutions: z.array(z.object({ id, change: text, tests: text })).max(REVIEW_ITEMS_LIMIT),
  checks: z
    .array(z.object({ command: text, result: z.enum(['passed', 'failed']), evidence: text }))
    .max(REVIEW_ITEMS_LIMIT),
});
export const strategyReportSchema = z.object({
  summary: text,
  slices: z
    .array(z.object({ title: text, acceptance: text }))
    .min(1)
    .max(REVIEW_ITEMS_LIMIT),
});

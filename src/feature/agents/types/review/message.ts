import type { ReviewAssignment } from './protocol.ts';

/** Instructions accompany the data so even an installed custom specialist can use the protocol. */
export function reviewMessage(review: ReviewAssignment): string {
  const common = [
    '## Managed review cycle',
    `Role: ${review.role}; reviewer step: ${review.reviewerStep}.`,
    'Stay within the original task and accepted decisions. Leave manual checks to the person. Report only when your role is complete; unfinished implementation is work to continue in this attempt, not a rejected report.',
  ];
  if (review.role === 'review')
    common.push(
      'Supply review: {findings, resolved}. Return the full open list with stable IDs; never silently drop a previous ID. Each finding needs id, severity (blocker/major/minor), file, scenario, expected, evidence, origin (initial/missed/regression), reason. Each verified closure needs id and evidence.',
      'After the first review, classify new findings as missed or regression and explain why. Reopened IDs are regressions. Only blocker/major defects reject; minor suggestions do not block. Verify the repairs and regressions caused by the new changes. A broader repeat audit or repeat of the full gate needs a concrete reason; use the supplied check evidence and inspect relevant files.',
    );
  if (review.role === 'implementation')
    common.push(
      'Supply implementation: {files, resolutions: [{id, change, tests}], checks: [{command, result: passed|failed, evidence}]}. Address every blocking ID. Fix the underlying invariant across affected paths, not just the reported example; use table-driven cases for neighboring values, types, missing keys and explicit edits.',
      'Work through the plan in sequential slices with acceptance criteria. Keep progress within this attempt until the agreed technical scope is complete. Run targeted regressions while editing, then all required checks after the final edit before handoff; never cite an old gate for new code. Report a concrete external blocker through needs_human if independent work cannot continue.',
    );
  if (review.role === 'recovery')
    common.push(
      'The implementation/review loop has stalled. Do not repeat the old continue instruction. Identify the root cause and change the approach. Supply strategy: {summary, slices: [{title, acceptance}]}; preserve all original requirements, decompose into sequential testable slices, and specify the invariant and regression checks for each. Do not create new queue jobs or change settings.',
    );
  common.push(`Current handoff data:\n${JSON.stringify(review, null, 2)}`);
  return common.join('\n\n');
}

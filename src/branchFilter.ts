import type { GitLabMergeRequest } from './types.js';

export interface BranchExcludeOptions {
  // source_branch에 매칭되면 제외 대상 후보가 되는 정규식 (예: ^sprint\d+-dev$)
  sourcePattern?: RegExp;
  // target_branch에 매칭되면 제외 대상 후보가 되는 정규식 (예: ^dev$)
  targetPattern?: RegExp;
}

// sourcePattern, targetPattern 둘 다 지정되면 둘 다 만족할 때만 제외합니다.
// (예: "sprint1-dev → dev"는 제외하되, "sprint1-dev → feature/x" 같은 MR은 남겨둠)
// 둘 중 하나만 지정되면 그 조건만으로 판단합니다.
export function isExcludedByBranchPattern(
  mr: GitLabMergeRequest,
  opts: BranchExcludeOptions,
): boolean {
  const { sourcePattern, targetPattern } = opts;
  if (!sourcePattern && !targetPattern) return false;

  const sourceMatches = sourcePattern ? sourcePattern.test(mr.source_branch) : true;
  const targetMatches = targetPattern ? targetPattern.test(mr.target_branch) : true;

  return sourceMatches && targetMatches;
}

export function filterOutBranchPattern(
  mrs: GitLabMergeRequest[],
  opts: BranchExcludeOptions,
): { kept: GitLabMergeRequest[]; excludedCount: number } {
  const kept: GitLabMergeRequest[] = [];
  let excludedCount = 0;
  for (const mr of mrs) {
    if (isExcludedByBranchPattern(mr, opts)) {
      excludedCount++;
    } else {
      kept.push(mr);
    }
  }
  return { kept, excludedCount };
}

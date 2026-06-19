import type {
  EnrichedMR,
  GitLabCommit,
  GitLabDiscussion,
  GitLabMRChangeFile,
  DeveloperMetrics,
  DeveloperScoreBreakdown,
  ConfidenceLevel,
} from './types.js';

// diff 텍스트(unified diff 포맷)에서 실제 추가/삭제된 라인 수를 셉니다.
// "+++"/"---" 같은 파일 헤더 라인은 제외합니다.
export function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  const lines = diff.split('\n');
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}

export function sumChanges(files: GitLabMRChangeFile[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    const { additions: a, deletions: d } = countDiffLines(f.diff ?? '');
    additions += a;
    deletions += d;
  }
  return { additions, deletions };
}

// GitLab은 MR에 커밋이 추가될 때 system note를 남깁니다.
// 실제 문구는 GitLab 버전/상황에 따라 약간 달라질 수 있어 보수적으로 넓게 잡습니다.
const PUSH_NOTE_PATTERN = /\b(added|pushed)\b.*\bcommit(s)?\b/i;

function getPushSystemNotes(discussions: GitLabDiscussion[]) {
  const notes = discussions.flatMap((d) => d.notes);
  return notes
    .filter((note) => note.system && PUSH_NOTE_PATTERN.test(note.body))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function countPushEvents(discussions: GitLabDiscussion[]): number {
  const count = getPushSystemNotes(discussions).length;
  // 최초 push(=MR 생성 직후 표시되는 첫 커밋 추가 이벤트)는 재작업으로 보지 않으므로 1을 뺍니다.
  return Math.max(0, count - 1);
}

export function countPostReviewPushEvents(
  discussions: GitLabDiscussion[],
  authorUsername: string,
): number {
  const reviewerNotes = discussions
    .flatMap((d) => d.notes)
    .filter((note) => !note.system && note.author.username !== authorUsername)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const firstReviewerNoteAt = reviewerNotes[0]?.created_at;
  if (!firstReviewerNoteAt) return 0;

  const firstReviewerNoteTime = new Date(firstReviewerNoteAt).getTime();
  return getPushSystemNotes(discussions).filter(
    (note) => new Date(note.created_at).getTime() > firstReviewerNoteTime,
  ).length;
}

export function countReviewCommentsByOthers(
  discussions: GitLabDiscussion[],
  authorUsername: string,
): number {
  let count = 0;
  for (const d of discussions) {
    for (const note of d.notes) {
      if (!note.system && note.author.username !== authorUsername) {
        count++;
      }
    }
  }
  return count;
}

export function countUnresolvedReviewCommentsByOthers(
  discussions: GitLabDiscussion[],
  authorUsername: string,
): number {
  let count = 0;
  for (const d of discussions) {
    for (const note of d.notes) {
      if (
        !note.system &&
        note.author.username !== authorUsername &&
        note.resolvable === true &&
        note.resolved !== true
      ) {
        count++;
      }
    }
  }
  return count;
}

// "재논의(re-review)" 판정에서 제외할 승인/칭찬성 코멘트 패턴.
// 리뷰어가 같은 스레드에 다시 코멘트를 달았더라도, 그게 "잘 고쳤다/통과"류라면
// 재작업 신호가 아니므로 감점하지 않습니다.
// 주의: 이 패턴은 휴리스틱이며 팀의 리뷰 코멘트 언어/말투에 의존합니다.
//       실제 코멘트를 보고 반드시 점검·보강하세요 (예: 폴란드어 팀이면 해당 표현 추가).
const APPROVAL_NOTE_PATTERN =
  /\b(lgtm|looks?\s+good|looks?\s+great|good\s+to\s+me|good\s+now|all\s+good|works?\s+now|fixed\s+now|nice|perfect|great|thanks|thank\s+you|approved?|resolving|resolved|done|ship\s+it|\+1)\b|👍|🙏|✅|좋아요|좋습니다|좋네요|확인했|반영\s*확인|통과|굿|감사/i;

function isApprovalNote(body: string): boolean {
  return APPROVAL_NOTE_PATTERN.test(body.trim());
}

// 한 MR의 discussions에서 (리뷰 스레드 수, 재논의된 스레드 수)를 셉니다.
// 단순 push 횟수와 달리, 코멘트를 나눠서 깔끔히 처리하는 스타일은 감점하지 않고
// "같은 지적이 다시 돌아온(=첫 수정이 부족했던)" 스레드만 잡는 것이 목적입니다.
//
// - 리뷰 스레드: 본인이 아닌 사람이 단 non-system 코멘트가 1개 이상 있는 스레드
// - 재논의 스레드: 그 스레드에서 첫 리뷰어 코멘트 "이후"의 리뷰어 코멘트 중,
//   승인/칭찬성(APPROVAL)이 아닌 코멘트가 1개 이상 있는 경우
//   (= 리뷰어가 다시 와서 "아직 부족하다"는 식으로 코멘트한 경우)
export function analyzeReviewThreads(
  discussions: GitLabDiscussion[],
  authorUsername: string,
): { reviewThreads: number; reReviewedThreads: number } {
  let reviewThreads = 0;
  let reReviewedThreads = 0;

  for (const d of discussions) {
    const reviewerNotes = d.notes
      .filter((n) => !n.system && n.author.username !== authorUsername)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    if (reviewerNotes.length === 0) continue;
    reviewThreads++;

    const followUps = reviewerNotes.slice(1);
    const hasNonApprovalFollowUp = followUps.some((n) => !isApprovalNote(n.body));
    if (hasNonApprovalFollowUp) reReviewedThreads++;
  }

  return { reviewThreads, reReviewedThreads };
}

const REVERT_LIKE_PATTERN =
  /(^|\b)(revert|rollback|hotfix|emergency fix|urgent fix|롤백|되돌림)(\b|:)/i;

export function isRevertLikeCommit(
  commitOrTitle: Pick<GitLabCommit, 'title' | 'message'> | string,
): boolean {
  const text =
    typeof commitOrTitle === 'string'
      ? commitOrTitle
      : `${commitOrTitle.title ?? ''}\n${commitOrTitle.message ?? ''}`;
  return REVERT_LIKE_PATTERN.test(text.trim());
}

export function hoursBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60);
}

// 가중치는 팀 상황에 맞게 조정하는 출발점입니다.
// 재작업 신호로는 "push 횟수"가 아니라 "재논의 스레드 비율"을 씁니다.
// push 횟수는 코멘트를 나눠 처리하는 스타일까지 감점해 왜곡되기 때문에,
// "리뷰어가 같은 스레드에 다시 와서 아직 부족하다고 한" 비율(reReviewedThreadRatio)을 사용합니다.
export const QUALITY_WEIGHTS = {
  lowReReview: 0.35,
  pipelineFirstTry: 0.3,
  lowCommentDensity: 0.2,
  lowRevertRatio: 0.15,
} as const;

const TOTAL_WEIGHT = Object.values(QUALITY_WEIGHTS).reduce((s, w) => s + w, 0);

const SCORE_SCALE = {
  // 리뷰 스레드의 30%가 재논의되면 50점 수준. 팀 문화에 따라 0.2~0.5 사이 조정 권장.
  reReviewedThreadRatio: 0.3,
  // 100줄당 리뷰어 코멘트 1개까지는 건강한 리뷰 활동으로 보고 감점하지 않음.
  commentDensityFreeAllowance: 1,
  // free allowance 초과분이 5개/100줄이면 큰 폭으로 감점.
  commentDensity: 5,
  oversizedMRLines: 800,
};

function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeInverse(value: number, scaleAt: number): number {
  // value가 0이면 1점(최고), scaleAt에 가까워질수록 완만하게 감소하는 함수
  if (value <= 0) return 1;
  return 1 / (1 + value / scaleAt);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function scoreTo100(score: number): number {
  return round1(clamp01(score) * 100);
}

function calculateConfidence(
  totalMRs: number,
  scoreCoverageRate: number,
): {
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
} {
  // 표본 수가 너무 적으면 점수 자체가 우연에 크게 흔들립니다.
  // 단, 품질점수에 직접 곱하지 않고 별도 신뢰도 지표로 제공합니다.
  const sampleFactor =
    totalMRs >= 10 ? 1 : totalMRs >= 5 ? 0.8 : totalMRs >= 3 ? 0.6 : totalMRs >= 1 ? 0.4 : 0;
  const coverageFactor = 0.5 + 0.5 * clamp01(scoreCoverageRate);
  const confidenceScore = round1(100 * sampleFactor * coverageFactor);
  const confidenceLevel: ConfidenceLevel =
    confidenceScore >= 80 ? 'high' : confidenceScore >= 50 ? 'medium' : 'low';
  return { confidenceScore, confidenceLevel };
}

export function aggregateDeveloperMetrics(
  mrsByAuthor: Map<string, EnrichedMR[]>,
): DeveloperMetrics[] {
  const result: DeveloperMetrics[] = [];

  for (const [username, mrs] of mrsByAuthor.entries()) {
    const totalMRs = mrs.length;
    const mergedMRs = mrs.filter((m) => m.mr.state === 'merged').length;
    const closedWithoutMerge = mrs.filter((m) => m.mr.state === 'closed').length;

    const totalLinesChanged = mrs.reduce((s, m) => s + m.additions + m.deletions, 0);
    const avgLinesChangedPerMR = totalMRs ? totalLinesChanged / totalMRs : 0;

    const oversizedMRs = mrs.filter(
      (m) => m.additions + m.deletions >= SCORE_SCALE.oversizedMRLines,
    ).length;
    const oversizedMRRatio = totalMRs ? oversizedMRs / totalMRs : 0;

    const totalReviewComments = mrs.reduce(
      (s, m) => s + countReviewCommentsByOthers(m.discussions, username),
      0,
    );
    const avgReviewCommentsPerMR = totalMRs ? totalReviewComments / totalMRs : 0;
    const reviewCommentsPer100Lines =
      totalLinesChanged > 0 ? (totalReviewComments / totalLinesChanged) * 100 : 0;

    const unresolvedReviewComments = mrs.reduce(
      (s, m) => s + countUnresolvedReviewCommentsByOthers(m.discussions, username),
      0,
    );
    const unresolvedReviewCommentsPer100Lines =
      totalLinesChanged > 0 ? (unresolvedReviewComments / totalLinesChanged) * 100 : 0;

    const totalPushCount = mrs.reduce((s, m) => s + m.pushCount, 0);
    const avgPushCountPerMR = totalMRs ? totalPushCount / totalMRs : 0;

    const totalPostReviewPushCount = mrs.reduce((s, m) => s + m.postReviewPushCount, 0);
    const avgPostReviewPushCountPerMR = totalMRs ? totalPostReviewPushCount / totalMRs : 0;

    const threadStats = mrs.reduce(
      (acc, m) => {
        const { reviewThreads, reReviewedThreads } = analyzeReviewThreads(m.discussions, username);
        acc.reviewThreads += reviewThreads;
        acc.reReviewedThreads += reReviewedThreads;
        return acc;
      },
      { reviewThreads: 0, reReviewedThreads: 0 },
    );
    const totalReviewThreads = threadStats.reviewThreads;
    const reReviewedThreads = threadStats.reReviewedThreads;
    const reReviewedThreadRatio = totalReviewThreads
      ? reReviewedThreads / totalReviewThreads
      : 0;

    const mrsWithPipeline = mrs.filter((m) => m.pipelines.length > 0);
    const firstTrySuccesses = mrsWithPipeline.filter((m) => {
      const sorted = [...m.pipelines].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      return sorted[0]?.status === 'success';
    }).length;
    const pipelineFirstTrySuccessRate = mrsWithPipeline.length
      ? firstTrySuccesses / mrsWithPipeline.length
      : 0;
    const pipelineEvaluatedMRs = mrsWithPipeline.length;
    const pipelineMissingMRs = totalMRs - pipelineEvaluatedMRs;

    const totalCommits = mrs.reduce((s, m) => s + m.commits.length, 0);
    const revertCommits = mrs.reduce(
      (s, m) => s + m.commits.filter((c) => isRevertLikeCommit(c)).length,
      0,
    );
    const revertCommitRatio = totalCommits ? revertCommits / totalCommits : 0;

    const mergedWithDates = mrs.filter((m) => m.mr.merged_at);
    const avgHoursToMerge = mergedWithDates.length
      ? mergedWithDates.reduce(
          (s, m) => s + hoursBetween(m.mr.created_at, m.mr.merged_at as string),
          0,
        ) / mergedWithDates.length
      : null;

    const mergeRate = totalMRs ? mergedMRs / totalMRs : 0;

    const lowRevertRatioScore = 1 - clamp01(revertCommitRatio);

    const components: Array<{
      key: keyof DeveloperScoreBreakdown;
      weight: number;
      score: number;
    }> = [
      { key: 'lowRevertRatio', weight: QUALITY_WEIGHTS.lowRevertRatio, score: lowRevertRatioScore },
    ];

    // 재작업 신호: 리뷰 스레드가 있어야 평가 가능. 없으면 (아무도 리뷰 안 함) 점수에서 제외.
    let lowReReviewScore: number | null = null;
    if (totalReviewThreads > 0) {
      lowReReviewScore = normalizeInverse(reReviewedThreadRatio, SCORE_SCALE.reReviewedThreadRatio);
      components.push({
        key: 'lowReReview',
        weight: QUALITY_WEIGHTS.lowReReview,
        score: lowReReviewScore,
      });
    }

    let pipelineFirstTryScore: number | null = null;
    if (mrsWithPipeline.length > 0) {
      pipelineFirstTryScore = pipelineFirstTrySuccessRate;
      components.push({
        key: 'pipelineFirstTry',
        weight: QUALITY_WEIGHTS.pipelineFirstTry,
        score: pipelineFirstTryScore,
      });
    }

    let lowCommentDensityScore: number | null = null;
    if (totalLinesChanged > 0) {
      const penalizedCommentDensity = Math.max(
        0,
        reviewCommentsPer100Lines - SCORE_SCALE.commentDensityFreeAllowance,
      );
      lowCommentDensityScore = normalizeInverse(
        penalizedCommentDensity,
        SCORE_SCALE.commentDensity,
      );
      components.push({
        key: 'lowCommentDensity',
        weight: QUALITY_WEIGHTS.lowCommentDensity,
        score: lowCommentDensityScore,
      });
    }

    const appliedWeight = components.reduce((s, c) => s + c.weight, 0);
    const weightedScore = components.reduce((s, c) => s + c.weight * c.score, 0);
    const qualityScore = appliedWeight > 0 ? 100 * (weightedScore / appliedWeight) : 0;
    const scoreCoverageRate = TOTAL_WEIGHT > 0 ? appliedWeight / TOTAL_WEIGHT : 0;
    const { confidenceScore, confidenceLevel } = calculateConfidence(totalMRs, scoreCoverageRate);

    result.push({
      username,
      name: mrs[0]?.mr.author.name ?? username,
      totalMRs,
      mergedMRs,
      closedWithoutMerge,
      mergeRate,
      totalLinesChanged,
      avgLinesChangedPerMR,
      totalReviewComments,
      avgReviewCommentsPerMR,
      reviewCommentsPer100Lines,
      unresolvedReviewComments,
      unresolvedReviewCommentsPer100Lines,
      totalPushCount,
      avgPushCountPerMR,
      totalPostReviewPushCount,
      avgPostReviewPushCountPerMR,
      totalReviewThreads,
      reReviewedThreads,
      reReviewedThreadRatio,
      pipelineEvaluatedMRs,
      pipelineMissingMRs,
      pipelineFirstTrySuccessRate,
      totalCommits,
      revertCommits,
      revertCommitRatio,
      oversizedMRs,
      oversizedMRRatio,
      avgHoursToMerge,
      scoreBreakdown: {
        lowReReview: lowReReviewScore === null ? null : scoreTo100(lowReReviewScore),
        pipelineFirstTry: pipelineFirstTryScore === null ? null : scoreTo100(pipelineFirstTryScore),
        lowCommentDensity:
          lowCommentDensityScore === null ? null : scoreTo100(lowCommentDensityScore),
        lowRevertRatio: scoreTo100(lowRevertRatioScore),
      },
      scoreCoverageRate: round1(scoreCoverageRate * 100),
      confidenceScore,
      confidenceLevel,
      qualityScore: round1(qualityScore),
    });
  }

  return result.sort((a, b) => {
    if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    return b.confidenceScore - a.confidenceScore;
  });
}

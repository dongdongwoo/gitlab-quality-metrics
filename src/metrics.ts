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
  lowReReview: 0.25,
  lowCommentDensity: 0.15,
  lowUnresolvedComments: 0.25,
  lowRevertRatio: 0.1,
  lowOversizedMRRatio: 0.2,
  testChangeCoverage: 0.05,
} as const;

const TOTAL_WEIGHT = Object.values(QUALITY_WEIGHTS).reduce((s, w) => s + w, 0);

const SCORE_SCALE = {
  // 리뷰 스레드의 15%가 재논의되면 50점 수준. Platform 후보 선별용으로 엄격하게 봅니다.
  reReviewedThreadRatio: 0.15,
  // 100줄당 리뷰어 코멘트 0.5개까지는 건강한 리뷰 활동으로 보고 감점하지 않음.
  commentDensityFreeAllowance: 0.5,
  // free allowance 초과분이 2.5개/100줄이면 큰 폭으로 감점.
  commentDensity: 2.5,
  // 100줄당 미해결 코멘트 0.25개면 50점 수준.
  unresolvedCommentDensity: 0.25,
  oversizedMRLines: 800,
  // 전체 변경 라인 중 테스트 변경이 20% 이상이면 테스트 커버리지 점수 만점.
  testChangeRatioTarget: 0.2,
  // 대형 MR 비율이 10%면 50점 수준.
  oversizedMRRatio: 0.1,
  // 작업량 점수에서는 MR 1개가 라인 수를 과도하게 독식하지 않도록 cap을 둡니다.
  workloadMRLineCap: 800,
  // 초기 구축/스캐폴딩 성격 MR은 라인 수 기여도를 낮춥니다.
  initLikeWorkloadLineMultiplier: 0.25,
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

function normalizeCohortVolume(value: number, cohortMax: number): number {
  if (cohortMax <= 0) return 0;
  // 작업량은 최댓값 대비 상대 점수로 보되, sqrt로 상위 1명만 과도하게 독식하지 않게 합니다.
  return Math.sqrt(clamp01(value / cohortMax));
}

function calculateWorkloadScore(
  totalMRs: number,
  effectiveWorkloadLinesChanged: number,
  maxMRs: number,
  maxEffectiveWorkloadLinesChanged: number,
): number {
  const mrVolumeScore = normalizeCohortVolume(totalMRs, maxMRs);
  const lineVolumeScore = normalizeCohortVolume(
    effectiveWorkloadLinesChanged,
    maxEffectiveWorkloadLinesChanged,
  );
  return round1(100 * (0.55 * mrVolumeScore + 0.45 * lineVolumeScore));
}

function calculatePlatformReadinessScore(qualityScore: number, workloadScore: number): number {
  // Platform 후보는 품질이 먼저지만, 같은 품질이면 실제 작업량이 충분한 사람이 더 강한 신호입니다.
  return round1(0.65 * qualityScore + 0.35 * workloadScore);
}

const TEST_FILE_PATTERN =
  /(^|\/)(__tests__|tests?|specs?)(\/|$)|(^|\/)[^/]+\.(test|spec)\.[jt]sx?$|(^|\/)(jest|vitest|playwright|cypress)\.config\.[jt]s$/i;

function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERN.test(path);
}

function countTestLinesChanged(mrs: EnrichedMR[]): number {
  return mrs.reduce((sum, mr) => {
    const mrTestLines = mr.changes.reduce((fileSum, file) => {
      const path = file.new_path || file.old_path;
      if (!isTestFile(path)) return fileSum;
      const { additions, deletions } = countDiffLines(file.diff ?? '');
      return fileSum + additions + deletions;
    }, 0);
    return sum + mrTestLines;
  }, 0);
}

const INIT_LIKE_PATTERN =
  /\b(init|initial|bootstrap|boilerplate|scaffold|setup|starter|template|skeleton|프로젝트\s*초기|초기\s*구축|기본\s*구성)\b/i;

function countNewFileLinesChanged(mr: EnrichedMR): number {
  return mr.changes.reduce((sum, file) => {
    if (!file.new_file) return sum;
    const { additions, deletions } = countDiffLines(file.diff ?? '');
    return sum + additions + deletions;
  }, 0);
}

function isInitLikeMR(mr: EnrichedMR): boolean {
  const linesChanged = mr.additions + mr.deletions;
  if (linesChanged === 0) return false;

  const text = [
    mr.mr.title,
    mr.mr.source_branch,
    ...mr.commits.flatMap((commit) => [commit.title, commit.message]),
  ].join('\n');
  const newFileLineRatio = countNewFileLinesChanged(mr) / linesChanged;

  if (INIT_LIKE_PATTERN.test(text)) {
    return linesChanged >= SCORE_SCALE.oversizedMRLines || newFileLineRatio >= 0.5;
  }

  // 제목에 init 힌트가 없어도, 대량 신규 파일 추가는 초기 구축/스캐폴딩일 가능성이 높습니다.
  return linesChanged >= SCORE_SCALE.oversizedMRLines * 2 && newFileLineRatio >= 0.8;
}

function calculateWorkloadLineStats(mrs: EnrichedMR[]): {
  effectiveWorkloadLinesChanged: number;
  initLikeMRs: number;
  initLikeLinesChanged: number;
} {
  return mrs.reduce(
    (acc, mr) => {
      const linesChanged = mr.additions + mr.deletions;
      const cappedLines = Math.min(linesChanged, SCORE_SCALE.workloadMRLineCap);
      if (isInitLikeMR(mr)) {
        acc.initLikeMRs++;
        acc.initLikeLinesChanged += linesChanged;
        acc.effectiveWorkloadLinesChanged +=
          cappedLines * SCORE_SCALE.initLikeWorkloadLineMultiplier;
      } else {
        acc.effectiveWorkloadLinesChanged += cappedLines;
      }
      return acc;
    },
    { effectiveWorkloadLinesChanged: 0, initLikeMRs: 0, initLikeLinesChanged: 0 },
  );
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
  const authorStats = [...mrsByAuthor.values()].map((mrs) => ({
    totalMRs: mrs.length,
    effectiveWorkloadLinesChanged: calculateWorkloadLineStats(mrs).effectiveWorkloadLinesChanged,
  }));
  const maxMRs = Math.max(0, ...authorStats.map((s) => s.totalMRs));
  const maxEffectiveWorkloadLinesChanged = Math.max(
    0,
    ...authorStats.map((s) => s.effectiveWorkloadLinesChanged),
  );

  for (const [username, mrs] of mrsByAuthor.entries()) {
    const totalMRs = mrs.length;
    const mergedMRs = mrs.filter((m) => m.mr.state === 'merged').length;
    const closedWithoutMerge = mrs.filter((m) => m.mr.state === 'closed').length;

    const totalLinesChanged = mrs.reduce((s, m) => s + m.additions + m.deletions, 0);
    const avgLinesChangedPerMR = totalMRs ? totalLinesChanged / totalMRs : 0;
    const { effectiveWorkloadLinesChanged, initLikeMRs, initLikeLinesChanged } =
      calculateWorkloadLineStats(mrs);
    const totalTestLinesChanged = countTestLinesChanged(mrs);
    const testChangeRatio = totalLinesChanged > 0 ? totalTestLinesChanged / totalLinesChanged : 0;

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
    const pipelineCoverageRate = totalMRs ? pipelineEvaluatedMRs / totalMRs : 0;

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
    const lowOversizedMRRatioScore = normalizeInverse(
      oversizedMRRatio,
      SCORE_SCALE.oversizedMRRatio,
    );

    const components: Array<{
      key: keyof DeveloperScoreBreakdown;
      weight: number;
      score: number;
    }> = [
      { key: 'lowRevertRatio', weight: QUALITY_WEIGHTS.lowRevertRatio, score: lowRevertRatioScore },
      {
        key: 'lowOversizedMRRatio',
        weight: QUALITY_WEIGHTS.lowOversizedMRRatio,
        score: lowOversizedMRRatioScore,
      },
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

    const pipelineFirstTryScore = mrsWithPipeline.length > 0 ? pipelineFirstTrySuccessRate : null;

    let lowCommentDensityScore: number | null = null;
    let lowUnresolvedCommentsScore: number | null = null;
    let testChangeCoverageScore: number | null = null;
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

      lowUnresolvedCommentsScore = normalizeInverse(
        unresolvedReviewCommentsPer100Lines,
        SCORE_SCALE.unresolvedCommentDensity,
      );
      components.push({
        key: 'lowUnresolvedComments',
        weight: QUALITY_WEIGHTS.lowUnresolvedComments,
        score: lowUnresolvedCommentsScore,
      });

      testChangeCoverageScore = clamp01(testChangeRatio / SCORE_SCALE.testChangeRatioTarget);
      components.push({
        key: 'testChangeCoverage',
        weight: QUALITY_WEIGHTS.testChangeCoverage,
        score: testChangeCoverageScore,
      });
    }

    const appliedWeight = components.reduce((s, c) => s + c.weight, 0);
    const weightedScore = components.reduce((s, c) => s + c.weight * c.score, 0);
    const qualityScore = appliedWeight > 0 ? 100 * (weightedScore / appliedWeight) : 0;
    const scoreCoverageRate = TOTAL_WEIGHT > 0 ? appliedWeight / TOTAL_WEIGHT : 0;
    const { confidenceScore, confidenceLevel } = calculateConfidence(totalMRs, scoreCoverageRate);
    const workloadScore = calculateWorkloadScore(
      totalMRs,
      effectiveWorkloadLinesChanged,
      maxMRs,
      maxEffectiveWorkloadLinesChanged,
    );
    const platformReadinessScore = calculatePlatformReadinessScore(qualityScore, workloadScore);
    const dataWarnings = [
      ...(totalLinesChanged > 0 && testChangeRatio === 0 ? ['테스트 변경 라인이 없음'] : []),
      ...(oversizedMRRatio >= 0.2
        ? [`대형 MR 비율이 ${(oversizedMRRatio * 100).toFixed(1)}%로 높음`]
        : []),
      ...(unresolvedReviewCommentsPer100Lines >= 0.25
        ? [
            `100줄당 미해결 코멘트가 ${unresolvedReviewCommentsPer100Lines.toFixed(
              2,
            )}개로 높음`,
          ]
        : []),
      ...(initLikeMRs > 0
        ? [`초기 구축성 MR ${initLikeMRs}개의 라인 기여도 축소`]
        : []),
    ];

    result.push({
      username,
      name: mrs[0]?.mr.author.name ?? username,
      totalMRs,
      mergedMRs,
      closedWithoutMerge,
      mergeRate,
      totalLinesChanged,
      avgLinesChangedPerMR,
      effectiveWorkloadLinesChanged: round1(effectiveWorkloadLinesChanged),
      initLikeMRs,
      initLikeLinesChanged,
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
      pipelineCoverageRate,
      pipelineFirstTrySuccessRate,
      totalCommits,
      revertCommits,
      revertCommitRatio,
      oversizedMRs,
      oversizedMRRatio,
      totalTestLinesChanged,
      testChangeRatio,
      avgHoursToMerge,
      scoreBreakdown: {
        lowReReview: lowReReviewScore === null ? null : scoreTo100(lowReReviewScore),
        pipelineFirstTry: pipelineFirstTryScore === null ? null : scoreTo100(pipelineFirstTryScore),
        lowCommentDensity:
          lowCommentDensityScore === null ? null : scoreTo100(lowCommentDensityScore),
        lowUnresolvedComments:
          lowUnresolvedCommentsScore === null ? null : scoreTo100(lowUnresolvedCommentsScore),
        lowRevertRatio: scoreTo100(lowRevertRatioScore),
        lowOversizedMRRatio: scoreTo100(lowOversizedMRRatioScore),
        testChangeCoverage:
          testChangeCoverageScore === null ? null : scoreTo100(testChangeCoverageScore),
      },
      scoreCoverageRate: round1(scoreCoverageRate * 100),
      confidenceScore,
      confidenceLevel,
      workloadScore,
      platformReadinessScore,
      dataWarnings,
      qualityScore: round1(qualityScore),
    });
  }

  return result.sort((a, b) => {
    if (b.platformReadinessScore !== a.platformReadinessScore) {
      return b.platformReadinessScore - a.platformReadinessScore;
    }
    if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    return b.confidenceScore - a.confidenceScore;
  });
}

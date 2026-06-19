import { writeFileSync } from 'node:fs';
import type { DeveloperMetrics } from './types.js';

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function printConsoleTable(metrics: DeveloperMetrics[]): void {
  console.log('\n=== 개발자별 MR 품질/작업량 지표 (platformReadinessScore 내림차순) ===\n');
  console.table(
    metrics.map((m) => ({
      개발자: m.name,
      MR수: m.totalMRs,
      신뢰도: `${m.confidenceLevel}(${m.confidenceScore.toFixed(1)})`,
      선별점수: m.platformReadinessScore,
      품질점수: m.qualityScore,
      작업량점수: m.workloadScore,
      작업량반영라인: m.effectiveWorkloadLinesChanged,
      초기구축MR: m.initLikeMRs,
      '머지율(%)': (m.mergeRate * 100).toFixed(1),
      '재논의비율(%)': (m.reReviewedThreadRatio * 100).toFixed(1),
      리뷰스레드: m.totalReviewThreads,
      평균리뷰후Push: m.avgPostReviewPushCountPerMR.toFixed(2),
      '파이프라인1차성공률(%)': (m.pipelineFirstTrySuccessRate * 100).toFixed(1),
      파이프라인평가MR: m.pipelineEvaluatedMRs,
      'CI커버리지(%)': (m.pipelineCoverageRate * 100).toFixed(1),
      '100줄당코멘트수': m.reviewCommentsPer100Lines.toFixed(2),
      '100줄당미해결코멘트': m.unresolvedReviewCommentsPer100Lines.toFixed(2),
      'Revert비율(%)': (m.revertCommitRatio * 100).toFixed(1),
      '대형MR비율(%)': (m.oversizedMRRatio * 100).toFixed(1),
      '테스트변경비율(%)': (m.testChangeRatio * 100).toFixed(1),
      '평균머지소요(h)': m.avgHoursToMerge?.toFixed(1) ?? '-',
      '점수커버리지(%)': m.scoreCoverageRate.toFixed(1),
      경고: m.dataWarnings.join(' / ') || '-',
    })),
  );
}

export function writeCsv(metrics: DeveloperMetrics[], path: string): void {
  const headers = [
    'username',
    'name',
    'totalMRs',
    'mergedMRs',
    'closedWithoutMerge',
    'mergeRate',
    'totalLinesChanged',
    'avgLinesChangedPerMR',
    'effectiveWorkloadLinesChanged',
    'initLikeMRs',
    'initLikeLinesChanged',
    'totalReviewComments',
    'avgReviewCommentsPerMR',
    'reviewCommentsPer100Lines',
    'unresolvedReviewComments',
    'unresolvedReviewCommentsPer100Lines',
    'totalPushCount',
    'avgPushCountPerMR',
    'totalPostReviewPushCount',
    'avgPostReviewPushCountPerMR',
    'totalReviewThreads',
    'reReviewedThreads',
    'reReviewedThreadRatio',
    'pipelineEvaluatedMRs',
    'pipelineMissingMRs',
    'pipelineCoverageRate',
    'pipelineFirstTrySuccessRate',
    'totalCommits',
    'revertCommits',
    'revertCommitRatio',
    'oversizedMRs',
    'oversizedMRRatio',
    'totalTestLinesChanged',
    'testChangeRatio',
    'avgHoursToMerge',
    'scoreBreakdown.lowReReview',
    'scoreBreakdown.pipelineFirstTry',
    'scoreBreakdown.lowCommentDensity',
    'scoreBreakdown.lowUnresolvedComments',
    'scoreBreakdown.lowRevertRatio',
    'scoreBreakdown.lowOversizedMRRatio',
    'scoreBreakdown.testChangeCoverage',
    'scoreCoverageRate',
    'confidenceScore',
    'confidenceLevel',
    'workloadScore',
    'platformReadinessScore',
    'dataWarnings',
    'qualityScore',
  ];

  const rows = metrics.map((m) =>
    headers
      .map((h) => {
        if (h.startsWith('scoreBreakdown.')) {
          const key = h.split('.')[1] as keyof DeveloperMetrics['scoreBreakdown'];
          return csvEscape(m.scoreBreakdown[key]);
        }
        if (h === 'dataWarnings') {
          return csvEscape(m.dataWarnings.join(' | '));
        }
        const v = (m as unknown as Record<string, unknown>)[h];
        return csvEscape(v);
      })
      .join(','),
  );

  writeFileSync(path, [headers.join(','), ...rows].join('\n'), 'utf-8');
}

export function writeJson(metrics: DeveloperMetrics[], path: string): void {
  writeFileSync(path, JSON.stringify(metrics, null, 2), 'utf-8');
}

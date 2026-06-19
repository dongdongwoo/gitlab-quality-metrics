import { writeFileSync } from 'node:fs';
import type { DeveloperMetrics } from './types.js';

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function printConsoleTable(metrics: DeveloperMetrics[]): void {
  console.log('\n=== 개발자별 MR 품질 지표 (qualityScore 내림차순) ===\n');
  console.table(
    metrics.map((m) => ({
      개발자: m.name,
      MR수: m.totalMRs,
      신뢰도: `${m.confidenceLevel}(${m.confidenceScore.toFixed(1)})`,
      '머지율(%)': (m.mergeRate * 100).toFixed(1),
      '재논의비율(%)': (m.reReviewedThreadRatio * 100).toFixed(1),
      리뷰스레드: m.totalReviewThreads,
      평균리뷰후Push: m.avgPostReviewPushCountPerMR.toFixed(2),
      '파이프라인1차성공률(%)': (m.pipelineFirstTrySuccessRate * 100).toFixed(1),
      파이프라인평가MR: m.pipelineEvaluatedMRs,
      '100줄당코멘트수': m.reviewCommentsPer100Lines.toFixed(2),
      '100줄당미해결코멘트': m.unresolvedReviewCommentsPer100Lines.toFixed(2),
      'Revert비율(%)': (m.revertCommitRatio * 100).toFixed(1),
      '대형MR비율(%)': (m.oversizedMRRatio * 100).toFixed(1),
      '평균머지소요(h)': m.avgHoursToMerge?.toFixed(1) ?? '-',
      '점수커버리지(%)': m.scoreCoverageRate.toFixed(1),
      종합점수: m.qualityScore,
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
    'pipelineFirstTrySuccessRate',
    'totalCommits',
    'revertCommits',
    'revertCommitRatio',
    'oversizedMRs',
    'oversizedMRRatio',
    'avgHoursToMerge',
    'scoreBreakdown.lowReReview',
    'scoreBreakdown.pipelineFirstTry',
    'scoreBreakdown.lowCommentDensity',
    'scoreBreakdown.lowRevertRatio',
    'scoreCoverageRate',
    'confidenceScore',
    'confidenceLevel',
    'qualityScore',
  ];

  const rows = metrics.map((m) =>
    headers
      .map((h) => {
        if (h.startsWith('scoreBreakdown.')) {
          const key = h.split('.')[1] as keyof DeveloperMetrics['scoreBreakdown'];
          return csvEscape(m.scoreBreakdown[key]);
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

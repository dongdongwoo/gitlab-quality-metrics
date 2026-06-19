# gitlab-quality-metrics

GitLab의 MR(Merge Request) 데이터를 기반으로 개발자별 코드 퀄리티 지표를 뽑아주는 CLI 스크립트입니다.
외주/내부 개발자들의 작업물을 기간별로 비교 평가할 때 쓰는 걸 목표로 만들었습니다.

## 1. 설치

```bash
npm install
cp .env.example .env   # 그 다음 .env에 실제 GITLAB_URL, GITLAB_TOKEN, GITLAB_PROJECTS 입력
```

`GITLAB_TOKEN`은 GitLab > Settings > Access Tokens 에서 발급합니다.
조회만 할 거면 `read_api` scope로 충분합니다.

`GITLAB_PROJECTS`에 자주 쓰는 프로젝트를 기본값으로 넣어두면 매번 `--projects`를 안 줘도 됩니다 (아래 2번 참고).

## 2. 실행

```bash
npx tsx src/index.ts \
  --projects=123,456 \
  --since=2026-04-01 \
  --until=2026-06-18 \
  --authors=dev_a,dev_b \
  --out=report
```

- `--projects`: project ID 또는 `group/repo` 경로. 여러 개면 쉼표로 구분 (외주팀이 여러 레포에 걸쳐 작업했다면 전부 넣으면 됩니다). **생략하면 `.env`의 `GITLAB_PROJECTS` 값을 대신 사용합니다.** 둘 다 있으면 `--projects`가 우선합니다.
- `--since` / `--until`: MR 생성일 기준 기간 필터 (생략 가능)
- `--authors`: 특정 개발자만 보고 싶을 때 username 필터 (생략 시 전체)
- `--out`: 결과 파일 접두사. `report.csv`, `report.json`이 생성됩니다.
- `--exclude-source-pattern` / `--exclude-target-pattern`: 특정 source/target 브랜치 조합의 MR을 평가에서 제외 (자세한 사용법은 아래 "특정 브랜치 MR 제외하기" 참고).

`.env`에 `GITLAB_PROJECTS=dap-team/lending-platform`을 넣어뒀다면 가장 단순한 실행은 이렇게 됩니다:

```bash
npx tsx src/index.ts --out=report
```

### 특정 브랜치 MR 제외하기 (예: 스프린트 통합 MR)

`sprint1-dev`, `sprint2-dev` 같은 스프린트 브랜치를 `dev`로 통합 머지하는 MR은 여러 개발자의 코드가 한꺼번에 섞이는 "통합/리뷰용 MR"이라, 특정 개인의 퀄리티 지표로 잡으면 왜곡이 생깁니다. **이런 `sprintN-dev → dev` MR만 골라서 집계에서 빼고 싶을 때** 아래 두 옵션을 씁니다.

- `--exclude-source-pattern`: source 브랜치(머지를 보내는 쪽)에 매칭할 정규식
- `--exclude-target-pattern`: target 브랜치(머지를 받는 쪽)에 매칭할 정규식
- 둘 다 정규식이고, **둘 다 지정하면 두 조건을 모두 만족하는 MR만** 제외합니다 (AND). 하나만 주면 그 조건만으로 판단합니다.

스프린트 브랜치 → `dev` MR 제외 명령은 다음과 같습니다:

```bash
npx tsx src/index.ts \
  --projects=123 \
  --exclude-source-pattern='^sprint\d+-dev$' \
  --exclude-target-pattern='^dev$' \
  --out=report
```

- `^sprint\d+-dev$` 는 `sprint1-dev`, `sprint2-dev`, `sprint10-dev` 처럼 `sprint` + 숫자 + `-dev` 형태의 브랜치를 모두 매칭합니다.
- `^dev$` 는 target이 정확히 `dev`인 경우만 매칭합니다.
- 따라서 `sprintN-dev → dev` 형태의 통합 MR만 빠지고, 스프린트 기간 동안 각 개발자가 `feature/* → sprintN-dev`로 올린 개별 MR들은 그대로 집계됩니다.
- 실행 시 `[프로젝트] 브랜치 패턴에 의해 N개 MR 제외됨` 로그로 실제로 몇 개가 빠졌는지 확인할 수 있습니다.

브랜치 네이밍이 다르면 정규식만 바꾸면 됩니다. 예를 들어 target이 `dev`가 아니라 `develop`이거나, source가 `release/*`라면 그에 맞게 패턴을 조정하세요.

빌드해서 쓰고 싶으면 `npm run build && npm start -- --projects=...` 도 가능합니다.

## 3. 지표 설명

지표는 역할에 따라 **① 품질 점수 / ② 작업량 점수 / ③ 선별 점수 / ④ 참고 / ⑤ 신뢰도** 로 나뉩니다.
`qualityScore`는 코드 품질 신호만 엄격하게 보고, `workloadScore`는 같은 리포트 기간 안에서 작업량을 상대 비교합니다. 최종 후보 판단에는 둘을 합친 `platformReadinessScore`를 씁니다.

### ① 품질 점수 (qualityScore 구성)


| 지표                                  | 의미                                                       | 좋은 신호 | 가중치  |
| ----------------------------------- | -------------------------------------------------------- | ----- | ---- |
| reReviewedThreadRatio               | **재논의** 스레드 비율(첫 수정이 부족해 리뷰어가 같은 스레드에 다시 지적한 비율) | 낮을수록  | 0.25 |
| reviewCommentsPer100Lines           | 변경 라인 100줄당 리뷰어 코멘트 수                                   | 낮을수록  | 0.15 |
| unresolvedReviewCommentsPer100Lines | 100줄당 **미해결(resolve 안 됨)** 리뷰 코멘트 수                    | 낮을수록  | 0.25 |
| revertCommitRatio                   | revert/hotfix/rollback 성격 커밋 비율                          | 낮을수록  | 0.10 |
| oversizedMRRatio                    | 변경 800줄 이상(대형) MR의 비율                                   | 낮을수록  | 0.20 |
| testChangeRatio                     | 전체 변경 라인 중 테스트 파일 변경 라인 비율                            | 높을수록  | 0.05 |


가중치는 `src/metrics.ts`의 `QUALITY_WEIGHTS`(합계 1.0)에서, 감점이 시작되는 기준선은 같은 파일의 `SCORE_SCALE`에서 조정합니다.

핵심 설계 의도:

- **재작업은 "push 횟수"가 아니라 "재논의 비율"로 본다.** 단순 push 횟수(`avgPushCountPerMR`, `avgPostReviewPushCountPerMR`)는 리뷰 코멘트를 **일부러 나눠서 깔끔히 처리하는 스타일**까지 감점해 왜곡됩니다. 그래서 점수에는 **리뷰어가 같은 스레드에 다시 와서 "아직 부족하다"는 식으로 코멘트한 비율**(`reReviewedThreadRatio`)만 사용합니다.
  - 재논의 스레드 판정: 리뷰 스레드에서 첫 리뷰어 코멘트 이후의 후속 리뷰어 코멘트 중, 승인/칭찬성(LGTM·"좋습니다" 등 `APPROVAL_NOTE_PATTERN`에 매칭)이 **아닌** 코멘트가 1개 이상 있는 경우. (`SCORE_SCALE.reReviewedThreadRatio = 0.3` → 리뷰 스레드의 30%가 재논의되면 50점 수준)
  - **한계**: GitLab에서 push는 특정 스레드에 묶이지 않아 "이 push가 이 코멘트를 고쳤다"는 직접 연결은 불가능합니다. 또 `APPROVAL_NOTE_PATTERN`은 코멘트 언어/말투에 의존하는 휴리스틱이라, 실제 리뷰 언어(영어·폴란드어 등)에 맞게 점검·보강해야 합니다. push 관련 지표는 참고용으로 계속 출력됩니다.
- **코멘트는 "0개가 좋다"가 아니다.** 100줄당 리뷰 코멘트 0.5개까지는 건강한 리뷰 활동으로 보고 감점하지 않습니다(`SCORE_SCALE.commentDensityFreeAllowance = 0.5`). 그 이상으로 **과도하게 많을 때만** 감점합니다. 코멘트 0개는 리뷰가 부실했다는 신호일 수도 있으니 좋게만 보지 않습니다.
- **미해결 코멘트와 대형 MR은 Platform 후보 기준에서 더 강하게 본다.** `unresolvedReviewCommentsPer100Lines`는 실제로 처리되지 않은 품질 이슈에 가깝고, `oversizedMRRatio`는 리뷰 가능한 단위로 쪼개는 능력을 보여주므로 점수 항목으로 승격했습니다.
- **테스트 변경 비율은 작은 가중치로만 반영한다.** 모든 변경에 테스트가 필요한 것은 아니므로 `testChangeRatio`는 5% 가중치만 둡니다. 전체 변경 라인 중 테스트 변경이 20% 이상이면 이 항목은 만점입니다.
- **CI는 현재 점수에서 제외한다.** `pipelineFirstTrySuccessRate`와 `pipelineCoverageRate`는 출력하지만, 현재 프로젝트처럼 MR pipeline 데이터가 없는 경우가 많으면 품질 점수를 왜곡하므로 `qualityScore`에는 넣지 않습니다.
- **mergeRate는 점수에서 제외.** 스프린트 종료 시점엔 품질과 무관하게 거의 모든 MR이 머지되므로 변별력이 없습니다. 지표 자체는 참고용으로 계속 출력됩니다.

### ② 작업량 점수 (workloadScore)

`workloadScore`는 같은 리포트에 포함된 개발자들끼리 **기간 내 작업량**을 상대 비교한 0~100 점수입니다.

| 구성 요소 | 의미 | 반영 비중 |
| -------- | ---- | -------- |
| totalMRs | 기간 내 MR 수. 일을 얼마나 자주 쪼개서 올렸는지 봅니다. | 55% |
| effectiveWorkloadLinesChanged | 기간 내 변경 라인을 보정한 값. 작업량 점수에 실제 반영됩니다. | 45% |

최댓값 대비 단순 비율을 그대로 쓰면 상위 1명이 점수를 독식할 수 있어, `sqrt(value / cohortMax)`로 완만하게 정규화합니다. 즉 같은 기간에 MR도 많이 올리고 변경량도 충분한 사람은 더 높은 작업량 점수를 받습니다.

라인 수는 원본 `totalLinesChanged`를 그대로 쓰지 않습니다. 초기 구축이나 대량 보일러플레이트가 작업량을 과대평가하지 않도록 아래처럼 보정합니다.

- MR 1개가 작업량 라인을 독식하지 않도록 MR별 최대 `800`줄까지만 반영합니다.
- 제목/브랜치/커밋에 `init`, `initial`, `bootstrap`, `boilerplate`, `scaffold`, `setup`, `template` 등의 신호가 있고 대량 신규 파일 추가 성격이면 초기 구축성 MR로 봅니다.
- 초기 구축성 MR은 capped line의 `25%`만 `effectiveWorkloadLinesChanged`에 반영합니다.
- 원본 변경량은 `totalLinesChanged`, 작업량 점수에 반영된 변경량은 `effectiveWorkloadLinesChanged`로 따로 출력합니다.

### ③ 선별 점수 (platformReadinessScore)

`platformReadinessScore = qualityScore × 0.65 + workloadScore × 0.35` 입니다.

의도는 단순합니다. 코드 품질이 먼저지만, **비슷한 품질이라면 더 많은 MR과 코드 변경을 안정적으로 낸 사람이 Platform squad 후보로 더 강한 신호**입니다.

### ④ 참고 지표 (점수 제외, 맥락 파악용)


| 지표                          | 의미                     | 비고                                   |
| --------------------------- | ---------------------- | ------------------------------------ |
| mergeRate                   | 전체 MR 중 머지된 비율         | 대부분 머지되는 조직에선 변별력 낮음                 |
| pipelineFirstTrySuccessRate | 첫 CI 파이프라인 성공률         | 현재는 점수 제외. CI 운영이 안정되면 다시 점수화 가능      |
| pipelineCoverageRate        | CI 평가 가능 MR 비율           | 현재는 점수 제외. CI 데이터 신뢰도 확인용             |
| avgHoursToMerge             | 생성→머지 평균 소요 시간         | 리뷰어 지연/일정/승인 정책 영향이 커서 참고만           |
| avgLinesChangedPerMR        | MR당 평균 변경 라인           | MR 크기 감안용                            |
| avgPushCountPerMR           | MR당 전체 추가 push 평균      | 리뷰 전 self-push 포함이라 점수엔 미사용          |
| avgPostReviewPushCountPerMR | MR당 첫 리뷰 이후 push 평균    | 재작업 참고용. 점수는 스레드 기반 재논의 비율로 대체됨       |
| dataWarnings                | 테스트 변경/대형 MR/미해결 코멘트 경고 | 점수 해석 시 함께 봐야 하는 정량 경고               |


### ⑤ 신뢰도 지표 (점수와 분리해서 함께 봐야 함)


| 지표                | 의미                                      |
| ----------------- | --------------------------------------- |
| confidenceScore   | 표본 수(MR 개수)와 데이터 커버리지를 반영한 0~100 신뢰도    |
| confidenceLevel   | `low` / `medium` / `high` 등급            |
| scoreCoverageRate | 실제 점수 계산에 사용된 가중치 비율(%). 100%에 가까울수록 충분 |


- MR이 1~2개뿐인 개발자는 우연히 높은 점수가 나올 수 있습니다. 이를 막되 점수를 인위적으로 깎지 않도록, **신뢰도는 `qualityScore`에 곱하지 않고 별도 칼럼으로** 제공합니다.
- `confidenceScore = 표본계수 × 커버리지계수 × 100`. 표본계수는 MR 수(≥10:1.0, ≥5:0.8, ≥3:0.6, ≥1:0.4), 커버리지계수는 측정된 지표 비중(`0.5 + 0.5 × scoreCoverageRate`)으로 계산합니다.
- **`confidenceLevel`이 다른 개발자끼리 점수를 직접 비교하지 마세요.** (예: high 등급 80점 vs low 등급 95점 → low 쪽이 더 낫다고 단정 불가)

### 점수 계산 방식 (데이터 없으면 자동 제외)

데이터가 없어 측정 불가능한 지표는 0점으로 깎는 대신 **점수 계산에서 빼고, 적용된 가중치 합으로만 정규화**합니다. 그래서 `scoreCoverageRate`가 같이 표시됩니다.

- 리뷰어 코멘트가 달린 스레드가 하나도 없으면(아무도 리뷰 안 함) `reReviewedThreadRatio`를 측정할 수 없어 → 해당 가중치(0.25) 제외.
- diff(변경 라인) 정보가 없으면 코멘트 밀도, 미해결 코멘트 밀도, 테스트 변경 비율 제외.
- 이렇게 하면 "데이터 없음"과 "측정했는데 0점"이 구분되어, 특정 데이터가 없는 팀이 전원 0점으로 깎이는 왜곡이 사라집니다. 단, 커버리지가 낮은 점수는 그만큼 신뢰도가 떨어지므로 `scoreCoverageRate` / `confidenceLevel`과 함께 해석하세요.

### `report.json` 빠르게 읽는 법

후보를 고를 때는 모든 필드를 한 번에 보지 말고 아래 순서로 보면 됩니다.

1. `confidenceLevel`, `confidenceScore`, `scoreCoverageRate`로 비교 가능한 데이터인지 먼저 확인합니다.
2. `platformReadinessScore`로 후보 순서를 봅니다.
3. `qualityScore`와 `workloadScore`를 나눠 봅니다. 품질은 괜찮지만 작업량이 적은지, 작업량은 많은데 품질 리스크가 있는지 구분합니다.
4. `dataWarnings`가 비어 있는지 확인합니다. 경고가 있으면 점수가 높아도 해석을 보류합니다.
5. `scoreBreakdown`에서 어떤 품질 항목 때문에 높거나 낮은지 확인합니다.
6. 마지막으로 `totalMRs`, `avgLinesChangedPerMR`, `oversizedMRRatio`로 작업 규모와 MR 분할 습관을 봅니다.

Platform squad 후보 필터로는 대략 `confidenceLevel >= medium`, `totalMRs >= 5`, `scoreCoverageRate >= 80`, `qualityScore >= 70`, `workloadScore >= 50`, `platformReadinessScore >= 75`, `dataWarnings` 없음 또는 설명 가능한 수준을 권장합니다.

### 핵심 판단 필드

| 필드 | 읽는 법 |
| --- | --- |
| `platformReadinessScore` | Platform squad 후보 선별용 점수입니다. 품질 65%, 작업량 35%를 반영합니다. |
| `qualityScore` | 0~100 품질 점수입니다. 높을수록 좋지만 작업량은 반영하지 않습니다. |
| `workloadScore` | 같은 리포트 기간/대상 내 작업량 상대 점수입니다. MR 수와 보정된 변경 라인을 함께 봅니다. |
| `confidenceLevel` / `confidenceScore` | 표본 수와 데이터 커버리지 기반 신뢰도. `low`는 점수가 높아도 직접 비교하지 않습니다. |
| `scoreCoverageRate` | 품질 점수 계산에 실제로 사용된 가중치 비율. 리뷰나 diff 데이터가 빠지면 낮아집니다. |
| `dataWarnings` | 테스트 변경 없음, 대형 MR 비율 높음, 미해결 코멘트 많음 같은 해석 경고입니다. |
| `scoreBreakdown` | 품질 점수를 구성한 항목별 0~100 점수입니다. 어떤 약점 때문에 점수가 낮은지 보는 용도입니다. |

### 품질 신호 필드

| 필드 | 좋은 신호 | 의미 |
| --- | --- | --- |
| `reReviewedThreadRatio` | 낮음 | 첫 수정이 부족해 같은 리뷰 스레드에서 다시 지적받은 비율입니다. |
| `pipelineFirstTrySuccessRate` | 높음 | 첫 CI 파이프라인이 바로 성공한 비율입니다. 현재는 품질 점수에서 제외하고 참고만 합니다. |
| `reviewCommentsPer100Lines` | 너무 높지 않음 | 변경 100줄당 리뷰 코멘트 수입니다. 1개까지는 건강한 리뷰 활동으로 봅니다. |
| `unresolvedReviewCommentsPer100Lines` | 낮음 | 해결되지 않은 리뷰 코멘트 밀도입니다. 실제 품질 리스크에 가깝습니다. |
| `revertCommitRatio` | 낮음 | revert/hotfix/rollback 성격 커밋 비율입니다. |
| `oversizedMRRatio` | 낮음 | 800줄 이상 대형 MR 비율입니다. MR 분할 능력과 리뷰 가능성을 봅니다. |
| `testChangeRatio` | 높음 | 전체 변경 라인 중 테스트 파일 변경 비율입니다. 모든 MR에 테스트가 필요한 것은 아니므로 보조적으로 봅니다. |

### 규모와 맥락 필드

| 필드 | 의미 |
| --- | --- |
| `username` / `name` | GitLab 사용자명 / 표시 이름입니다. |
| `totalMRs` | 집계 대상 MR 수입니다. 표본 수가 적으면 점수가 쉽게 흔들립니다. |
| `mergedMRs` / `closedWithoutMerge` / `mergeRate` | 머지/닫힘 현황입니다. 대부분 머지되는 조직에서는 품질 변별력이 낮습니다. |
| `totalLinesChanged` / `avgLinesChangedPerMR` | 전체 변경 라인과 MR당 평균 변경 라인입니다. 작업 규모와 MR 크기를 보는 맥락 지표입니다. |
| `effectiveWorkloadLinesChanged` | 작업량 점수에 실제 반영된 변경 라인입니다. MR별 cap과 초기 구축성 MR 감산이 적용됩니다. |
| `initLikeMRs` / `initLikeLinesChanged` | 초기 구축/스캐폴딩 성격으로 감산된 MR 수와 원본 변경 라인입니다. |
| `avgHoursToMerge` | 생성부터 머지까지 평균 시간입니다. 리뷰어 지연이나 일정 영향이 커서 참고용입니다. |

### 원시 카운트 필드

비율 필드를 검산하거나 이상치를 확인할 때 보는 원본 값입니다.

| 필드 | 의미 |
| --- | --- |
| `totalReviewComments` / `avgReviewCommentsPerMR` | 타인이 남긴 리뷰 코멘트 수와 MR당 평균입니다. |
| `unresolvedReviewComments` | 해결되지 않은 리뷰 코멘트 수입니다. |
| `totalReviewThreads` / `reReviewedThreads` | 리뷰 스레드 수와 재논의된 스레드 수입니다. |
| `pipelineEvaluatedMRs` / `pipelineMissingMRs` / `pipelineCoverageRate` | CI 평가 가능 MR 수, CI 데이터가 없는 MR 수, 평가 가능 비율입니다. |
| `totalCommits` / `revertCommits` | 전체 커밋 수와 revert/hotfix/rollback 성격 커밋 수입니다. |
| `oversizedMRs` | 800줄 이상 대형 MR 수입니다. |
| `totalTestLinesChanged` | 테스트 파일에서 변경된 라인 수입니다. |
| `totalPushCount` / `avgPushCountPerMR` | 전체 추가 push 수와 MR당 평균입니다. 리뷰 전 push도 포함되므로 참고용입니다. |
| `totalPostReviewPushCount` / `avgPostReviewPushCountPerMR` | 첫 리뷰 이후 push 수와 MR당 평균입니다. 재작업 맥락을 볼 때 참고합니다. |


## 4. 파일 구조

```
src/
  types.ts        GitLab API 응답 및 내부 타입(EnrichedMR, DeveloperMetrics 등)
  gitlabClient.ts API 호출 (페이지네이션, 동시성 제어)
  metrics.ts      지표 계산 로직 (diff 라인, 리뷰 이후 push, 코멘트 밀도, 종합 점수, 신뢰도)
  branchFilter.ts source/target 브랜치 패턴으로 평가 제외 MR 필터링
  output.ts       콘솔 테이블 / CSV / JSON 출력
  index.ts        CLI 진입점
mock-server.ts    실제 GitLab 없이 로직을 테스트해볼 수 있는 가짜 서버
```

`mock-server.ts`로 로직만 먼저 검증해보고 싶으면:

```bash
npx tsx mock-server.ts &
GITLAB_URL=http://localhost:4567 GITLAB_TOKEN=dummy npx tsx src/index.ts --projects=1
```


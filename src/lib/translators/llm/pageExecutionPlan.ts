import type {
  PageTranslationBatchRequest,
  TranslationValidationFailure,
  TranslationTarget,
} from '@/lib/pageTranslation/protocol';

export type PageExecutionStage = NonNullable<PageTranslationBatchRequest['retryStage']>;
export type PageExecutionContextMode = 'normal' | 'without-retrieved' | 'rich';

export interface PageExecutionPlanAttempt {
  readonly stage: PageExecutionStage;
  readonly contextMode: PageExecutionContextMode;
  readonly targetIds: readonly string[];
  readonly translations?: readonly { id: string; target: string }[];
  readonly issues?: readonly {
    id?: string;
    failure: TranslationValidationFailure;
  }[];
  readonly rawResponse?: string;
  /** Parsed content, when the response parser did not retain the raw body. */
  readonly content?: string;
  /** A fetch-level failure after transport retries were exhausted. */
  readonly error?: unknown;
}

export interface PageExecutionPlanPolicy {
  readonly maxRetries: number;
  readonly retryWithSmallerBatch: boolean;
  readonly retryWithoutRetrievedContext: boolean;
  readonly retryWithRicherLocalContext: boolean;
}

export type PageExecutionPlan =
  | {
      readonly kind: 'attempt';
      readonly stage: PageExecutionStage;
      readonly contextMode: PageExecutionContextMode;
      readonly targets: readonly TranslationTarget[];
    }
  | {
      readonly kind: 'terminal';
      readonly reason: 'success' | 'exhausted' | 'incompatible-model' | 'budget';
    };

const isEmptyContentAttempt = (attempt: PageExecutionPlanAttempt): boolean => {
  const content = attempt.rawResponse ?? attempt.content;
  return content !== undefined && content.trim() === '';
};

const hasSuccessfulTranslation = (
  history: readonly PageExecutionPlanAttempt[],
  targetId: string,
): boolean =>
  history.some((attempt) =>
    attempt.translations?.some((translation) => translation.id === targetId),
  );

const hasAttemptedTarget = (
  history: readonly PageExecutionPlanAttempt[],
  targetId: string,
): boolean => history.some((attempt) => attempt.targetIds.includes(targetId));

const failureKindsForTarget = (
  history: readonly PageExecutionPlanAttempt[],
  targetId: string,
): Set<TranslationValidationFailure> => {
  const failures = new Set<TranslationValidationFailure>();
  for (const attempt of history) {
    for (const issue of attempt.issues ?? []) {
      if (issue.id === targetId) failures.add(issue.failure);
    }
  }
  return failures;
};

const stagesForTarget = (
  failures: ReadonlySet<TranslationValidationFailure>,
  policy: PageExecutionPlanPolicy,
): readonly { stage: PageExecutionStage; contextMode: PageExecutionContextMode }[] => {
  if (failures.has('language-mismatch') && policy.retryWithRicherLocalContext) {
    return [{ stage: 'rich-context', contextMode: 'rich' }];
  }

  const stages: { stage: PageExecutionStage; contextMode: PageExecutionContextMode }[] =
    [];
  if (policy.retryWithSmallerBatch) {
    stages.push({ stage: 'isolated', contextMode: 'normal' });
  }
  if (policy.retryWithoutRetrievedContext) {
    stages.push({ stage: 'simplified-context', contextMode: 'without-retrieved' });
  }
  if (policy.retryWithRicherLocalContext) {
    stages.push({ stage: 'rich-context', contextMode: 'rich' });
  }
  return stages.slice(0, Math.max(0, policy.maxRetries));
};

const hasBudgetError = (attempt: PageExecutionPlanAttempt): boolean => {
  if (attempt.error === undefined) return false;
  const message =
    attempt.error instanceof Error
      ? attempt.error.message
      : typeof attempt.error === 'string'
        ? attempt.error
        : '';
  return /context window is too small|budget/i.test(message);
};

/**
 * Purely selects the next page-translation action from request state and attempts.
 * Transport retry journal entries are recorded by the engine retry policy; this
 * module owns validation retries, not request transport.
 */
export const planNext = (
  request: PageTranslationBatchRequest,
  attemptHistory: readonly PageExecutionPlanAttempt[],
  policy: PageExecutionPlanPolicy,
): PageExecutionPlan => {
  for (let index = 1; index < attemptHistory.length; index++) {
    const previous = attemptHistory[index - 1];
    const current = attemptHistory[index];
    if (isEmptyContentAttempt(previous) && isEmptyContentAttempt(current)) {
      return { kind: 'terminal', reason: 'incompatible-model' };
    }
  }

  if (attemptHistory.some(hasBudgetError)) {
    return { kind: 'terminal', reason: 'budget' };
  }

  if (attemptHistory.length === 0) {
    return {
      kind: 'attempt',
      stage: request.retryStage ?? 'initial',
      contextMode: 'normal',
      targets: request.targets,
    };
  }

  if (attemptHistory.some((attempt) => attempt.error !== undefined)) {
    return { kind: 'terminal', reason: 'exhausted' };
  }

  if (
    request.targets.every((target) => hasSuccessfulTranslation(attemptHistory, target.id))
  ) {
    return { kind: 'terminal', reason: 'success' };
  }

  const emptyCount = attemptHistory.filter(isEmptyContentAttempt).length;
  if (emptyCount > 0) {
    // An empty response gets one truncation retry. If that retry was non-empty,
    // do not walk the validation ladder against a systematically broken model.
    const lastAttempt = attemptHistory[attemptHistory.length - 1];
    if (!isEmptyContentAttempt(lastAttempt)) {
      return { kind: 'terminal', reason: 'exhausted' };
    }
  }

  const candidates = request.targets.filter(
    (target) =>
      hasAttemptedTarget(attemptHistory, target.id) &&
      !hasSuccessfulTranslation(attemptHistory, target.id),
  );
  const nextSteps = candidates.flatMap((target) => {
    const stages = stagesForTarget(
      failureKindsForTarget(attemptHistory, target.id),
      policy,
    );
    const attemptedStages = new Set(
      attemptHistory
        .filter((attempt) => attempt.targetIds.includes(target.id))
        .map((attempt) => attempt.stage),
    );
    const nextStage = stages.find(({ stage }) => !attemptedStages.has(stage));
    return nextStage === undefined ? [] : [{ target, ...nextStage }];
  });
  const firstStep = nextSteps[0];
  if (firstStep !== undefined) {
    const firstGroup = nextSteps.filter(
      ({ stage, contextMode }) =>
        stage === firstStep.stage && contextMode === firstStep.contextMode,
    );
    const targets = firstGroup.map(({ target }) => target);
    return {
      kind: 'attempt',
      stage: firstStep.stage,
      contextMode: firstStep.contextMode,
      targets,
    };
  }

  return { kind: 'terminal', reason: 'exhausted' };
};

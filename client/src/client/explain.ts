export type ExplainVerbosity = 'queryPlanner' | 'executionStats' | 'allPlansExecution';

export type ExplainOperationType = 'find' | 'findOne' | 'insertOne' | 'updateOne' | 'deleteOne';

export type ExplainStage = 'ID_LOOKUP' | 'INDEX_LOOKUP' | 'COLLECTION_SCAN';

export type ExplainReasonCode =
  | 'missingLeadingField'
  | 'missingNonFinalField'
  | 'unsupportedLookupOperator'
  | 'sortFieldMismatch'
  | 'scoreLowerThanWinner'
  | 'noUsableIndexKeysFromQuery'
  | 'forcedIdLookup'
  | 'scanFallback';

export type ExplainTimingPart =
  | 'planning'
  | 'indexKeyLookup'
  | 'indexEntryRead'
  | 'documentLoad'
  | 'postLoadFilter'
  | 'postLoadSort'
  | 'postLoadLimit'
  | 'scan'
  | 'cache'
  | 'writePersist'
  | 'writeFlush'
  | 'other';

export type ExplainStep =
  | {
      kind: 'op.start';
      opId: string;
      opType: ExplainOperationType;
      namespace: string;
      verbosity: ExplainVerbosity;
      hasSort: boolean;
      hasLimit: boolean;
    }
  | {
      kind: 'plan.candidate';
      opId: string;
      indexName: string;
      score: number;
      accepted: boolean;
      reason?: ExplainReasonCode;
      note?: string;
    }
  | {
      kind: 'plan.winner';
      opId: string;
      stage: ExplainStage;
      indexName?: string;
      scanReason?: string;
    }
  | {
      kind: 'index.keys';
      opId: string;
      indexName: string;
      keyCount: number;
    }
  | {
      kind: 'index.entries.read';
      opId: string;
      indexName: string;
      entryFilesRead: number;
      candidateIds: number;
      uniqueCandidateIds: number;
    }
  | {
      kind: 'docs.loaded';
      opId: string;
      collection: string;
      count: number;
      source: 'idLookup' | 'indexLookup' | 'scan';
    }
  | {
      kind: 'docs.matched';
      opId: string;
      matchedAfterLoad: number;
    }
  | {
      kind: 'sort.limit';
      opId: string;
      sortAppliedAfterLoad: boolean;
      limitAppliedAfterLoad: boolean;
      indexOptimizationUsed: boolean;
      indexOptimizationReason?: string;
    }
  | {
      kind: 'expr.stat';
      opId: string;
      field: string;
      operator: string;
      implemented: boolean;
      appliedAt: 'index' | 'postLoad' | 'notApplied';
      note?: string;
    }
  | {
      kind: 'cache.event';
      opId: string;
      scope: 'collection' | 'index';
      collection: string;
      indexName?: string;
      cacheType: 'file';
      event: 'hit' | 'miss' | 'stale';
    }
  | {
      kind: 'timing.part';
      opId: string;
      part: ExplainTimingPart;
      durationMs: number;
      count?: number;
    }
  | {
      kind: 'write.cost';
      opId: string;
      documentWrites: number;
      indexMetadataWrites: number;
      indexEntryUpdatesCount: number;
      indexEntryFilesUpdated: string[];
      flushWaitMs?: number;
    }
  | {
      kind: 'op.end';
      opId: string;
      ok: boolean;
      durationMs: number;
    };

export type ExplainResult<T = unknown> = {
  ok: 1;
  namespace: string;
  command: {
    type: ExplainOperationType;
    query?: Record<string, unknown>;
    options?: Record<string, unknown>;
  };
  queryPlanner?: {
    winningPlan: {
      indexName?: string;
      stage: ExplainStage;
    };
    rejectedPlans?: Array<{
      indexName: string;
      score: number;
      reason?: ExplainReasonCode;
      note?: string;
    }>;
    plannerWarnings: string[];
  };
  executionStats?: {
    stage: ExplainStage;
    indexName?: string;
    indexKeysExamined: number;
    indexEntriesLoaded: number;
    candidateIds: number;
    uniqueCandidateIds: number;
    documentsLoaded: number;
    documentsMatchedAfterLoad: number;
    sortAppliedAfterLoad: boolean;
    limitAppliedAfterLoad: boolean;
    indexSortLimitOptimization: {
      used: boolean;
      reason?: string;
    };
    scanReason?: string;
    expressionStats: Array<{
      field: string;
      operator: string;
      implemented: boolean;
      appliedAt: 'index' | 'postLoad' | 'notApplied';
      note?: string;
    }>;
    cacheStats: {
      collection: {
        name: string;
        fileCacheHits: number;
        fileCacheMisses: number;
        fileCacheHitRate: number;
      };
      indexes: Array<{
        indexName: string;
        fileCacheHits: number;
        fileCacheMisses: number;
        fileCacheHitRate: number;
      }>;
    };
    timing: {
      totalWallClockMs: number;
      accountedMs: number;
      unaccountedMs: number;
      parts: Array<{
        part: ExplainTimingPart;
        ms: number;
        calls: number;
        avgMs: number;
      }>;
    };
  };
  writeStats?: {
    documentWrites: number;
    indexMetadataWrites: number;
    indexEntryFilesUpdated: string[];
    indexEntryUpdatesCount: number;
    flushWaitMs?: number;
  };
  result?: T;
};

type ExplainAggregationState = {
  opId: string;
  opType: ExplainOperationType;
  namespace: string;
  verbosity: ExplainVerbosity;
  startedAtMs: number;
  endedAtMs?: number;
  stage?: ExplainStage;
  winningIndexName?: string;
  scanReason?: string;
  planner: {
    winningPlan?: {
      indexName?: string;
      stage: ExplainStage;
    };
    rejectedPlans: Array<{
      indexName: string;
      score: number;
      reason?: ExplainReasonCode;
      note?: string;
    }>;
    plannerWarnings: string[];
  };
  counters: {
    indexKeysExamined: number;
    indexEntriesLoaded: number;
    candidateIds: number;
    uniqueCandidateIds: number;
    documentsLoaded: number;
    documentsMatchedAfterLoad: number;
  };
  flags: {
    sortAppliedAfterLoad: boolean;
    limitAppliedAfterLoad: boolean;
    indexSortLimitOptimizationUsed: boolean;
    indexSortLimitOptimizationReason?: string;
  };
  expressionStats: Array<{
    field: string;
    operator: string;
    implemented: boolean;
    appliedAt: 'index' | 'postLoad' | 'notApplied';
    note?: string;
  }>;
  cache: {
    collection: {
      name: string;
      fileCacheHits: number;
      fileCacheMisses: number;
      fileCacheStale: number;
    };
    indexes: Record<
      string,
      {
        indexName: string;
        fileCacheHits: number;
        fileCacheMisses: number;
        fileCacheStale: number;
      }
    >;
  };
  timing: {
    parts: Record<
      ExplainTimingPart,
      {
        part: ExplainTimingPart;
        ms: number;
        calls: number;
      }
    >;
    totalWallClockMs?: number;
  };
  write?: {
    documentWrites: number;
    indexMetadataWrites: number;
    indexEntryUpdatesCount: number;
    indexEntryFilesUpdated: Set<string>;
    flushWaitMs?: number;
  };
};

type ExplainContext = {
  opType: ExplainOperationType;
  namespace: string;
  verbosity: ExplainVerbosity;
  hasSort: boolean;
  hasLimit: boolean;
  collectionName?: string;
};

export interface ExplainSink {
  onOpStart(opType: ExplainOperationType, namespace: string, verbosity: ExplainVerbosity, hasSort: boolean, hasLimit: boolean): void;
  onPlanCandidate(indexName: string, score: number, accepted: boolean, reason?: ExplainReasonCode, note?: string): void;
  onPlanWinner(stage: ExplainStage, indexName?: string, scanReason?: string): void;
  onIndexKeys(indexName: string, keyCount: number): void;
  onIndexEntriesRead(indexName: string, entryFilesRead: number, candidateIds: number, uniqueCandidateIds: number): void;
  onDocsLoaded(collection: string, count: number, source: 'idLookup' | 'indexLookup' | 'scan'): void;
  onDocsMatched(matchedAfterLoad: number): void;
  onSortLimit(sortAppliedAfterLoad: boolean, limitAppliedAfterLoad: boolean, indexOptimizationUsed: boolean, indexOptimizationReason?: string): void;
  onExprStat(field: string, operator: string, implemented: boolean, appliedAt: 'index' | 'postLoad' | 'notApplied', note?: string): void;
  onCacheEvent(scope: 'collection' | 'index', collection: string, indexName: string | undefined, cacheType: 'file', event: 'hit' | 'miss' | 'stale'): void;
  onTimingPart(part: ExplainTimingPart, durationMs: number, count?: number): void;
  onWriteCost(documentWrites: number, indexMetadataWrites: number, indexEntryUpdatesCount: number, indexEntryFilesUpdated: string[], flushWaitMs?: number): void;
  onOpEnd(ok: boolean, durationMs: number): void;
  fork(opType: ExplainOperationType): ExplainSink;
  finalize<T>(result?: T, error?: Error): ExplainResult<T> | undefined;
}

export class NullExplainSink implements ExplainSink {
  onOpStart(): void {}
  onPlanCandidate(): void {}
  onPlanWinner(): void {}
  onIndexKeys(): void {}
  onIndexEntriesRead(): void {}
  onDocsLoaded(): void {}
  onDocsMatched(): void {}
  onSortLimit(): void {}
  onExprStat(): void {}
  onCacheEvent(): void {}
  onTimingPart(): void {}
  onWriteCost(): void {}
  onOpEnd(): void {}

  fork(_opType: ExplainOperationType): ExplainSink {
    return this;
  }

  finalize<T>(_result?: T, _error?: Error): ExplainResult<T> | undefined {
    return undefined;
  }
}

export class CollectingExplainSink implements ExplainSink {
  private readonly state: ExplainAggregationState;
  public readonly opId: string;

  constructor(context: ExplainContext, opId?: string) {
    this.opId = opId ?? createExplainOperationId(context.opType);
    this.state = createInitialState(context, this.opId);
    this.onOpStart(context.opType, context.namespace, context.verbosity, context.hasSort, context.hasLimit);
  }

  onOpStart(opType: ExplainOperationType, namespace: string, verbosity: ExplainVerbosity, hasSort: boolean, hasLimit: boolean): void {
    this.state.opType = opType;
    this.state.namespace = namespace;
    this.state.verbosity = verbosity;
    this.state.startedAtMs = Date.now();
    this.state.flags.sortAppliedAfterLoad = false;
    this.state.flags.limitAppliedAfterLoad = false;
    this.state.flags.indexSortLimitOptimizationUsed = false;
    this.state.flags.indexSortLimitOptimizationReason = undefined;
    this.state.cache.collection.name = this.state.cache.collection.name || namespace;
    this.state.planner = {
      rejectedPlans: [],
      plannerWarnings: [],
    };
    void hasSort;
    void hasLimit;
  }

  onPlanCandidate(indexName: string, score: number, accepted: boolean, reason?: ExplainReasonCode, note?: string): void {
    if (!accepted) {
      this.state.planner.rejectedPlans.push({ indexName, score, reason, note });
    }
  }

  onPlanWinner(stage: ExplainStage, indexName?: string, scanReason?: string): void {
    this.state.stage = stage;
    this.state.winningIndexName = indexName;
    this.state.scanReason = scanReason;
    this.state.planner.winningPlan = { stage, indexName };
  }

  onIndexKeys(_indexName: string, keyCount: number): void {
    this.state.counters.indexKeysExamined += keyCount;
  }

  onIndexEntriesRead(_indexName: string, entryFilesRead: number, candidateIds: number, uniqueCandidateIds: number): void {
    this.state.counters.indexEntriesLoaded += entryFilesRead;
    this.state.counters.candidateIds += candidateIds;
    this.state.counters.uniqueCandidateIds += uniqueCandidateIds;
  }

  onDocsLoaded(collection: string, count: number, source: 'idLookup' | 'indexLookup' | 'scan'): void {
    this.state.counters.documentsLoaded += count;
    if (!this.state.cache.collection.name) {
      this.state.cache.collection.name = collection;
    }
    void source;
  }

  onDocsMatched(matchedAfterLoad: number): void {
    this.state.counters.documentsMatchedAfterLoad = matchedAfterLoad;
  }

  onSortLimit(sortAppliedAfterLoad: boolean, limitAppliedAfterLoad: boolean, indexOptimizationUsed: boolean, indexOptimizationReason?: string): void {
    this.state.flags.sortAppliedAfterLoad = sortAppliedAfterLoad;
    this.state.flags.limitAppliedAfterLoad = limitAppliedAfterLoad;
    this.state.flags.indexSortLimitOptimizationUsed = indexOptimizationUsed;
    this.state.flags.indexSortLimitOptimizationReason = indexOptimizationReason;
  }

  onExprStat(field: string, operator: string, implemented: boolean, appliedAt: 'index' | 'postLoad' | 'notApplied', note?: string): void {
    this.state.expressionStats.push({ field, operator, implemented, appliedAt, note });
  }

  onCacheEvent(scope: 'collection' | 'index', collection: string, indexName: string | undefined, _cacheType: 'file', event: 'hit' | 'miss' | 'stale'): void {
    if (scope === 'collection') {
      this.state.cache.collection.name = collection;
      if (event === 'hit') this.state.cache.collection.fileCacheHits += 1;
      else if (event === 'miss') this.state.cache.collection.fileCacheMisses += 1;
      else this.state.cache.collection.fileCacheStale += 1;
      return;
    }

    const resolvedIndexName = indexName ?? 'unknown';
    if (!this.state.cache.indexes[resolvedIndexName]) {
      this.state.cache.indexes[resolvedIndexName] = {
        indexName: resolvedIndexName,
        fileCacheHits: 0,
        fileCacheMisses: 0,
        fileCacheStale: 0,
      };
    }

    const bucket = this.state.cache.indexes[resolvedIndexName];
    if (event === 'hit') bucket.fileCacheHits += 1;
    else if (event === 'miss') bucket.fileCacheMisses += 1;
    else bucket.fileCacheStale += 1;
  }

  onTimingPart(part: ExplainTimingPart, durationMs: number, count?: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }
    const timing = this.state.timing.parts[part];
    timing.ms += durationMs;
    timing.calls += count && count > 0 ? count : 1;
  }

  onWriteCost(documentWrites: number, indexMetadataWrites: number, indexEntryUpdatesCount: number, indexEntryFilesUpdated: string[], flushWaitMs?: number): void {
    this.state.write = {
      documentWrites,
      indexMetadataWrites,
      indexEntryUpdatesCount,
      indexEntryFilesUpdated: new Set<string>(indexEntryFilesUpdated),
      flushWaitMs,
    };
  }

  onOpEnd(ok: boolean, durationMs: number): void {
    this.state.endedAtMs = this.state.startedAtMs + durationMs;
    void ok;
  }

  fork(opType: ExplainOperationType): ExplainSink {
    return new CollectingExplainSink({
      opType,
      namespace: this.state.namespace,
      verbosity: this.state.verbosity,
      hasSort: false,
      hasLimit: false,
      collectionName: this.state.cache.collection.name || undefined,
    }, createExplainOperationId(opType));
  }

  finalize<T>(result?: T, _error?: Error): ExplainResult<T> | undefined {
    return serializeExplainResult(this.state, result);
  }
}

export type ExplainOption = {
  explain?: ExplainVerbosity;
};

export function createExplainSink(context: Omit<ExplainContext, 'verbosity'> & { verbosity?: ExplainVerbosity }): ExplainSink {
  if (!context.verbosity) {
    return new NullExplainSink();
  }

  return new CollectingExplainSink({
    ...context,
    verbosity: context.verbosity,
  });
}

function createInitialState(context: ExplainContext, opId: string): ExplainAggregationState {
  const timingParts: ExplainAggregationState['timing']['parts'] = {
    planning: { part: 'planning', ms: 0, calls: 0 },
    indexKeyLookup: { part: 'indexKeyLookup', ms: 0, calls: 0 },
    indexEntryRead: { part: 'indexEntryRead', ms: 0, calls: 0 },
    documentLoad: { part: 'documentLoad', ms: 0, calls: 0 },
    postLoadFilter: { part: 'postLoadFilter', ms: 0, calls: 0 },
    postLoadSort: { part: 'postLoadSort', ms: 0, calls: 0 },
    postLoadLimit: { part: 'postLoadLimit', ms: 0, calls: 0 },
    scan: { part: 'scan', ms: 0, calls: 0 },
    cache: { part: 'cache', ms: 0, calls: 0 },
    writePersist: { part: 'writePersist', ms: 0, calls: 0 },
    writeFlush: { part: 'writeFlush', ms: 0, calls: 0 },
    other: { part: 'other', ms: 0, calls: 0 },
  };

  return {
    opId,
    opType: context.opType,
    namespace: context.namespace,
    verbosity: context.verbosity,
    startedAtMs: Date.now(),
    planner: {
      rejectedPlans: [],
      plannerWarnings: [],
    },
    counters: {
      indexKeysExamined: 0,
      indexEntriesLoaded: 0,
      candidateIds: 0,
      uniqueCandidateIds: 0,
      documentsLoaded: 0,
      documentsMatchedAfterLoad: 0,
    },
    flags: {
      sortAppliedAfterLoad: false,
      limitAppliedAfterLoad: false,
      indexSortLimitOptimizationUsed: false,
      indexSortLimitOptimizationReason: undefined,
    },
    expressionStats: [],
    cache: {
      collection: {
        name: context.collectionName ?? '',
        fileCacheHits: 0,
        fileCacheMisses: 0,
        fileCacheStale: 0,
      },
      indexes: {},
    },
    timing: {
      parts: timingParts,
    },
  };
}

function serializeExplainResult<T>(state: ExplainAggregationState, result?: T): ExplainResult<T> {
  const stage = state.stage ?? 'COLLECTION_SCAN';
  const endedAtMs = state.endedAtMs ?? Date.now();
  const totalWallClockMs = Math.max(0, endedAtMs - state.startedAtMs);
  state.timing.totalWallClockMs = totalWallClockMs;

  const timingParts = Object.values(state.timing.parts)
    .filter(part => part.ms > 0 || part.calls > 0)
    .sort((a, b) => b.ms - a.ms)
    .map(part => ({
      part: part.part,
      ms: part.ms,
      calls: part.calls,
      avgMs: part.calls > 0 ? part.ms / part.calls : 0,
    }));
  const accountedMs = timingParts.reduce((sum, part) => sum + part.ms, 0);
  const unaccountedMs = Math.max(0, totalWallClockMs - accountedMs);

  const collectionHitRate = calculateHitRate(state.cache.collection.fileCacheHits, state.cache.collection.fileCacheMisses);

  const indexCacheStats = Object.values(state.cache.indexes)
    .map(bucket => ({
      indexName: bucket.indexName,
      fileCacheHits: bucket.fileCacheHits,
      fileCacheMisses: bucket.fileCacheMisses,
      fileCacheHitRate: calculateHitRate(bucket.fileCacheHits, bucket.fileCacheMisses),
    }))
    .sort((a, b) => a.indexName.localeCompare(b.indexName));

  const explain: ExplainResult<T> = {
    ok: 1,
    namespace: state.namespace,
    command: {
      type: state.opType,
    },
    result,
  };

  if (state.verbosity === 'queryPlanner' || state.verbosity === 'allPlansExecution' || state.verbosity === 'executionStats') {
    explain.queryPlanner = {
      winningPlan: state.planner.winningPlan ?? { stage, indexName: state.winningIndexName },
      plannerWarnings: state.planner.plannerWarnings,
      rejectedPlans: state.verbosity === 'allPlansExecution' ? state.planner.rejectedPlans : undefined,
    };
  }

  if (state.verbosity === 'executionStats' || state.verbosity === 'allPlansExecution') {
    explain.executionStats = {
      stage,
      indexName: state.winningIndexName,
      indexKeysExamined: state.counters.indexKeysExamined,
      indexEntriesLoaded: state.counters.indexEntriesLoaded,
      candidateIds: state.counters.candidateIds,
      uniqueCandidateIds: state.counters.uniqueCandidateIds,
      documentsLoaded: state.counters.documentsLoaded,
      documentsMatchedAfterLoad: state.counters.documentsMatchedAfterLoad,
      sortAppliedAfterLoad: state.flags.sortAppliedAfterLoad,
      limitAppliedAfterLoad: state.flags.limitAppliedAfterLoad,
      indexSortLimitOptimization: {
        used: state.flags.indexSortLimitOptimizationUsed,
        reason: state.flags.indexSortLimitOptimizationReason,
      },
      scanReason: state.scanReason,
      expressionStats: state.expressionStats,
      cacheStats: {
        collection: {
          name: state.cache.collection.name,
          fileCacheHits: state.cache.collection.fileCacheHits,
          fileCacheMisses: state.cache.collection.fileCacheMisses,
          fileCacheHitRate: collectionHitRate,
        },
        indexes: indexCacheStats,
      },
      timing: {
        totalWallClockMs,
        accountedMs,
        unaccountedMs,
        parts: timingParts,
      },
    };
  }

  if (state.write) {
    explain.writeStats = {
      documentWrites: state.write.documentWrites,
      indexMetadataWrites: state.write.indexMetadataWrites,
      indexEntryUpdatesCount: state.write.indexEntryUpdatesCount,
      indexEntryFilesUpdated: Array.from(state.write.indexEntryFilesUpdated).sort((a, b) => a.localeCompare(b)),
      flushWaitMs: state.write.flushWaitMs,
    };
  }

  return explain;
}

function calculateHitRate(hits: number, misses: number): number {
  const denominator = hits + misses;
  if (denominator === 0) {
    return 0;
  }

  return hits / denominator;
}

function createExplainOperationId(opType: ExplainOperationType): string {
  return `${opType}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

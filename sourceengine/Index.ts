// 书源解析内核的公开接口（纯 TS 文件）。新增导出时按文件分组追加。
// 带 @Concurrent 等 ArkTS 语法的 .ets 文件不能从 .ts 引用，统一放在 Diagnostics.ets 子入口。
export {
  BookSourceDebugLimits,
  BookSourceDebugNetworkTrace,
  BookSourceDebugRuleTrace,
  BookSourceDebugLog,
  BookSourceDebugStep,
  BookSourceDebugSession,
  BookSourceDebugContext,
  BookSourceDebugRedactor
} from './src/main/ets/core/book/BookSourceDebugModels';
export {
  BookSourceHostActionKind,
  BookSourceExecutionJournal
} from './src/main/ets/core/book/BookSourceExecutionJournal';
export {
  BookSourceHeaderResult,
  BookSourceHeaderRuntime
} from './src/main/ets/core/book/BookSourceHeaderRuntime';
export {
  BookSourceLoginCrypto
} from './src/main/ets/core/book/BookSourceLoginCrypto';
export {
  SourceRuntimeStage,
  SourceRuntimeCapabilityReport,
  SourceRuntimeDecision,
  BookSourceRuntimeRouter
} from './src/main/ets/core/book/BookSourceRuntimeRouter';
export {
  BookSourceRuntimePersistence,
  BookSourceRuntimeStore
} from './src/main/ets/core/book/BookSourceRuntimeStore';
export {
  BookSourceLoginItem,
  BookSourceScriptResult,
  BookSourceScriptRunner
} from './src/main/ets/core/book/BookSourceScriptRunner';
export {
  StageWebRuntimeRequest,
  StageWebRuntimeResult,
  BookSourceStageWebRuntime
} from './src/main/ets/core/book/BookSourceStageWebRuntime';
export {
  SourceScriptNotice
} from './src/main/ets/core/book/SourceScriptNotice';
export {
  BookTypeSupport
} from './src/main/ets/core/book/BookTypeSupport';
export {
  BookUrlResolver
} from './src/main/ets/core/book/BookUrlResolver';
export {
  EncodedJsonValue,
  EncodedJsonMap,
  EncodedSourcePayload,
  EncodedSourceUrl
} from './src/main/ets/core/book/EncodedSourceUrl';
export {
  ReaderActionData,
  ReaderActionMatch,
  ReaderActionMarker
} from './src/main/ets/core/book/ReaderActionMarker';
export {
  WebBookFetchRequest,
  WebBookFetchResponse,
  WebBookFetchRuntime
} from './src/main/ets/core/book/WebBookFetchRuntime';
export {
  WebJsAwaitScript
} from './src/main/ets/core/book/WebJsAwaitScript';
export {
  CooperativeCancellationToken,
  CooperativeTimeSlice,
  CooperativeScheduler
} from './src/main/ets/core/concurrency/CooperativeScheduler';
export {
  RateLimitAcquireResult,
  BookSourceRateLimiter
} from './src/main/ets/core/http/BookSourceRateLimiter';
export {
  CookieStore
} from './src/main/ets/core/http/CookieStore';
export {
  digestHashHex
} from './src/main/ets/core/http/DigestHash';
export {
  HttpHashFunction,
  HttpAuthChallenge,
  HttpDigestChallenge,
  HttpAuth
} from './src/main/ets/core/http/HttpAuth';
export {
  HttpRequest,
  HttpResponse,
  HttpBinaryResponse,
  HttpClient
} from './src/main/ets/core/http/HttpClient';
export {
  RawHttpTextClient
} from './src/main/ets/core/http/RawHttpTextClient';
export {
  RequestSessionConfig,
  RequestSessionSupport
} from './src/main/ets/core/http/RequestSessionSupport';
export {
  SetCookieParser
} from './src/main/ets/core/http/SetCookieParser';
export {
  TlsTrustStore
} from './src/main/ets/core/http/TlsTrustStore';
export {
  VerificationSupport
} from './src/main/ets/core/http/VerificationSupport';
export {
  NetworkErrorText
} from './src/main/ets/core/http/NetworkErrorText';
export {
  NativeValue,
  NativeExprHost,
  NativeExprError,
  NativeScope,
  NativeExpr
} from './src/main/ets/core/nativesource/NativeExpr';
export {
  NativeSourceCrypto
} from './src/main/ets/core/nativesource/NativeSourceCrypto';
export {
  NativeRequest,
  NativeLoginState,
  NativeResponse,
  NativeRuleTrace,
  NativeLoginCredential,
  NativeLoginResult,
  NativeActionEntry,
  NativeRunnerHost,
  NativeBookRecord,
  NativeBookInput,
  NativeChapterInput,
  NativeChapterRecord,
  NativeMenuEntry,
  NativeParagraphComment,
  NativeContentResult,
  NativeContentLink,
  NativeImageDecode,
  NativeSourceError,
  NativeSourceRunner,
  NativeVarOptions
} from './src/main/ets/core/nativesource/NativeSourceRunner';
export {
  NativeBrowserRequest,
  NativeBrowserResult,
  NativeSourceInteraction,
  NativeSourceInteractionHandler
} from './src/main/ets/core/nativesource/NativeSourceInteraction';
export {
  NativeFilterGroup,
  NativeVoiceOption,
  NativeVarItem,
  NativeSourceService
} from './src/main/ets/core/nativesource/NativeSourceService';
export {
  NativeVarSpec,
  NativeVoiceSpec,
  NativeRequestSpec,
  NativeWebViewSpec,
  NativeActionSpec,
  NativeLoginFieldSpec,
  NativeLoginSubmitSpec,
  NativeCacheSpec,
  NativeLoginCheckSpec,
  NativeLoginSpec,
  NativeStageSpec,
  NativeMenuSpec,
  NativeDynamicMenuSpec,
  NativeExploreSpec,
  NativeDetailSpec,
  NativeTocSpec,
  NativeFetchSpec,
  NativeReplaceSpec,
  NativeCommentsSpec,
  NativeLinkSpec,
  NativeImageDecodeSpec,
  NativeContentSpec,
  NativeSourceDefinition,
  NativeSourceSpec
} from './src/main/ets/core/nativesource/NativeSourceSpec';
export {
  DirectAjaxRulePlan,
  AjaxRuleCompat
} from './src/main/ets/core/rule/AjaxRuleCompat';
export {
  AnalyzeRule
} from './src/main/ets/core/rule/AnalyzeRule';
export {
  UrlConfig,
  AnalyzeUrl
} from './src/main/ets/core/rule/AnalyzeUrl';
export {
  BudgetedRegexReplace
} from './src/main/ets/core/rule/BudgetedRegexReplace';
export {
  JavaRegexConversion,
  JavaRegexCompat
} from './src/main/ets/core/rule/JavaRegexCompat';
export {
  JsRuntime
} from './src/main/ets/core/rule/JsRuntime';
export {
  JsonPathEvaluator
} from './src/main/ets/core/rule/JsonPathEvaluator';
export {
  PageCandidateUrl
} from './src/main/ets/core/rule/PageCandidateUrl';
export {
  ImportedReplaceRule,
  ReplaceRuleImportResult,
  ReplaceRuleImport
} from './src/main/ets/core/rule/ReplaceRuleImport';
export {
  RuleContext
} from './src/main/ets/core/rule/RuleContext';
export {
  RuleExecutionPriority,
  RuleFieldRequest,
  RuleBatchExecutionRequest,
  RuleBatchExecutionResult
} from './src/main/ets/core/rule/RuleExecutionModels';
export {
  RuleExecutionService
} from './src/main/ets/core/rule/RuleExecutionService';
export {
  RuleValueKind,
  RuleExecutionTarget,
  RuleValue
} from './src/main/ets/core/rule/RuleValue';
export {
  ScriptCompatibility
} from './src/main/ets/core/rule/ScriptCompatibility';
export {
  ScriptEvalResult,
  ScriptEngineContext,
  ScriptEngineBackend,
  ScriptEngine
} from './src/main/ets/core/rule/ScriptEngine';
export {
  QuickJsLegacyEvaluator,
  QuickJsAsyncRouter
} from './src/main/ets/core/script/QuickJsAsyncRouter';
export {
  QuickJsMigrationEvent,
  QuickJsFingerprintStats,
  QuickJsMigrationSnapshot,
  QuickJsMigrationStore
} from './src/main/ets/core/script/QuickJsMigrationStore';
export {
  QuickJsRegressionFixtureRecord,
  QuickJsRegressionArtifactSnapshot,
  QuickJsRegressionArtifactStore
} from './src/main/ets/core/script/QuickJsRegressionArtifacts';
export {
  QuickJsRegressionStage,
  QuickJsRegressionStatus,
  QuickJsRegressionIssueCategory,
  QuickJsRegressionCandidate,
  QuickJsRegressionItemResult,
  QuickJsRegressionReplayCase,
  QuickJsRegressionReport,
  QuickJsRegressionProgress,
  QuickJsRegressionProgressCallback,
  QuickJsRegressionRunner
} from './src/main/ets/core/script/QuickJsRegressionRunner';
export {
  QuickJsRuntimeMode,
  QuickJsObservationContext,
  QuickJsShadowSubmitter,
  QuickJsAsyncExecutionResult,
  QuickJsAsyncSubmitter,
  QuickJsRuntimeStatus
} from './src/main/ets/core/script/QuickJsRuntimeStatus';
export {
  QuickJsExpressionResult,
  QuickJsScriptRuntime,
  QuickJsShadowComparator
} from './src/main/ets/core/script/QuickJsScriptRuntime';
export { ScriptProbeResult, ScriptThreadProbe } from './src/main/ets/core/script/ScriptThreadProbe';
export {
  QuickJsValidationEvent,
  QuickJsValidationSeed,
  QuickJsValidationCandidate,
  QuickJsValidationSnapshot,
  QuickJsValidationStore
} from './src/main/ets/core/script/QuickJsValidationStore';
export {
  Book,
  ReadConfig,
  BookChapter,
  BookSource,
  BookListRule,
  SearchRule,
  ExploreRule,
  BookInfoRule,
  TocRule,
  ContentRule,
  ReplaceRule,
  BookGroup,
  Bookmark,
  SearchBook,
  SearchKeyword,
  HttpTTS
} from './src/main/ets/model/data/Book';
export {
  BookFieldSanitizer
} from './src/main/ets/utils/BookFieldSanitizer';
export {
  LogText
} from './src/main/ets/utils/LogText';
export {
  sleepMs
} from './src/main/ets/utils/Sleep';

export {
  SourceCookieJar, SourceRateWaiter, SourceRequestScheduler, SourceScriptExecutor, SourceNativeScripts,
  SourceWebSession, SourceExecutionState, SourceDiagnostics, SourceImageScripts, SourceEngineHostAdapter, SourceEngineHost
} from './src/main/ets/core/host/SourceEngineHost';
export { NativeSourceImport } from './src/main/ets/core/nativesource/NativeSourceImport';
export { SourceCoverUrl } from './src/main/ets/core/nativesource/SourceCoverUrl';
export { SourceImageDecoder } from './src/main/ets/core/nativesource/SourceImageDecoder';
export { NativeImageScriptRunner } from './src/main/ets/core/nativesource/NativeImageScriptRunner';
export { ImageStripOptions, ImageStripRange, NativeImageTransform } from './src/main/ets/core/nativesource/NativeImageTransform';
export { SourceCoverLoader } from './src/main/ets/core/nativesource/SourceCoverLoader';
export type { NativeCoverDecodeSpec } from './src/main/ets/core/nativesource/NativeSourceSpec';

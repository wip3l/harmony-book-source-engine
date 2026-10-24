import { AnalyzeRule } from '../rule/AnalyzeRule';
import { JsonPathEvaluator } from '../rule/JsonPathEvaluator';
import { RuleExecutionTarget, RuleValueKind } from '../rule/RuleValue';
import { NativeExpr, NativeScope, NativeValue } from './NativeExpr';
import { NativeSourceCrypto } from './NativeSourceCrypto';
import { digestHashHex } from '../http/DigestHash';
import { SourceEngineHost } from '../host/SourceEngineHost';
import { NativePureRule } from './NativePureRule';

interface ParseInput {
  kind: string;
  content?: string;
  rule: string;
  baseUrl?: string;
  list?: boolean;
  library?: string;
  scope?: Record<string, NativeValue>;
  template?: boolean;
}

/** Stateless CPU work. Uses the pinned engine; never initializes AppHost, cookies, Web or persistence. */
export class NativePureParser {
  static run(input: string): string {
    if (input.length > NativePureRule.MAX_CHARS) throw new Error('解析输入超过 8M UTF-16 code units');
    // The worker host is initialized once by its owner, never replaced by a parsing task.
    if (SourceEngineHost.scriptExecutor()?.allowSynchronousQuickJs !== false) {
      throw new Error('NativePureParser requires a host with synchronous QuickJS disabled');
    }
    const request = JSON.parse(input) as ParseInput;
    if (!request || typeof request.rule !== 'string') throw new Error('解析请求无效');
    const select = (content: string, rule: string, baseUrl: string, list: boolean): string[] => {
      const analyzer = new AnalyzeRule(content, baseUrl);
      if (list) return analyzer.getStringList(rule);
      const value = analyzer.getString(rule);
      return value ? [value] : [];
    };
    if ((request.kind === 'items' || request.kind === 'select') && !NativePureRule.isPure(request.rule)) {
      throw new Error('带脚本的选择器必须留在原书源上下文');
    }
    let result: NativeValue;
    if (request.kind === 'expression') {
      const scope = new NativeScope();
      for (const key of Object.keys(request.scope || {})) scope.set(key, request.scope![key]);
      const expression = new NativeExpr({ jsonPath: (root, path) => JsonPathEvaluator.evaluate(root, path), select,
        digest: digestHashHex, crypto: (name, args) => NativeSourceCrypto.run(name, args),
        cookie: () => { throw new Error('Cookie 表达式必须留在原书源上下文'); } }).loadLibrary(request.library || '');
      if (expression.requiresScript(request.rule, request.template)) throw new Error('脚本必须通过有界脚本执行器');
      result = request.template ? expression.render(request.rule, scope) : expression.evaluate(request.rule, scope);
    } else if (request.kind === 'items') {
      result = new AnalyzeRule(request.content || '', request.baseUrl || '')
        .execute(request.rule, RuleExecutionTarget.ELEMENTS).map(value => {
          if (value.kind !== RuleValueKind.JSON) return value.asString();
          if (value.objectValue !== null && value.objectValue !== undefined) return value.objectValue;
          try { return JSON.parse(value.asString()); } catch (_) { return value.asString(); }
        });
    } else if (request.kind === 'select') {
      result = select(request.content || '', request.rule, request.baseUrl || '', request.list === true);
    } else throw new Error('未知解析任务');
    const output = JSON.stringify(result ?? null);
    if (output.length > NativePureRule.MAX_CHARS) throw new Error('解析结果超过 8M UTF-16 code units');
    return output;
  }
}

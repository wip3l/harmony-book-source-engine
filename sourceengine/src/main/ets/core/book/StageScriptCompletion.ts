import { STAGE_SCRIPT_PARSER_SOURCE } from './StageScriptParserSource';

/**
 * Rhino-compatible script results for the ArkWeb stage runtime.
 *
 * Android Legado evaluates source scripts with Rhino, where a script's value is the value of the
 * last expression statement that actually ran (outside function bodies). ECMAScript 2015+, which
 * ArkWeb implements, resets the completion value to `undefined` when the final statement is an
 * `if`/loop/`switch`/`try` that produces nothing — so the common idiom
 *
 *     if (a) { JSON.stringify(x); } else { ... }
 *     if (!a) { JSON.stringify(y); }      // not taken
 *
 * returns `JSON.stringify(x)` on Android but `undefined` here. To honor the rule language, the
 * stage code is parsed once (acorn, inside the Web host) and every expression statement outside a
 * function or class body is wrapped as `VALUE_FUNCTION((expr))`, which records the latest value
 * without changing the expression's own result. The runtime uses that record only when ArkWeb's
 * own completion value is `undefined`, so scripts that already work keep their exact result.
 */
export class StageScriptCompletion {
  static readonly VALUE_FUNCTION: string = '__legadoRhinoValue';
  static readonly STATE: string = '__legadoRhinoState';
  private static readonly MAX_CODE_LENGTH: number = 512 * 1024;
  private static readonly MAX_CACHE_ENTRIES: number = 128;
  private static readonly MAX_CACHE_CHARS: number = 4 * 1024 * 1024;
  private static cache: Map<string, string> = new Map<string, string>();
  private static cacheChars: number = 0;

  /**
   * Only statements that can leave an `undefined` completion behind a real value need the rewrite;
   * scripts without them already produce the Rhino result.
   */
  static isCandidate(code: string): boolean {
    const text = code || '';
    if (!text || text.length > StageScriptCompletion.MAX_CODE_LENGTH) return false;
    return /\b(?:if|for|while|do|switch|try|with)\b/.test(text);
  }

  /** The instrumented code for `code`, or `undefined` when it has not been prepared yet. */
  static cached(code: string): string | undefined {
    const value = StageScriptCompletion.cache.get(code);
    if (value === undefined) return undefined;
    // Refresh LRU order.
    StageScriptCompletion.cache.delete(code);
    StageScriptCompletion.cache.set(code, value);
    return value;
  }

  /** Remembers the prepared form. A failed parse is remembered as the original code. */
  static remember(code: string, prepared: string): void {
    const previous = StageScriptCompletion.cache.get(code);
    if (previous !== undefined) {
      StageScriptCompletion.cache.delete(code);
      StageScriptCompletion.cacheChars -= code.length + previous.length;
    }
    StageScriptCompletion.cache.set(code, prepared);
    StageScriptCompletion.cacheChars += code.length + prepared.length;
    while (StageScriptCompletion.cache.size > StageScriptCompletion.MAX_CACHE_ENTRIES ||
      StageScriptCompletion.cacheChars > StageScriptCompletion.MAX_CACHE_CHARS) {
      const oldest = StageScriptCompletion.cache.keys().next();
      if (oldest.done) break;
      const oldValue = StageScriptCompletion.cache.get(oldest.value) || '';
      StageScriptCompletion.cache.delete(oldest.value);
      StageScriptCompletion.cacheChars -= oldest.value.length + oldValue.length;
    }
  }

  static clearCache(): void {
    StageScriptCompletion.cache.clear();
    StageScriptCompletion.cacheChars = 0;
  }

  /**
   * Web-host script that parses `code` and returns the expression ranges to wrap, as
   * `encodeURIComponent(JSON.stringify([start, end, ...]))`, or an empty string when the code is
   * not valid modern JavaScript (the original code is then used unchanged).
   */
  static locateScript(code: string): string {
    return `(function(){var module={exports:{}};var exports=module.exports;var define;` +
      `${STAGE_SCRIPT_PARSER_SOURCE}\n;var acorn=module.exports;var code=${JSON.stringify(code || '')};` +
      `var ast;try{ast=acorn.parse(code,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true,` +
      `allowAwaitOutsideFunction:true,allowHashBang:true,allowReserved:true});}catch(e){return '';}` +
      `var ranges=[];var stack=[ast];while(stack.length){var node=stack.pop();if(!node||typeof node.type!=='string')continue;` +
      `var t=node.type;if(t==='FunctionDeclaration'||t==='FunctionExpression'||t==='ArrowFunctionExpression'||` +
      `t==='ClassDeclaration'||t==='ClassExpression')continue;` +
      `if(t==='ExpressionStatement'&&!node.directive){ranges.push(node.expression.start,node.expression.end);}` +
      `for(var key in node){if(key==='type'||key==='start'||key==='end'||key==='loc'||key==='range')continue;` +
      `var child=node[key];if(Array.isArray(child)){for(var i=0;i<child.length;i++)` +
      `if(child[i]&&typeof child[i].type==='string')stack.push(child[i]);}` +
      `else if(child&&typeof child.type==='string')stack.push(child);}}` +
      `return encodeURIComponent(JSON.stringify(ranges));})()`;
  }

  /** Applies the ranges returned by {@link locateScript}; returns the original code on any mismatch. */
  static instrument(code: string, raw: string): string {
    const ranges = StageScriptCompletion.parseRanges(raw);
    if (!ranges || ranges.length === 0 || ranges.length % 2 !== 0) return code;
    const inserts: Array<[number, string]> = [];
    for (let index = 0; index < ranges.length; index += 2) {
      const start = ranges[index];
      const end = ranges[index + 1];
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > code.length || start >= end) {
        return code;
      }
      inserts.push([start, `${StageScriptCompletion.VALUE_FUNCTION}((`]);
      inserts.push([end, '))']);
    }
    // Apply from the back so earlier offsets stay valid. When one range ends where the next begins,
    // the text must read `))` then the opening wrapper; inserting at the same offset prepends, so
    // the opening wrapper is applied first and the closing `))` after it.
    inserts.sort((a: [number, string], b: [number, string]): number => {
      if (a[0] !== b[0]) return b[0] - a[0];
      const aClose = a[1] === '))' ? 1 : 0;
      const bClose = b[1] === '))' ? 1 : 0;
      return aClose - bClose;
    });
    let result = code;
    for (const insert of inserts) {
      result = result.substring(0, insert[0]) + insert[1] + result.substring(insert[0]);
    }
    return result;
  }

  /** Prelude defining the recorder; must run before the instrumented code in the same scope. */
  static prelude(): string {
    return `const ${StageScriptCompletion.STATE}={set:false,value:undefined};` +
      `function ${StageScriptCompletion.VALUE_FUNCTION}(v){${StageScriptCompletion.STATE}.set=true;` +
      `${StageScriptCompletion.STATE}.value=v;return v;}`;
  }

  private static parseRanges(raw: string): number[] | null {
    let value = (raw || '').trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = String(JSON.parse(value));
      } catch (_) {
        value = value.substring(1, value.length - 1);
      }
    }
    if (!value) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(value)) as Object;
      return Array.isArray(parsed) ? parsed as number[] : null;
    } catch (_) {
      return null;
    }
  }
}

import { Book, BookChapter, BookSource } from '../../model/data/Book';
import { NativeSourceService } from '../nativesource/NativeSourceService';
import { SourceRuntimeStage } from './BookSourceRuntimeRouter';
import { BookSourceStageWebRuntime, StageWebRuntimeRequest } from './BookSourceStageWebRuntime';

/** 书源事件回调的一次执行结果。 */
export class SourceEventResult {
  /** 脚本最后的求值结果为真：书源表示这个事件它处理了。 */
  handled: boolean = false;
  /** 脚本用 java.showBrowser / startBrowser 等要求打开的地址，没有时为空。 */
  requestedUrl: string = '';
  /** java.showBrowser(url, html, js) 给出的整页内容，没有时为空。 */
  requestedHtml: string = '';
  /** 脚本用 java.toast / longToast 给出的提示，没有时为空。 */
  toastMessage: string = '';
  /** 没能执行或脚本出错时的原因。 */
  error: string = '';
}

/**
 * 兼容书源的事件回调（`eventListener: true` 加 `ruleContent.callBackJs`）。
 *
 * 宿主在事件发生时调 dispatch，脚本里能读到全局的 `event`（事件名）、`book`、`chapter`，
 * 以及 jsLib 里的函数；脚本靠副作用办事（发请求、提示、要求打开网页），最后一个表达式为真表示已处理。
 * 原生书源没有这套回调。
 */
export class SourceEventCallback {
  /** 书籍加入书架之后。 */
  static readonly ADD_BOOK_SHELF: string = 'addBookShelf';
  /** 书籍从书架移除之后。 */
  static readonly DEL_BOOK_SHELF: string = 'delBookShelf';
  /** 用户点了书源的自定义按钮（`customButton: true` 时宿主才显示）。 */
  static readonly CLICK_CUSTOM_BUTTON: string = 'clickCustomButton';
  /** 用户在详情页点了作者名，想看书源提供的作者主页（宿主先用 handles 确认书源处理它，再给入口）。 */
  static readonly CLICK_AUTHOR: string = 'clickAuthor';

  /** 书源声明了事件回调并且写了脚本。 */
  static listens(source: BookSource | null | undefined): boolean {
    if (!source || NativeSourceService.isNative(source)) return false;
    return source.eventListener === true && !!(source.contentRule?.callBackJs || '').trim();
  }

  /**
   * 书源的回调脚本里提到了这个事件。没有声明事件清单的字段，只能看脚本里有没有这个事件名；
   * 宿主据此决定要不要给可选事件（比如作者主页）留入口。
   */
  static handles(source: BookSource | null | undefined, event: string): boolean {
    return !!event && SourceEventCallback.listens(source) && source!.contentRule.callBackJs.includes(event);
  }

  /** 书源要求显示自定义按钮，并且点了有脚本可跑。 */
  static hasCustomButton(source: BookSource | null | undefined): boolean {
    return SourceEventCallback.listens(source) && source!.customButton === true;
  }

  /**
   * 自定义按钮该叫什么。书源格式里按钮只有开关、没有名字，这里按回调脚本处理点击的那一段来猜：
   * 提到评论（地址或字样）就是“评论”。猜不出来返回空串，由宿主用自己的默认叫法。
   */
  static customButtonLabel(source: BookSource | null | undefined): string {
    if (!SourceEventCallback.hasCustomButton(source)) return '';
    const script = source!.contentRule.callBackJs || '';
    const at = script.indexOf(SourceEventCallback.CLICK_CUSTOM_BUTTON);
    // 只看处理点击的部分，免得别的事件分支里的字样带偏。
    const handler = at >= 0 ? script.substring(at) : script;
    return /comment|review|评论|书评|章评|段评|本章说/i.test(handler) ? '评论' : '';
  }

  /**
   * 执行一次事件回调。不抛异常：环境没就绪、脚本报错都写进结果的 error。
   * chapter 传当前章节；不在阅读页时传 null，脚本里的 `chapter.url` 为空。
   */
  static async dispatch(source: BookSource, event: string, book: Book,
    chapter: BookChapter | null = null): Promise<SourceEventResult> {
    const result = new SourceEventResult();
    if (!SourceEventCallback.listens(source) || !event || !book) return result;
    const runtime = BookSourceStageWebRuntime.get();
    if (!await runtime.waitUntilAvailable(8000)) {
      result.error = '书源脚本运行环境未就绪';
      return result;
    }
    const request = new StageWebRuntimeRequest();
    request.ownerId = `event_${event}_${Date.now()}_${book.bookUrl}`;
    // 回调靠副作用办事，可以什么都不返回；READER_ACTION 阶段不把空结果当成失败。
    request.applyStageBudget(SourceRuntimeStage.READER_ACTION);
    request.source = source;
    request.book = book;
    request.chapter = chapter;
    request.baseUrl = chapter?.url || book.bookUrl || source.bookSourceUrl;
    request.code = `var event = ${JSON.stringify(event)};\n${source.contentRule.callBackJs}`;
    request.readerActionMode = true;
    request.maxRequestCount = 4;
    request.maxResponseBytes = 2 * 1024 * 1024;
    request.maxTotalResponseBytes = 3 * 1024 * 1024;
    try {
      const value = await runtime.execute(request);
      result.handled = SourceEventCallback.truthy(value.value || '');
      result.requestedUrl = (value.requestedUrl || '').trim();
      result.requestedHtml = value.requestedHtml || '';
      result.toastMessage = (value.toastMessage || '').trim();
      result.error = (value.errorMessage || '').trim();
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error || '脚本执行失败');
    }
    return result;
  }

  /** 脚本结果按文本回来：空、false、0、null、undefined 都算没处理。 */
  private static truthy(text: string): boolean {
    const value = text.trim();
    return !!value && !/^(?:false|0|null|undefined|NaN)$/i.test(value);
  }
}

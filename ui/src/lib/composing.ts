// 输入法组合态守卫 —— 「Enter 提交 / Shift+Enter 换行」的输入框共用。
//
// WebKit确认拼音候选词的那个 Enter,往往先触发 compositionend、
// 再 keydown 且 isComposing 已为 false —— 只判 isComposing 会漏拦、误提交。
// 这里自己用 compositionstart/end 兜一个「刚结束」标志,拦住紧随其后的确认 Enter。
export function composingGuard() {
  let composing = false;
  let compositionEndedAt = Number.NEGATIVE_INFINITY;

  return {
    onCompositionStart() {
      composing = true;
    },
    onCompositionEnd() {
      composing = false;
      compositionEndedAt = performance.now();
    },
    isSubmit(event: React.KeyboardEvent) {
      if (event.key !== "Enter" || event.shiftKey) {
        return false;
      }
      // WebKit 可能先发 compositionend，再发确认候选词的 Enter；keyCode 229 也是其兼容标记。
      if (composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
        return false;
      }
      if (performance.now() - compositionEndedAt < 100) {
        return false;
      }
      return true;
    },
  };
}

export function normalizeMarkdown(source) {
  return source.replace(/^[\u200B-\u200F\uFEFF]+/, "");
}

// CommonMark's punctuation rule leaves **中文：**后续文字 unparsed.
// Accept the conventional CJK spelling while keeping the normal tokenizer
// for other emphasis and code spans.
export const cjkStrong = {
  name: "cjkStrong",
  level: "inline",
  start(source) { return source.indexOf("**"); },
  tokenizer(source) {
    const match = /^\*\*(?=\S)((?:(?!\*\*)[^\n])+?[：，。；！？、）】》」』])\*\*/.exec(source);
    if (match) return { type: "strong", raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
  },
};

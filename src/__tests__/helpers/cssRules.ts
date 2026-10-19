/**
 * Minimal CSS rule walker for pins on cascade ORDER and on which declarations a rule carries. Comments are stripped, nesting at any depth (@media, @supports)
 * is flattened in source order, and a selector list is parsed into its members, so a pin does not care about whitespace, selector order or comments.
 */
export interface CssRule {
  selectors: string[];
  body: string;
  /** Position of the rule's opening `{` in the comment-stripped text: compare for source order. */
  at: number;
}

export function cssRules(source: string): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let prelude = '';
  const stack: Array<{ prelude: string; at: number; body: string }> = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      stack.push({ prelude: prelude.trim(), at: i, body: '' });
      prelude = '';
    } else if (c === '}') {
      const top = stack.pop();
      if (top && !top.prelude.startsWith('@')) {
        rules.push({ selectors: splitSelectorList(top.prelude), body: top.body, at: top.at });
      }
      prelude = '';
    } else if (stack.length > 0 && !/^@(media|supports|layer|container)/.test(stack[stack.length - 1].prelude)) {
      stack[stack.length - 1].body += c;
    } else {
      prelude += c;
    }
  }
  return rules;
}

export function splitSelectorList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of list) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  return [...out, cur].map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

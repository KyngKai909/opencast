// Underwriting credit text: who the business is, where, and what it does, and
// nothing else. That's the difference between underwriting and a spot. Checked
// as it's typed; it can't be sent until it passes.

export type CreditFlagKind = "price_or_offer" | "comparison" | "call_to_action";

export interface CreditFlag {
  kind: CreditFlagKind;
  /** The words that were flagged, as typed. */
  text: string;
  start: number;
  end: number;
  suggestion: string;
}

interface Rule {
  kind: CreditFlagKind;
  pattern: RegExp;
  suggestion: string;
}

const RULES: Rule[] = [
  { kind: "price_or_offer", pattern: /\$\s?\d[\d,.]*|\b\d+(?:\.\d+)?\s?(?:%|(?:percent|dollars?|cents?)\b)/gi, suggestion: "Remove the price. Credits can't mention prices." },
  {
    kind: "price_or_offer",
    pattern: /\b(?:free|discounts?|sales?|deals?|coupons?|specials?|bogo|buy one|half[- ]off|save|savings|off\b|limited time|promo(?:tion)?s?)\b/gi,
    suggestion: "Remove the offer. Say what the business does instead."
  },
  {
    kind: "comparison",
    pattern: /\b(?:best|better|#\s?1|number one|top[- ]rated|finest|greatest|cheapest|lowest|biggest|largest|leading|unbeatable|award[- ]winning|favou?rite)\b/gi,
    suggestion: "Remove the comparison. Describe what they do, not how they rank."
  },
  {
    kind: "call_to_action",
    pattern: /\b(?:come (?:by|in|down|visit)|stop (?:by|in)|call(?: us)?|visit(?: us)?|order|book|shop|try|buy|get yours|sign up|join|download|click|scan|hurry|don't miss|today only|now)\b/gi,
    suggestion: "Remove the call to action. A credit names them; it doesn't ask anyone to do anything."
  }
];

export function checkCreditText(text: string): { passes: boolean; flags: CreditFlag[] } {
  const flags: CreditFlag[] = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // One flag per span of words; the first rule to find it wins.
      if (flags.some((f) => start < f.end && end > f.start)) continue;
      flags.push({ kind: rule.kind, text: match[0], start, end, suggestion: rule.suggestion });
    }
  }
  flags.sort((a, b) => a.start - b.start);
  return { passes: flags.length === 0 && text.trim().length > 0, flags };
}

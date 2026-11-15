import type { Category } from './types';

// Order matters: "shirt dress" should be a dress, "dress shirt" a top — so we
// check the last matching keyword in the title (the head noun usually comes last).
const RULES: [Category, RegExp][] = [
  ['dress', /\b(dress(es)?|gown|jumpsuit|playsuit|romper|maxi|midi|frock|saree|sari|anarkali|lehenga)\b/gi],
  ['bottom', /\b(jeans|trousers?|pants|chinos|joggers|shorts|skirts?|leggings|track ?pants|cargos?|palazzos?|culottes)\b/gi],
  ['top', /\b(t-?shirts?|tees?|shirts?|tops?|blouses?|kurtas?|kurtis?|hoodies?|sweatshirts?|sweaters?|jumpers?|cardigans?|jackets?|blazers?|coats?|polos?|tank ?tops?|camisoles?|vests?|tunics?|crop ?tops?|pullovers?|overshirts?)\b/gi],
];

export function classifyGarment(text: string): Category | null {
  let best: { cat: Category; index: number } | null = null;
  for (const [cat, re] of RULES) {
    for (const m of text.matchAll(re)) {
      if (!best || m.index! > best.index) best = { cat, index: m.index! };
    }
  }
  return best?.cat ?? null;
}

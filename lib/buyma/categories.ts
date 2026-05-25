import { BUYMA_CATEGORIES } from "./id-data";
import type { ProductDraft } from "./types";
import { cleanText } from "./text";

export type BuymaCategoryGender = "men" | "women";

const WOMEN_CATEGORY_PREFIXES = ["여성 패션/", "レディースファッション/"];
const MEN_CATEGORY_PREFIXES = ["남성 패션/", "メンズファッション/"];

const CATEGORY_BY_ID = new Map<string, (typeof BUYMA_CATEGORIES)[number]>(
  BUYMA_CATEGORIES.map((category) => [category.id, category]),
);

const CATEGORY_PAIR_INDEX = BUYMA_CATEGORIES.reduce((index, category) => {
  const gender = getBuymaCategoryGender(category.id);
  const pairKey = getCategoryPairKey(category.label);
  if (!gender || !pairKey) return index;

  const current = index.get(pairKey) ?? {};
  current[gender] = category.id;
  index.set(pairKey, current);
  return index;
}, new Map<string, Partial<Record<BuymaCategoryGender, string>>>());

export function isValidBuymaCategoryId(categoryId: unknown) {
  const id = cleanText(categoryId);
  return Boolean(id && CATEGORY_BY_ID.has(id));
}

export function getBuymaCategoryGender(categoryId: unknown): BuymaCategoryGender | null {
  const label = CATEGORY_BY_ID.get(cleanText(categoryId))?.label ?? "";
  if (WOMEN_CATEGORY_PREFIXES.some((prefix) => label.startsWith(prefix))) return "women";
  if (MEN_CATEGORY_PREFIXES.some((prefix) => label.startsWith(prefix))) return "men";
  return null;
}

export function getPairedBuymaCategoryId(
  categoryId: unknown,
  targetGender: BuymaCategoryGender,
) {
  const category = CATEGORY_BY_ID.get(cleanText(categoryId));
  if (!category) return "";

  const pairKey = getCategoryPairKey(category.label);
  if (!pairKey) return "";

  return CATEGORY_PAIR_INDEX.get(pairKey)?.[targetGender] ?? "";
}

export function resolveUnisexBuymaCategories(
  product: Pick<ProductDraft, "category" | "menCategory" | "womenCategory">,
) {
  let menCategory = getBuymaCategoryGender(product.menCategory) === "men"
    ? cleanText(product.menCategory)
    : "";
  let womenCategory = getBuymaCategoryGender(product.womenCategory) === "women"
    ? cleanText(product.womenCategory)
    : "";
  const category = cleanText(product.category);
  const categoryGender = getBuymaCategoryGender(category);

  if (!menCategory && categoryGender === "men") menCategory = category;
  if (!womenCategory && categoryGender === "women") womenCategory = category;
  if (!menCategory && womenCategory) menCategory = getPairedBuymaCategoryId(womenCategory, "men");
  if (!womenCategory && menCategory) womenCategory = getPairedBuymaCategoryId(menCategory, "women");

  return { menCategory, womenCategory };
}

function getCategoryPairKey(label: string) {
  const normalizedLabel = cleanText(label);
  const allPrefixes = [...WOMEN_CATEGORY_PREFIXES, ...MEN_CATEGORY_PREFIXES];
  const matchedPrefix = allPrefixes.find((prefix) => normalizedLabel.startsWith(prefix));
  return matchedPrefix ? normalizedLabel.slice(matchedPrefix.length) : "";
}

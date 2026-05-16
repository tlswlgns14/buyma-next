import { BUYMA_BRANDS_FROM_CSV } from "./brand-data";
import { cleanText } from "./text";

type BuymaBrand = {
  id: string;
  name: string;
  nameJp: string;
  aliases?: string[];
};

export type BuymaBrandOption = {
  id: string;
  name: string;
  nameJp: string;
  displayName: string;
  searchText: string;
};

const BRAND_ALIASES: Record<string, string[]> = {
  "8931": ["MLB"],
  "9810": ["DISCOVERY"],
  "17507": ["??"],
};

const BUYMA_BRANDS: BuymaBrand[] = BUYMA_BRANDS_FROM_CSV.map((brand) => ({
  ...brand,
  aliases: BRAND_ALIASES[brand.id],
}));

export const BUYMA_BRAND_OPTIONS: BuymaBrandOption[] = BUYMA_BRANDS.map((brand) => ({
  id: brand.id,
  name: brand.name,
  nameJp: brand.nameJp,
  displayName: `${brand.name}(${brand.nameJp})`,
  searchText: [brand.id, brand.name, brand.nameJp, ...(brand.aliases ?? [])]
    .map(normalizeBrandSearchText)
    .filter(Boolean)
    .join(" "),
}));

export function findBuymaBrand(brandName: string) {
  const normalized = normalizeBrandSearchText(brandName);
  if (!normalized) return null;

  const exact = BUYMA_BRANDS.find((brand) =>
    getBrandSearchValues(brand).some((value) => value === normalized),
  );
  if (exact) return toResolvedBrand(exact);

  const compact = compactBrandSearchText(normalized);
  if (!compact) return null;

  const compactExact = BUYMA_BRANDS.find((brand) =>
    getBrandSearchValues(brand).some((value) => compactBrandSearchText(value) === compact),
  );
  if (compactExact) return toResolvedBrand(compactExact);

  return null;
}

function toResolvedBrand(brand: BuymaBrand) {
  return {
    ...brand,
    displayName: `${brand.name}(${brand.nameJp})`,
  };
}

function getBrandSearchValues(brand: BuymaBrand) {
  return [brand.name, brand.nameJp, `${brand.name} ${brand.nameJp}`, ...(brand.aliases ?? [])]
    .map(normalizeBrandSearchText)
    .filter(Boolean);
}

function normalizeBrandSearchText(value: string) {
  return cleanText(value)
    .replace(/[【】[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function compactBrandSearchText(value: string) {
  return normalizeBrandSearchText(value).replace(/[^A-Z0-9ぁ-んァ-ヶー一-龠]/g, "");
}

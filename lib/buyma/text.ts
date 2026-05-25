const COLOR_MAP: Record<string, string> = {
  "\uBE14\uB799": "BLACK",
  "\uAC80\uC815": "BLACK",
  "\uAC80\uC815\uC0C9": "BLACK",
  "\uD654\uC774\uD2B8": "WHITE",
  "\uD770\uC0C9": "WHITE",
  "\uC544\uC774\uBCF4\uB9AC": "IVORY",
  "\uD06C\uB9BC": "CREAM",
  "\uADF8\uB808\uC774": "GRAY",
  "\uD68C\uC0C9": "GRAY",
  "\uCC28\uCF5C": "GRAY",
  "\uBE0C\uB77C\uC6B4": "BROWN",
  "\uAC08\uC0C9": "BROWN",
  "\uBCA0\uC774\uC9C0": "BEIGE",
  "\uADF8\uB9B0": "GREEN",
  "\uCD08\uB85D": "GREEN",
  "\uCE74\uD0A4": "GREEN",
  "\uBE14\uB8E8": "BLUE",
  "\uD30C\uB791": "BLUE",
  "\uD30C\uB780\uC0C9": "BLUE",
  "\uB124\uC774\uBE44": "NAVY",
  "\uB0A8\uC0C9": "NAVY",
  "\uD37C\uD50C": "PURPLE",
  "\uBCF4\uB77C": "PURPLE",
  "\uC610\uB85C\uC6B0": "YELLOW",
  "\uB178\uB791": "YELLOW",
  "\uD551\uD06C": "PINK",
  "\uBD84\uD64D": "PINK",
  "\uB808\uB4DC": "RED",
  "\uBE68\uAC15": "RED",
  "\uC624\uB80C\uC9C0": "ORANGE",
  "\uC8FC\uD669": "ORANGE",
  "\uC2E4\uBC84": "SILVER",
  "\uC740\uC0C9": "SILVER",
  "\uACE8\uB4DC": "GOLD",
  "\uAE08\uC0C9": "GOLD",
  "\uD22C\uBA85": "CLEAR",
  "\uBA40\uD2F0": "MULTI",
};

const COLOR_CODE_MAP: Record<string, string> = {
  BK: "BLACK",
  BLK: "BLACK",
  BKS: "BLACK",
  WH: "WHITE",
  WHT: "WHITE",
  IV: "IVORY",
  IVR: "IVORY",
  GY: "GRAY",
  GRY: "GRAY",
  CH: "GRAY",
  BE: "BEIGE",
  BG: "BEIGE",
  BR: "BROWN",
  BRN: "BROWN",
  GRN: "GREEN",
  KH: "GREEN",
  BL: "BLUE",
  NV: "NAVY",
  NAVY: "NAVY",
  PK: "PINK",
  RD: "RED",
  OR: "ORANGE",
  SV: "SILVER",
  SLV: "SILVER",
  GD: "GOLD",
};

const COLOR_SYSTEM_KEYWORDS: Array<[string, string]> = [
  ["WHITE", "1"],
  ["IVORY", "1"],
  ["CREAM", "5"],
  ["BLACK", "2"],
  ["GRAY", "3"],
  ["GREY", "3"],
  ["BROWN", "4"],
  ["BEIGE", "5"],
  ["GREEN", "6"],
  ["BLUE", "7"],
  ["PURPLE", "8"],
  ["YELLOW", "9"],
  ["PINK", "10"],
  ["RED", "11"],
  ["ORANGE", "12"],
  ["SILVER", "13"],
  ["GOLD", "14"],
  ["CLEAR", "15"],
  ["NAVY", "16"],
  ["MULTI", "99"],
];

const COLOR_SYSTEM_ALIASES: Array<[string, string[]]> = [
  ["99", ["MULTI", "MULTICOLOR", "MULTI COLOR", "MIX", "MIXED", "COMBO", "ASSORTED", "COLORBLOCK", "COLOR BLOCK"]],
  ["16", ["NAVY", "MIDNIGHT", "INK"]],
  ["1", ["OFF WHITE", "OFFWHITE", "WHITE", "IVORY"]],
  ["2", ["BLACK", "BLK"]],
  ["3", ["CHARCOAL", "GREY", "GRAY", "HEATHER GREY", "HEATHER GRAY", "ASH", "MELANGE"]],
  ["5", ["CREAM", "BEIGE", "ECRU", "NATURAL", "OATMEAL", "SAND", "TAN", "TAUPE", "STONE", "BONE"]],
  ["4", ["BROWN", "MOCHA", "CHOCOLATE", "COCOA", "COFFEE"]],
  ["6", ["GREEN", "OLIVE", "KHAKI", "MINT", "LIME", "SAGE", "FOREST"]],
  ["7", ["BLUE", "SKY", "SAX", "CYAN", "TURQUOISE", "TEAL"]],
  ["8", ["PURPLE", "VIOLET", "LAVENDER", "LILAC"]],
  ["9", ["YELLOW", "LEMON", "MUSTARD"]],
  ["10", ["PINK", "ROSE", "MAGENTA", "FUCHSIA"]],
  ["11", ["RED", "BURGUNDY", "WINE", "MAROON"]],
  ["12", ["ORANGE", "CORAL"]],
  ["13", ["SILVER"]],
  ["14", ["GOLD"]],
  ["15", ["CLEAR", "TRANSPARENT"]],
];

export function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePrice(value: unknown) {
  const numeric = String(value ?? "").replace(/[^\d.]/g, "");
  return Number.parseFloat(numeric) || 0;
}

export function calculateSellingPrice(
  krwPrice: number,
  marginRate: number,
  exchangeRate: number,
) {
  if (!Number.isFinite(krwPrice) || krwPrice <= 0) return 0;
  const raw = krwPrice * exchangeRate * (1 + marginRate / 100);
  return Math.ceil(raw / 100) * 100;
}

export function extractBrand(title: string) {
  const bracket = title.match(/[【\[]([^】\]]+)[】\]]/);
  if (bracket?.[1]) return cleanText(bracket[1]);

  const words = cleanText(title).split(" ");
  const uppercasePrefix = words.find((word) => /^[A-Z][A-Z0-9&.-]{1,}$/.test(word));
  return uppercasePrefix ?? "";
}

export function extractModelNumber(title: string) {
  const text = cleanText(title);
  const patterns = [
    /品番[:\s]*([A-Z0-9_-]{3,40})/i,
    /\bstyle[:\s#]*([A-Z0-9_-]{4,40})\b/i,
    /\barticle[:\s#]*([A-Z0-9_-]{4,40})\b/i,
    /\b[A-Z]{1,6}\d{2,}[A-Z0-9_-]*\b/i,
    /\b[A-Z0-9]{2,}[-_][A-Z0-9_-]{2,}\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1] || match[0];
  }

  return "";
}

export function convertColorToEnglish(color: string) {
  const cleaned = cleanText(color).toUpperCase();
  if (!cleaned) return "";
  for (const [ko, en] of Object.entries(COLOR_MAP)) {
    if (color.includes(ko)) return en;
  }
  const codeColor = COLOR_CODE_MAP[cleaned.replace(/[^A-Z0-9]/g, "")];
  if (codeColor) return codeColor;
  return cleaned;
}

export function getColorSystemId(color: string) {
  const converted = convertColorToEnglish(color).toUpperCase();
  if (!converted || /^(FREE|ONE SIZE|W|M|F|WOMEN|WOMAN|MEN|MAN|UNISEX)$/i.test(converted)) return "";

  const searchText = normalizeColorSearchText(`${color} ${converted}`);
  if (hasMultipleColorSegments(color)) return "99";

  const aliasMatch = findColorSystemAlias(searchText);
  if (aliasMatch) return aliasMatch;

  const found = COLOR_SYSTEM_KEYWORDS.find(([keyword]) => hasColorKeyword(searchText, keyword));
  return found?.[1] ?? "";
}

function normalizeColorSearchText(value: string) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findColorSystemAlias(value: string) {
  for (const [id, aliases] of COLOR_SYSTEM_ALIASES) {
    if (aliases.some((alias) => hasColorKeyword(value, alias))) return id;
  }
  return "";
}

function hasMultipleColorSegments(value: string) {
  const segments = cleanText(value).split(/\s*(?:\/|,|\+|&|\bAND\b)\s*/i).filter(Boolean);
  if (segments.length < 2) return false;

  const matchedSegments = segments.filter((segment) =>
    findColorSystemAlias(normalizeColorSearchText(`${segment} ${convertColorToEnglish(segment)}`)),
  );
  return matchedSegments.length >= 2;
}

function hasColorKeyword(value: string, keyword: string) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, "i").test(value);
}

export function splitListInput(value: string) {
  return value
    .split(/[,/\n]/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

export function sanitizeForCsv(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, "<br>");
  if (text.trim() === "") return "";
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function truncateByByteLength(value: string, maxBytes: number) {
  let bytes = 0;
  let result = "";

  for (const char of value) {
    const charBytes = char.charCodeAt(0) > 255 ? 2 : 1;
    if (bytes + charBytes > maxBytes) break;
    bytes += charBytes;
    result += char;
  }

  return result;
}

export function makeSku(index: number, _productCode: string) {
  const now = new Date();
  const timestamp =
    String(now.getFullYear()).slice(-2) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `s${timestamp}${suffix}${index.toString(36)}`;
}

export function normalizeStockStatus(value: unknown) {
  if (value === "0" || value === "soldout") return "0";
  if (value === "2") return "2";
  return "1";
}

export function makeDescription(productName: string, brand: string, colors: string[], sizes: string[]) {
  return [
    `【商品名】${productName || brand || "Fashion Item"}`,
    brand ? `【ブランド】${brand}` : "",
    colors.length ? `【カラー】${colors.join(", ")}` : "",
    sizes.length ? `【サイズ】${sizes.join(", ")}` : "",
    "※ご注文前に在庫確認をお願いいたします。",
    "※返品・交換はBUYMAの規定に従います。",
  ]
    .filter(Boolean)
    .join("\n");
}

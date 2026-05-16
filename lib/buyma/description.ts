const NOISY_SECTION_MARKERS = [
  /サイズ\s*寸法/i,
  /サイズ\s*詳細/i,
  /サイズ\s*表/i,
  /実寸/i,
  /肩幅\s*[（(]?\s*A\s*[）)]?/i,
  /胸囲\s*[（(]?\s*B\s*[）)]?/i,
  /裾\s*[（(]?\s*C\s*[）)]?/i,
  /小売筒周り\s*[（(]?\s*E\s*[）)]?/i,
  /商品情報\s*報告時/i,
  /製造国/i,
  /製造局/i,
  /メーカー/i,
  /製造年月/i,
  /韓国製造年月/i,
  /表地\s*\d+%/i,
  /サイズ\s*(?:XS|S|M|L|XL|XXL)\b/i,
  /사이즈\s*치수/i,
  /사이즈\s*상세/i,
  /실측/i,
  /어깨\s*너비/i,
  /가슴\s*둘레/i,
  /밑단/i,
  /상품\s*정보/i,
  /제조국/i,
  /제조사/i,
  /제조년월/i,
  /겉감\s*\d+%/i,
];

export function stripMusinsaDescriptionNoise(value: string) {
  let text = value;
  for (const marker of NOISY_SECTION_MARKERS) {
    const match = marker.exec(text);
    if (match?.index !== undefined) text = text.slice(0, match.index);
  }

  return text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isNoisyDescriptionLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isNoisyDescriptionLine(line: string) {
  return NOISY_SECTION_MARKERS.some((marker) => marker.test(line));
}

import type { PlayerGrowth } from "./progression.js";

/** 꾸밀 수 있는 자리. 정답 표시·액자는 내 화면에만, 프로필 그림·테두리·칭호는 상대에게도 보인다. */
export const COSMETIC_SLOTS = ["marker", "frame", "avatar", "profile", "title"] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

export interface CosmeticItem {
  id: string;
  slot: CosmeticSlot;
  name: string;
  description: string;
  /** 코인 가격. 0이면 레벨만 되면 바로 쓸 수 있다. */
  price: number;
  /** 이 레벨부터 구매·사용할 수 있다. */
  minLevel: number;
}

export type CosmeticLoadout = Record<CosmeticSlot, string>;

/** 상대에게 보이는 꾸미기 */
export interface PublicCosmetics {
  avatar: string;
  profile: string;
  title: string;
}

const item = (slot: CosmeticSlot, id: string, name: string, description: string, price: number, minLevel = 1): CosmeticItem =>
  ({ id, slot, name, description, price, minLevel });

/** 아이템 목록의 정본. 새 아이템은 여기에 추가하고 웹 스타일을 함께 만든다. */
export const COSMETIC_ITEMS: readonly CosmeticItem[] = [
  item("marker", "marker-viewfinder", "뷰파인더", "기본 정답 표시", 0),
  item("marker", "marker-ring", "얇은 원", "찾은 곳을 얇은 원으로 표시해요", 500),
  item("marker", "marker-gold", "금빛 뷰파인더", "금색 꺾쇠로 표시해요", 0, 3),
  item("marker", "marker-brush", "붓 동그라미", "손으로 그린 듯한 동그라미", 1200),
  item("marker", "marker-glow", "빛 번짐", "찾은 곳이 은은하게 빛나요", 2000, 10),

  item("frame", "frame-none", "액자 없음", "그림만 깔끔하게", 0),
  item("frame", "frame-wood", "원목 액자", "따뜻한 나무 테두리", 800),
  item("frame", "frame-mat", "흰 여백", "갤러리처럼 흰 여백을 둘러요", 1000),
  item("frame", "frame-gold", "금빛 액자", "고전 회화 같은 금테", 1500, 5),
  item("frame", "frame-black", "검은 테", "얇고 단단한 검은 테", 2000, 8),

  item("avatar", "avatar-initial", "첫 글자", "닉네임 첫 글자를 보여줘요", 0),
  item("avatar", "avatar-palette", "화가의 팔레트", "물감이 묻은 팔레트와 붓", 600),
  item("avatar", "avatar-loupe", "탐정 돋보기", "밤하늘색 바탕의 금빛 돋보기", 900),
  item("avatar", "avatar-cat", "갤러리 고양이", "노란 눈의 검은 고양이", 1200),
  item("avatar", "avatar-fox", "붉은 여우", "영리한 붉은 여우", 1500, 3),
  item("avatar", "avatar-owl", "밤 부엉이", "별빛 아래 금빛 눈의 부엉이", 1800, 4),
  item("avatar", "avatar-bloom", "온실의 꽃", "비밀의 온실에 핀 꽃", 2000, 5),
  item("avatar", "avatar-moon", "달빛 천문대", "금빛 초승달과 별", 2500, 7),
  item("avatar", "avatar-crown", "금빛 초상", "금 액자 속 왕관", 3000, 10),

  item("profile", "profile-none", "기본 테두리", "레벨 링만 보여요", 0),
  item("profile", "profile-sage", "세이지", "차분한 초록 테두리", 800),
  item("profile", "profile-gold", "금빛 테두리", "반짝이는 금색 테두리", 1500, 5),
  item("profile", "profile-double", "이중 테두리", "두 겹으로 두른 테두리", 2500, 10),

  item("title", "title-visitor", "새내기 관람객", "처음 전시를 찾은 관람객", 0),
  item("title", "title-eye", "눈썰미 장인", "레벨 5에 받는 칭호", 0, 5),
  item("title", "title-detective", "숨은그림 탐정", "작은 차이도 놓치지 않아요", 1000),
  item("title", "title-curator", "갤러리 큐레이터", "레벨 10 이상만 쓸 수 있어요", 3000, 10),
];

export const COSMETIC_ITEM_BY_ID: Readonly<Record<string, CosmeticItem>> = Object.fromEntries(COSMETIC_ITEMS.map((entry) => [entry.id, entry]));

export const DEFAULT_LOADOUT: CosmeticLoadout = {
  marker: "marker-viewfinder",
  frame: "frame-none",
  avatar: "avatar-initial",
  profile: "profile-none",
  title: "title-visitor",
};

export function normalizeLoadout(value: unknown): CosmeticLoadout {
  const input = value && typeof value === "object" ? value as Partial<Record<CosmeticSlot, unknown>> : {};
  const loadout = { ...DEFAULT_LOADOUT };
  for (const slot of COSMETIC_SLOTS) {
    const id = input[slot];
    if (typeof id === "string" && COSMETIC_ITEM_BY_ID[id]?.slot === slot) loadout[slot] = id;
  }
  return loadout;
}

export function normalizeOwnedItems(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && Boolean(COSMETIC_ITEM_BY_ID[id])))] : [];
}

/** 무료 아이템은 레벨만 되면, 유료 아이템은 구매해야 보유한다. */
export function ownsItem(growth: Pick<PlayerGrowth, "ownedItems">, level: number, entry: CosmeticItem): boolean {
  if (level < entry.minLevel) return false;
  return entry.price === 0 || growth.ownedItems.includes(entry.id);
}

export function ownedItemIds(growth: Pick<PlayerGrowth, "ownedItems">, level: number): string[] {
  return COSMETIC_ITEMS.filter((entry) => ownsItem(growth, level, entry)).map((entry) => entry.id);
}

export function publicCosmetics(loadout: CosmeticLoadout): PublicCosmetics {
  return { avatar: loadout.avatar, profile: loadout.profile, title: loadout.title };
}

export type CosmeticResult =
  | { ok: true; growth: PlayerGrowth }
  | { ok: false; code: "ITEM_NOT_FOUND" | "ITEM_LOCKED" | "ITEM_OWNED" | "NOT_ENOUGH_COINS" | "ITEM_NOT_OWNED"; message: string };

/** 코인으로 아이템을 사고 바로 착용한다. */
export function buyCosmetic(growth: PlayerGrowth, level: number, itemId: string): CosmeticResult {
  const entry = COSMETIC_ITEM_BY_ID[itemId];
  if (!entry) return { ok: false, code: "ITEM_NOT_FOUND", message: "없는 아이템이에요." };
  if (level < entry.minLevel) return { ok: false, code: "ITEM_LOCKED", message: `레벨 ${entry.minLevel}부터 쓸 수 있어요.` };
  if (ownsItem(growth, level, entry)) return { ok: false, code: "ITEM_OWNED", message: "이미 가지고 있어요." };
  if (growth.coins < entry.price) return { ok: false, code: "NOT_ENOUGH_COINS", message: "코인이 부족해요." };
  return {
    ok: true,
    growth: {
      ...growth,
      coins: growth.coins - entry.price,
      ownedItems: [...growth.ownedItems, entry.id],
      loadout: { ...growth.loadout, [entry.slot]: entry.id },
    },
  };
}

export function equipCosmetic(growth: PlayerGrowth, level: number, itemId: string): CosmeticResult {
  const entry = COSMETIC_ITEM_BY_ID[itemId];
  if (!entry) return { ok: false, code: "ITEM_NOT_FOUND", message: "없는 아이템이에요." };
  if (!ownsItem(growth, level, entry)) {
    return level < entry.minLevel
      ? { ok: false, code: "ITEM_LOCKED", message: `레벨 ${entry.minLevel}부터 쓸 수 있어요.` }
      : { ok: false, code: "ITEM_NOT_OWNED", message: "먼저 구매해주세요." };
  }
  return { ok: true, growth: { ...growth, loadout: { ...growth.loadout, [entry.slot]: entry.id } } };
}

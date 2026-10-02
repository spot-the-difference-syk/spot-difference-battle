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
  /** 랭킹 보상으로만 받을 수 있다(살 수 없다). */
  rewardOnly?: boolean;
  /**
   * 명작 컬렉션: 움직이는 고급 아이템. 레벨 제한 없이 코인으로 산다.
   * 나중에 현금 결제를 붙일 때 이 표시로 상품을 묶는다(docs/MONETIZATION.md).
   */
  premium?: boolean;
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
const premium = (slot: CosmeticSlot, id: string, name: string, description: string, price: number): CosmeticItem =>
  ({ id, slot, name, description, price, minLevel: 1, premium: true });
const reward = (slot: CosmeticSlot, id: string, name: string, description: string): CosmeticItem =>
  ({ id, slot, name, description, price: 0, minLevel: 1, rewardOnly: true });

/**
 * 아이템 목록의 정본. 새 아이템은 여기에 추가하고 웹 스타일(프로필 그림은 SVG)을 함께 만든다.
 * 가격 기준: 레벨 1~9는 400~3,000, 10~19는 2,000~4,500, 20~29는 4,000~7,500, 30~39는 6,500~10,000, 40~50은 15,000코인 이하.
 * 5레벨마다 무료 칭호·꾸미기를 하나씩 준다.
 */
export const COSMETIC_ITEMS: readonly CosmeticItem[] = [
  // 정답 표시: 내 화면에서 찾은 곳을 표시하는 모양
  item("marker", "marker-viewfinder", "뷰파인더", "기본 정답 표시", 0),
  item("marker", "marker-dot", "작은 점", "가운데 점과 옅은 원", 400),
  item("marker", "marker-ring", "얇은 원", "찾은 곳을 얇은 원으로 표시해요", 500),
  item("marker", "marker-dashed", "점선 원", "연필로 그린 듯한 점선", 700, 2),
  item("marker", "marker-gold", "금빛 뷰파인더", "금색 꺾쇠로 표시해요", 0, 3),
  item("marker", "marker-brush", "붓 동그라미", "손으로 그린 듯한 동그라미", 1200),
  item("marker", "marker-heart", "하트", "찾은 곳에 분홍 하트", 900, 4),
  item("marker", "marker-star", "반짝 별", "노란 별이 반짝여요", 1500, 6),
  item("marker", "marker-crosshair", "조준경", "정밀한 십자 조준선", 1800, 8),
  item("marker", "marker-glow", "빛 번짐", "찾은 곳이 은은하게 빛나요", 2000, 10),
  item("marker", "marker-stamp", "검수 도장", "빨간 확인 도장을 꾹", 2600, 12),
  item("marker", "marker-paw", "고양이 발자국", "말랑한 발바닥 도장", 3000, 15),
  item("marker", "marker-neon", "네온 링", "분홍·하늘색 네온 고리", 4200, 18),
  item("marker", "marker-wreath", "잎사귀 화관", "초록 잎으로 엮은 고리", 5000, 22),
  item("marker", "marker-rainbow", "무지개 고리", "일곱 빛깔로 도는 고리", 6500, 28),
  item("marker", "marker-comet", "혜성", "꼬리를 단 빛나는 혜성", 8500, 36),
  item("marker", "marker-diamond", "다이아몬드 컷", "보석처럼 깎인 표시", 12000, 45),
  premium("marker", "marker-sparkle", "반짝이 가루", "작은 별들이 반짝이며 맴돌아요", 5000),
  premium("marker", "marker-butterfly", "나비", "찾은 곳에 나비가 날개짓해요", 7000),
  premium("marker", "marker-firework", "불꽃놀이", "찾을 때마다 불꽃이 터져요", 9000),

  // 액자: 내 화면의 그림 두 장을 감싸는 테두리
  item("frame", "frame-none", "액자 없음", "그림만 깔끔하게", 0),
  item("frame", "frame-mint", "파스텔 민트", "산뜻한 민트색 테", 600),
  item("frame", "frame-wood", "원목 액자", "따뜻한 나무 테두리", 800),
  item("frame", "frame-mat", "흰 여백", "갤러리처럼 흰 여백을 둘러요", 1000),
  item("frame", "frame-tape", "마스킹 테이프", "모서리에 테이프를 붙인 여백", 1200, 4),
  item("frame", "frame-gold", "금빛 액자", "고전 회화 같은 금테", 1500, 5),
  item("frame", "frame-polaroid", "즉석 사진", "아래가 넓은 흰 테", 1600, 6),
  item("frame", "frame-black", "검은 테", "얇고 단단한 검은 테", 2000, 8),
  item("frame", "frame-bamboo", "대나무", "마디가 보이는 대나무 테", 2400, 10),
  item("frame", "frame-velvet", "벨벳 네이비", "깊은 남색 벨벳", 2800, 12),
  item("frame", "frame-film", "필름 스트립", "구멍이 뚫린 필름 테", 3600, 14),
  item("frame", "frame-marble", "대리석", "결이 흐르는 흰 대리석", 4200, 17),
  item("frame", "frame-deco", "아르데코", "검정과 금색 줄무늬", 5000, 20),
  item("frame", "frame-stained", "스테인드글라스", "빛이 비치는 색유리", 6000, 25),
  item("frame", "frame-neon", "네온 사인", "밤거리의 네온 불빛", 7500, 30),
  item("frame", "frame-baroque", "바로크 금장", "겹겹이 새긴 금장 액자", 10000, 38),
  item("frame", "frame-aurora", "오로라", "북극의 빛이 일렁이는 테", 15000, 48),
  premium("frame", "frame-sakura", "벚꽃 액자", "꽃잎이 흩날리는 분홍 액자", 9000),
  premium("frame", "frame-starry", "별밤 액자", "소용돌이치는 별밤이 흐르는 액자", 12000),
  premium("frame", "frame-masterpiece", "명작 금장", "미술관 명작에 두르는 조각 금장", 16000),

  // 프로필 그림: 상대에게도 보인다. 그림은 apps/web/src/assets/avatars/<ID>.svg
  item("avatar", "avatar-initial", "첫 글자", "닉네임 첫 글자를 보여줘요", 0),
  item("avatar", "avatar-coffee", "커피 한 잔", "김이 오르는 라테", 500),
  item("avatar", "avatar-palette", "화가의 팔레트", "물감이 묻은 팔레트와 붓", 600),
  item("avatar", "avatar-loupe", "탐정 돋보기", "밤하늘색 바탕의 금빛 돋보기", 900),
  item("avatar", "avatar-cactus", "작은 선인장", "화분 속 동글동글 선인장", 1000, 2),
  item("avatar", "avatar-rabbit", "흰 토끼", "분홍 귀의 흰 토끼", 1100, 2),
  item("avatar", "avatar-cat", "갤러리 고양이", "노란 눈의 검은 고양이", 1200),
  item("avatar", "avatar-panda", "판다", "대나무를 좋아하는 판다", 1400, 3),
  item("avatar", "avatar-fox", "붉은 여우", "영리한 붉은 여우", 1500, 3),
  item("avatar", "avatar-penguin", "펭귄", "목도리를 두른 펭귄", 1600, 4),
  item("avatar", "avatar-owl", "밤 부엉이", "별빛 아래 금빛 눈의 부엉이", 1800, 4),
  item("avatar", "avatar-bloom", "온실의 꽃", "비밀의 온실에 핀 꽃", 2000, 5),
  item("avatar", "avatar-hedgehog", "고슴도치", "밤송이 같은 고슴도치", 2200, 6),
  item("avatar", "avatar-moon", "달빛 천문대", "금빛 초승달과 별", 2500, 7),
  item("avatar", "avatar-camera", "필름 카메라", "추억을 담는 필름 카메라", 2600, 8),
  item("avatar", "avatar-crown", "금빛 초상", "금 액자 속 왕관", 3000, 10),
  item("avatar", "avatar-whale", "푸른 고래", "물을 뿜는 푸른 고래", 3200, 11),
  item("avatar", "avatar-mushroom", "버섯 집", "창문이 달린 빨간 버섯 집", 3600, 13),
  item("avatar", "avatar-balloon", "열기구", "하늘을 나는 줄무늬 열기구", 4000, 16),
  item("avatar", "avatar-lighthouse", "등대", "밤바다를 비추는 등대", 4500, 19),
  item("avatar", "avatar-unicorn", "유니콘", "무지개 갈기의 유니콘", 5500, 23),
  item("avatar", "avatar-dragon", "아기 용", "작은 날개의 초록 용", 6500, 27),
  item("avatar", "avatar-astronaut", "우주비행사", "별 사이를 걷는 우주비행사", 7500, 31),
  item("avatar", "avatar-phoenix", "불사조", "불꽃 날개의 불사조", 9000, 37),
  item("avatar", "avatar-gem", "보석", "빛을 머금은 푸른 보석", 12000, 43),
  item("avatar", "avatar-laurel", "월계관", "최고 레벨 감정사의 월계관", 0, 50),
  premium("avatar", "avatar-sunflower", "해바라기", "바람에 흔들리는 해바라기", 6000),
  premium("avatar", "avatar-sakuracat", "벚꽃 고양이", "꽃잎이 흩날리는 봄날의 고양이", 7000),
  premium("avatar", "avatar-koi", "연못의 비단잉어", "물결 위를 맴도는 비단잉어 한 쌍", 8000),
  premium("avatar", "avatar-wave", "큰 파도", "붉은 해 아래 굽이치는 파도", 8000),
  premium("avatar", "avatar-starry", "별이 빛나는 밤", "소용돌이 하늘에 별이 반짝여요", 9000),
  premium("avatar", "avatar-galaxywhale", "은하 고래", "별바다를 헤엄치는 고래", 10000),

  // 프로필 테두리: 상대에게도 보인다.
  item("profile", "profile-none", "기본 테두리", "레벨 링만 보여요", 0),
  item("profile", "profile-rose", "로즈", "부드러운 장밋빛 테두리", 500),
  item("profile", "profile-sky", "하늘", "맑은 하늘색 테두리", 500),
  item("profile", "profile-sage", "세이지", "차분한 초록 테두리", 800),
  item("profile", "profile-lavender", "라벤더", "은은한 보라 테두리", 800, 2),
  item("profile", "profile-dotted", "점선", "톡톡 찍은 점선 테두리", 1200, 3),
  item("profile", "profile-gold", "금빛 테두리", "반짝이는 금색 테두리", 1500, 5),
  item("profile", "profile-silver", "은빛 테두리", "차갑게 빛나는 은색 테두리", 1800, 7),
  item("profile", "profile-sakura", "벚꽃", "분홍에서 흰색으로 번지는 테두리", 2200, 9),
  item("profile", "profile-double", "이중 테두리", "두 겹으로 두른 테두리", 2500, 10),
  item("profile", "profile-ocean", "바다", "파도처럼 푸른 그라데이션", 3000, 12),
  item("profile", "profile-sunset", "노을", "주황에서 보라로 물드는 테두리", 3600, 14),
  item("profile", "profile-neon", "네온", "빛나는 네온 테두리", 4500, 18),
  item("profile", "profile-rainbow", "무지개", "일곱 빛깔 테두리", 5500, 22),
  item("profile", "profile-aurora", "오로라", "천천히 도는 오로라 빛", 7000, 28),
  item("profile", "profile-ruby", "루비", "깊은 붉은 보석 테두리", 8500, 34),
  item("profile", "profile-diamond", "다이아몬드", "눈부신 보석 테두리", 12000, 42),
  item("profile", "profile-legend", "전설의 금테", "레벨 50에 받는 금테", 0, 50),
  premium("profile", "profile-orbit", "별 궤도", "작은 별이 프로필을 돌아요", 8000),
  premium("profile", "profile-flame", "불꽃", "일렁이는 불꽃 테두리", 10000),
  premium("profile", "profile-galaxy", "은하수", "별가루가 흐르는 은하수 고리", 12000),

  // 칭호: 상대에게도 보인다. 5레벨마다 무료 칭호
  item("title", "title-visitor", "새내기 관람객", "처음 전시를 찾은 관람객", 0),
  item("title", "title-sprout", "틀린그림 새싹", "이제 막 눈을 뜬 새싹", 400),
  item("title", "title-coffee", "커피 한 잔의 여유", "천천히 둘러보는 관람객", 600, 2),
  item("title", "title-weekend", "주말 화가", "주말마다 붓을 드는 사람", 800, 3),
  item("title", "title-eye", "눈썰미 장인", "레벨 5에 받는 칭호", 0, 5),
  item("title", "title-detective", "숨은그림 탐정", "작은 차이도 놓치지 않아요", 1000),
  item("title", "title-night", "야행성 탐험가", "밤에 더 잘 보여요", 1500, 7),
  item("title", "title-observer", "관찰의 달인", "레벨 10에 받는 칭호", 0, 10),
  item("title", "title-curator", "갤러리 큐레이터", "레벨 10 이상만 쓸 수 있어요", 3000, 10),
  item("title", "title-regular", "단골 관람객", "레벨 15에 받는 칭호", 0, 15),
  item("title", "title-light", "빛의 사냥꾼", "빛과 그림자의 차이를 찾아요", 3500, 16),
  item("title", "title-color", "색채 마법사", "색 하나 달라도 알아봐요", 4000, 18),
  item("title", "title-sharp", "날카로운 시선", "레벨 20에 받는 칭호", 0, 20),
  item("title", "title-second", "1초의 승부사", "찾는 순간 이미 눌렀어요", 5000, 23),
  item("title", "title-docent", "전시 해설가", "레벨 25에 받는 칭호", 0, 25),
  item("title", "title-collector", "디테일 수집가", "작은 것까지 모으는 사람", 6000, 27),
  item("title", "title-honor", "명예 큐레이터", "레벨 30에 받는 칭호", 0, 30),
  item("title", "title-vip", "갤러리 VIP", "전시관의 귀한 손님", 7500, 33),
  item("title", "title-restorer", "명화 복원가", "레벨 35에 받는 칭호", 0, 35),
  item("title", "title-alchemist", "눈의 연금술사", "보는 것마다 정답이 돼요", 9000, 38),
  item("title", "title-director", "미술관 관장", "레벨 40에 받는 칭호", 0, 40),
  item("title", "title-master", "감정의 대가", "레벨 45에 받는 칭호", 0, 45),
  item("title", "title-legend", "전설의 감정사", "최고 레벨 50에 받는 칭호", 0, 50),
  reward("title", "title-weekly-top", "주간 상위권", "솔로 주간 랭킹 상위 10% 이상에게 주는 칭호"),
  reward("title", "title-weekly-champion", "주간 챔피언", "솔로 주간 랭킹 1위에게 주는 칭호"),
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

/** 무료 아이템은 레벨만 되면, 유료·랭킹 보상 아이템은 받아야 보유한다. */
export function ownsItem(growth: Pick<PlayerGrowth, "ownedItems">, level: number, entry: CosmeticItem): boolean {
  if (entry.rewardOnly) return growth.ownedItems.includes(entry.id);
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
  | { ok: false; code: "ITEM_NOT_FOUND" | "ITEM_LOCKED" | "ITEM_OWNED" | "NOT_ENOUGH_COINS" | "ITEM_NOT_OWNED" | "ITEM_REWARD_ONLY"; message: string };

/** 코인으로 아이템을 사고 바로 착용한다. */
export function buyCosmetic(growth: PlayerGrowth, level: number, itemId: string): CosmeticResult {
  const entry = COSMETIC_ITEM_BY_ID[itemId];
  if (!entry) return { ok: false, code: "ITEM_NOT_FOUND", message: "없는 아이템이에요." };
  if (ownsItem(growth, level, entry)) return { ok: false, code: "ITEM_OWNED", message: "이미 가지고 있어요." };
  if (entry.rewardOnly) return { ok: false, code: "ITEM_REWARD_ONLY", message: "솔로 주간 랭킹 보상으로만 받을 수 있어요." };
  if (level < entry.minLevel) return { ok: false, code: "ITEM_LOCKED", message: `레벨 ${entry.minLevel}부터 쓸 수 있어요.` };
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
    if (entry.rewardOnly) return { ok: false, code: "ITEM_REWARD_ONLY", message: "솔로 주간 랭킹 보상으로만 받을 수 있어요." };
    return level < entry.minLevel
      ? { ok: false, code: "ITEM_LOCKED", message: `레벨 ${entry.minLevel}부터 쓸 수 있어요.` }
      : { ok: false, code: "ITEM_NOT_OWNED", message: "먼저 구매해주세요." };
  }
  return { ok: true, growth: { ...growth, loadout: { ...growth.loadout, [entry.slot]: entry.id } } };
}

export const GAME_PUZZLE_IDS = [
  "cozy-cafe",
  "enchanted-forest",
  "underwater-treasure",
  "cyber-city",
  "winter-cabin",
  "home-office",
  "farmers-market",
  "bathroom-vanity",
  "lakeside-picnic",
  "laundry-room",
] as const;

export type GamePuzzleId = (typeof GAME_PUZZLE_IDS)[number];

/** 솔로 타임어택 전용 그림. 이미지·정답은 웹 번들에 있고 서버는 수집 기록 검증에만 쓴다. */
export const SOLO_PUZZLE_IDS = [
  "observatory",
  "bakery",
  "greenhouse",
  "alpine-station",
  "clockmaker",
] as const;

export type SoloPuzzleId = (typeof SOLO_PUZZLE_IDS)[number];
export type PuzzleDifficulty = "UNRATED" | "EASY" | "MEDIUM" | "HARD";
export type PuzzleRightsStatus = "USER_SUPPLIED" | "VERIFIED" | "RESTRICTED";

export interface PuzzleAssetFileMetadata {
  fileName: string;
  sha256: string;
  mimeType: "image/webp";
  width: 1024;
  height: 1024;
}

export interface PuzzleAssetMetadata {
  version: string;
  difficulty: PuzzleDifficulty;
  rightsStatus: PuzzleRightsStatus;
  original: PuzzleAssetFileMetadata;
  modified: PuzzleAssetFileMetadata;
}

const webp = (fileName: string, sha256: string): PuzzleAssetFileMetadata => ({
  fileName,
  sha256,
  mimeType: "image/webp",
  width: 1024,
  height: 1024,
});

export const GAME_PUZZLE_ASSET_MANIFEST = {
  "cozy-cafe": {
    version: "2026-08-09.1",
    difficulty: "UNRATED",
    rightsStatus: "USER_SUPPLIED",
    original: webp("cozy-cafe-original-v2.webp", "FECEF9A7A516820856184FC91D2F08B360AD82097BF09C7BFD3797A8E298C8CD"),
    modified: webp("cozy-cafe-modified-v2.webp", "326A2EFE6464A43F964A6BCB246147E55117F64A64FE73A3E1D2DF1D45E16979"),
  },
  "enchanted-forest": {
    version: "2026-08-09.1",
    difficulty: "UNRATED",
    rightsStatus: "USER_SUPPLIED",
    original: webp("enchanted-forest-original-v2.webp", "9F6FF96BBF4F4B4C4522E406D51323B6BA4AD3885FD578DDFE3D8CDCB00D56EC"),
    modified: webp("enchanted-forest-modified-v2.webp", "F80A8E32AD962A0780574ABD9C96D41387BCF5B5E16BA54A041C218FD6B7E6B8"),
  },
  "underwater-treasure": {
    version: "2026-08-09.1",
    difficulty: "UNRATED",
    rightsStatus: "USER_SUPPLIED",
    original: webp("underwater-treasure-original-v2.webp", "3AABDCC6112C2C99C2CA0E83976379380BA5165C4DE950ABC1734DE730C479FC"),
    modified: webp("underwater-treasure-modified-v2.webp", "6BA53C42A84DEB3416BF8430EE51D3B0EEEEBEA3F409855F4DB12B3759813D7F"),
  },
  "cyber-city": {
    version: "2026-08-09.1",
    difficulty: "UNRATED",
    rightsStatus: "USER_SUPPLIED",
    original: webp("cyber-city-original-v2.webp", "867E6D835332D52F9EC0B73BCA124C1BA3D97316B3A4191CB4CCCA881738E51D"),
    modified: webp("cyber-city-modified-v2.webp", "66E9B06BE686C4364356B81D87322A078673577D4CBFFB080357E00CB8661ADF"),
  },
  "winter-cabin": {
    version: "2026-08-09.1",
    difficulty: "UNRATED",
    rightsStatus: "USER_SUPPLIED",
    original: webp("winter-cabin-original.webp", "215134746A7E741F063ED87A4008DF65B5BC1866F55E142C75175A403C9B6C6E"),
    modified: webp("winter-cabin-modified.webp", "55B52B074833BD66432FD6149FD090728D1411E9A4CB8620EECBC559D7C3C18C"),
  },
  "home-office": {
    version: "2026-08-28.2",
    difficulty: "UNRATED",
    rightsStatus: "USER_SUPPLIED",
    original: webp("home-office-original.webp", "A9FD8612D471D67A36A436E5282C2CDD0117B8315E8E95B0D1FD1D3D9CD8BAEB"),
    modified: webp("home-office-modified.webp", "09A6F6A76B54EB5E6550AD2488ECE72C57A1F368120CA3A7D40A0EC3FD827BE2"),
  },
  "farmers-market": {
    version: "2026-08-28.2",
    difficulty: "UNRATED",
    rightsStatus: "USER_SUPPLIED",
    original: webp("farmers-market-original.webp", "2E99D7901976A7F3CB5AD605D7B23CB595FF2AC89EE3FF29863A56B14AFE4285"),
    modified: webp("farmers-market-modified.webp", "E130DA0F037EC0E37BB5588E5552BE9762B56849475F040990997D6116C43F68"),
  },
  "bathroom-vanity": {
    version: "2026-08-28.2",
    difficulty: "UNRATED",
    rightsStatus: "USER_SUPPLIED",
    original: webp("bathroom-vanity-original.webp", "23ACBBBD5D00B19FD27ABFE776CC552DDA246D8C4474FA3348071F1D4C1BB5B3"),
    modified: webp("bathroom-vanity-modified.webp", "BF9F0804C41A0BD0D4570FFCA9BA4F27CD7AC8706B2C50DD264AFD08ABFBD390"),
  },
  "lakeside-picnic": {
    version: "2026-08-28.2",
    difficulty: "UNRATED",
    rightsStatus: "USER_SUPPLIED",
    original: webp("lakeside-picnic-original.webp", "8E46E269D9645C0B5B041DB59FFBF34E4606CADBF7092117E61BDFEF0F42DFCF"),
    modified: webp("lakeside-picnic-modified.webp", "0C1C433EDFB0F21E1A832D16F0A3695F7319C20AB7A0E4A1B9D7467A7AA7C320"),
  },
  "laundry-room": {
    version: "2026-08-28.2",
    difficulty: "UNRATED",
    rightsStatus: "USER_SUPPLIED",
    original: webp("laundry-room-original.webp", "5FE54A914A41A31C1576BA3699728CE1919470DED4DFFE2B2788990994DE7AFA"),
    modified: webp("laundry-room-modified.webp", "863B7E2C0BF13BEDE9A8FB260DDA7413E158E6D6E1ED494C68C68ADAAB0F97AA"),
  },
} as const satisfies Record<GamePuzzleId, PuzzleAssetMetadata>;

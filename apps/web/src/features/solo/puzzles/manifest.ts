export interface SoloAssetMetadata {
  version: string;
  generator: "OpenAI ImageGen";
  original: { fileName: string; sha256: string };
  modified: { fileName: string; sha256: string };
}

export const SOLO_ASSET_MANIFEST = {
  observatory: {
    version: "2026-09-04.1",
    generator: "OpenAI ImageGen",
    original: { fileName: "observatory-original.webp", sha256: "532DBD7B237F560A8970AF9D5234F8DA22D24F04A05B4E101D2E5EC923266146" },
    modified: { fileName: "observatory-modified.webp", sha256: "61186E37FEEB0D468E9750EA3E88AC354D48859C491D8FFA8D18099B394EE6A0" },
  },
  bakery: {
    version: "2026-10-01.1",
    generator: "OpenAI ImageGen",
    original: { fileName: "bakery-original.webp", sha256: "2AB625832819F51498D9777DD30401D722A8533F91C5F30338BBDEE60D41F12F" },
    modified: { fileName: "bakery-modified.webp", sha256: "C1D183D62A2ADD772D627E3B5748B1656EDC18E81C4030B1D7CBF8E274F2AB04" },
  },
  greenhouse: {
    version: "2026-10-01.1",
    generator: "OpenAI ImageGen",
    original: { fileName: "greenhouse-original.webp", sha256: "58EFA06230EB59AC059CC3EE8DF7BA91116CCAA4D50348D08BECA114D69E9C39" },
    modified: { fileName: "greenhouse-modified.webp", sha256: "7267F64150A8A55AC3CEBE2B0702DB041778A87B80C2564CD8B5A2AD758BAAE6" },
  },
  "alpine-station": {
    version: "2026-09-04.1",
    generator: "OpenAI ImageGen",
    original: { fileName: "alpine-station-original.webp", sha256: "F6209258995528EE7EB4CCE8D3C34140EF0E84BB8D8571726C63413D583742DD" },
    modified: { fileName: "alpine-station-modified.webp", sha256: "9239BCCFB72D64265DF204EA7A7465DAD91BAE72B0A7F2924688AEF5B9F3BEDC" },
  },
  clockmaker: {
    version: "2026-09-04.1",
    generator: "OpenAI ImageGen",
    original: { fileName: "clockmaker-original.webp", sha256: "AF39703BA7377E8B000905DF314D1AAF9D36A2ED45C1DE35EB87CA1A8095252C" },
    modified: { fileName: "clockmaker-modified.webp", sha256: "CB64228ED41ECBF6B01B24630B622AFCA8B8BDC733D9CD9917B43EA3A029F53B" },
  },
} as const satisfies Record<string, SoloAssetMetadata>;

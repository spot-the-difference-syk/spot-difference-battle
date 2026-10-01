import { COSMETIC_ITEMS } from "@spot-battle/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LevelAvatar, avatarImage } from "./Growth";

describe("profile images", () => {
  it("has an image file for every profile image item except the initial", () => {
    for (const item of COSMETIC_ITEMS.filter((entry) => entry.slot === "avatar")) {
      if (item.id === "avatar-initial") expect(avatarImage(item.id)).toBeUndefined();
      else expect(avatarImage(item.id), item.id).toBeTruthy();
    }
  });

  it("shows the image when equipped and the first letter otherwise", () => {
    expect(renderToStaticMarkup(<LevelAvatar nickname="새내기" growth={null} avatar="avatar-cat"/>)).toContain("<img");
    const plain = renderToStaticMarkup(<LevelAvatar nickname="새내기" growth={null}/>);
    expect(plain).not.toContain("<img");
    expect(plain).toContain("새");
  });
});

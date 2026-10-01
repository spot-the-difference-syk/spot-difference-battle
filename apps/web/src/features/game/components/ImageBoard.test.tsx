import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImageBoard } from "./ImageBoard";

const board = (props: { markStyle?: string; selectable?: boolean }) => renderToStaticMarkup(
  <ImageBoard
    src="a.webp"
    alt="그림 변경본"
    viewport={{ scale: 1, pan: { x: 0, y: 0 } }}
    onPanBy={() => {}}
    {...(props.selectable === false ? {} : { onSelect: () => {} })}
    {...(props.markStyle ? { markStyle: props.markStyle } : {})}
  />,
);

describe("board pointer", () => {
  it("uses the white finder unless the gold viewfinder item is equipped", () => {
    expect(board({})).toMatch(/board-find(?! board-find-gold)/);
    expect(board({ markStyle: "marker-ring" })).not.toContain("board-find-gold");
    expect(board({ markStyle: "marker-gold" })).toContain("board-find board-find-gold");
  });

  it("does not show the finder on a board you cannot click", () => {
    expect(board({ selectable: false, markStyle: "marker-gold" })).not.toContain("board-find");
  });
});

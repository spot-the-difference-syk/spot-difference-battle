import type { FoundMark, NormalizedPoint } from "@spot-battle/shared";
import { useRef } from "react";
import {
  normalizedPointFromClient,
  pointerMoveThresholdPx,
  type ImageViewport,
} from "../model/image-geometry";

export interface ImageSelectionContext {
  pointerType: string;
  boardSizePx: number;
}

interface ImageBoardProps {
  src: string;
  alt: string;
  marks?: FoundMark[];
  onSelect?: (point: NormalizedPoint, context: ImageSelectionContext) => void;
  viewport: ImageViewport;
  onPanBy: (delta: NormalizedPoint) => void;
  /** 착용한 정답 표시 아이템 ID */
  markStyle?: string;
}

export function ImageBoard({
  src,
  alt,
  marks = [],
  onSelect,
  viewport,
  onPanBy,
  markStyle = "marker-viewfinder",
}: ImageBoardProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const interactive = Boolean(onSelect) || viewport.scale > 1;

  return (
    <div
      data-testid={alt.endsWith("변경본") ? "modified-board" : "original-board"}
      className={`relative aspect-square w-full overflow-hidden rounded-2xl bg-black/30 shadow-[0_24px_48px_-20px_rgb(0_0_0/0.8)] ${onSelect ? "board-find" : viewport.scale > 1 ? "board-pan" : ""}`}
      style={{ touchAction: viewport.scale > 1 ? "none" : "manipulation" }}
      onPointerDown={(event) => {
        if (!interactive || (event.pointerType === "mouse" && event.button !== 0)) return;
        gestureRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const totalDistance = Math.hypot(
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
        );
        if (totalDistance > pointerMoveThresholdPx(event.pointerType)) gesture.moved = true;
        if (viewport.scale > 1 && gesture.moved) {
          const rect = event.currentTarget.getBoundingClientRect();
          onPanBy({
            x: (event.clientX - gesture.lastX) / rect.width,
            y: (event.clientY - gesture.lastY) / rect.height,
          });
        }
        gesture.lastX = event.clientX;
        gesture.lastY = event.clientY;
      }}
      onPointerUp={(event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (!gesture.moved && onSelect && imageRef.current) {
          const imageRect = imageRef.current.getBoundingClientRect();
          onSelect(
            normalizedPointFromClient(
              event.clientX,
              event.clientY,
              imageRect,
            ),
            {
              pointerType: event.pointerType,
              boardSizePx: Math.min(imageRect.width, imageRect.height),
            },
          );
        }
      }}
      onPointerCancel={() => {
        gestureRef.current = null;
      }}
    >
      <div
        className="absolute inset-0 origin-center will-change-transform"
        style={{
          transform: `translate(${viewport.pan.x * 100}%, ${viewport.pan.y * 100}%) scale(${viewport.scale})`,
        }}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          className="block h-full w-full select-none object-contain"
        />
        {marks.map((mark, index) => (
          <span
            key={`${mark.differenceId}-${index}`}
            className={`found-mark ${markStyle} -translate-x-1/2 -translate-y-1/2`}
            style={{
              left: `${mark.region.x * 100}%`,
              top: `${mark.region.y * 100}%`,
              width: `${Math.max(mark.region.radius * 200, 8)}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

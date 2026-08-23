// apps/web/src/components/AttributionWatermark.tsx
// Незаметный полноэкранный водяной знак. Не перехватывает клики и не дублируется в AT.

import { ATTRIBUTION_LINE, ATTRIBUTION_SCREEN_READER } from "@/src/lib/attribution";

export function AttributionWatermark() {
  return (
    <>
      <p className="sr-only">{ATTRIBUTION_SCREEN_READER}</p>
      <div
        className="attribution-watermark"
        aria-hidden="true"
        data-attribution={ATTRIBUTION_LINE}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2147483000,
          pointerEvents: "none",
          userSelect: "none",
          overflow: "hidden",
          backgroundImage: 'url("/watermark.svg")',
          backgroundRepeat: "repeat",
          backgroundSize: "44rem 25rem",
          opacity: 0.035,
          mixBlendMode: "normal",
        }}
      />
    </>
  );
}

import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Space hopes";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 96, background: "#fff", color: "#1a1a1a" }}>
        <div style={{ fontSize: 132, lineHeight: 1, letterSpacing: -4, fontFamily: "serif" }}>Space</div>
        <div style={{ fontSize: 132, lineHeight: 1.05, letterSpacing: -4, fontStyle: "italic", color: "#0f766e", fontFamily: "serif" }}>hopes.</div>
        <div style={{ marginTop: 36, fontSize: 30, color: "#4d4d4d" }}>Short thoughts and longer essays, written slowly.</div>
      </div>
    ),
    size,
  );
}

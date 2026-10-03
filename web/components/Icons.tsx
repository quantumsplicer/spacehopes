import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({ width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p });

export const Heart = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.8 3.6 4.5 7 4.5c2 0 3.5 1 5 3 1.5-2 3-3 5-3 3.400 0 5.300 3.300 4.200 6.600-1.700 4.800-9.200 9.400-9.200 9.400z" /></svg>;
export const Search = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.200-4.200" /></svg>;
export const Arrow = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const ArrowDown = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 5v14M6 13l6 6 6-6" /></svg>;
export const Share = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 15V4M8 8l4-4 4 4" /><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>;
export const LinkIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1" /><path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" /></svg>;
export const Check = (p: SVGProps<SVGSVGElement>) => <svg {...base({ strokeWidth: 2.4, ...p })}><path d="m5 12.500 4.500 4.500L19 7.500" /></svg>;
export const Menu = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 8h16M4 16h16" /></svg>;
export const Close = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const Chevron = ({ dir = "right", ...p }: SVGProps<SVGSVGElement> & { dir?: "left" | "right" }) => <svg {...base(p)}><path d={dir === "right" ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} /></svg>;
export const Lock = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
export const Key = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="8" cy="12" r="3.500" /><path d="M11.500 12H21M18 12v3M15 12v2" /></svg>;

import type { ReactElement } from "react";
import type { ArtKind } from "../../types";
const shapes: Record<ArtKind, ReactElement> = {
  lamp: <><path d="M70 50 Q100 20 130 50 L122 90 H78Z" fill="#D9A5A8" opacity=".95"/><rect x="97" y="90" width="6" height="60" fill="#C5A06A"/><ellipse cx="100" cy="155" rx="26" ry="7" fill="#C5A06A"/></>,
  vase: <><path d="M82 60 Q70 110 80 150 H120 Q130 110 118 60Z" fill="#B77E8B"/><path d="M100 60 Q96 30 110 18 M100 60 Q108 34 92 20" fill="none" stroke="#D9A5A8" strokeWidth="3"/></>,
  shelf: <><rect x="50" y="110" width="100" height="8" fill="#C5A06A"/><path d="M60 118 L60 140 M140 118 L140 140" stroke="#B77E8B" strokeWidth="4"/><rect x="72" y="70" width="22" height="40" fill="#D9A5A8"/><circle cx="122" cy="94" r="16" fill="#FFF9F5"/></>,
  frame: <><rect x="55" y="35" width="90" height="120" fill="none" stroke="#C5A06A" strokeWidth="6"/><path d="M100 140 Q100 90 100 60 M100 100 Q80 90 76 72 M100 90 Q122 84 126 66" stroke="#B77E8B" strokeWidth="3" fill="none"/></>,
  tray: <><circle cx="100" cy="95" r="52" fill="none" stroke="#C5A06A" strokeWidth="6"/><circle cx="100" cy="95" r="36" fill="none" stroke="#D9A5A8" strokeWidth="2"/><circle cx="100" cy="95" r="12" fill="#B77E8B"/></>,
  mirror: <><path d="M62 150 V80 Q62 36 100 36 Q138 36 138 80 V150Z" fill="#F2DCDD" opacity=".9" stroke="#C5A06A" strokeWidth="6"/></>,
  clock: <><circle cx="100" cy="95" r="50" fill="#FFF9F5" stroke="#B77E8B" strokeWidth="6"/><path d="M100 95 V65 M100 95 L120 105" stroke="#713B58" strokeWidth="3"/></>,
  candle: <><ellipse cx="100" cy="140" rx="45" ry="10" fill="#D9A5A8"/><rect x="94" y="80" width="12" height="60" fill="#FFF9F5"/><path d="M100 54 Q92 68 100 78 Q108 68 100 54Z" fill="#C5A06A"/></>,
  curtain: <><path d="M60 40 H140 V150 H60Z M80 40 V150 M100 40 V150 M120 40 V150" fill="none" stroke="#D9A5A8" strokeWidth="4"/></>,
  chair: <><rect x="70" y="40" width="60" height="55" fill="none" stroke="#713B58" strokeWidth="6"/><rect x="62" y="95" width="76" height="12" fill="#B77E8B"/><path d="M70 107 V150 M130 107 V150" stroke="#C5A06A" strokeWidth="6"/></>
};
export default function ProductArt({ kind, className = "" }: { kind: ArtKind; className?: string }) {
  return <div className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-[#F2DCDD] via-[#F7E8E7] to-[#FFF9F5] ${className}`}>
    <div className="absolute -right-8 -top-8 h-36 w-36 rounded-full bg-white/35 blur-2xl" />
    <div className="absolute -bottom-10 -left-8 h-32 w-32 rounded-full bg-plum/10 blur-2xl" />
    <svg viewBox="0 0 200 190" className="relative h-4/5 w-4/5 drop-shadow-[0_12px_10px_rgba(53,16,43,.12)]" aria-hidden="true">{shapes[kind]}</svg>
  </div>;
}

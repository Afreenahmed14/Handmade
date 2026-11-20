import { useState } from "react";
import { Package } from "lucide-react";

/** Product photo captured on the order line, with a quiet placeholder when there is none or it fails to load. */
export default function OrderThumb({ src, className = "h-16 w-16" }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span aria-hidden="true" className={`${className} grid shrink-0 place-items-center border border-brass/30 bg-brass/10 text-brass`}><Package size={20} /></span>;
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={`${className} shrink-0 border border-brass/30 object-cover`} />;
}

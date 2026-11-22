export type ArtKind = "lamp" | "vase" | "shelf" | "frame" | "tray" | "mirror" | "clock" | "candle" | "curtain" | "chair";
export interface Category { id: string; name: string; slug: string; art: ArtKind; description?: string; imageUrl?: string; isActive?: boolean }
export interface Product {
  id: string; slug: string; name: string; sku: string; category: string;
  price: number; discountPrice?: number; material: string; colour: string;
  art: ArtKind; customizable: boolean; stock: number; tag?: "new" | "best" | "featured";
  description: string; imageUrl?: string; categorySlug?: string; categoryId?: string; published?: boolean;
}

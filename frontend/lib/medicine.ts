// Live pharmacy prices (backend/pharmacy.py — 1mg, PharmEasy, Netmeds). The AI never sets prices.

export type PriceOffer = {
  platform: "1mg" | "pharmeasy" | "netmeds";
  platform_name: string;
  name: string; // the exact product the price is for
  price: number;
  mrp: number | null;
  discount_pct: number;
  pack: string;
  url: string;
  rx_required: boolean;
  manufacturer: string;
  available: boolean;
};

export function rupee(n: number) {
  return `₹${n % 1 === 0 ? n : n.toFixed(2)}`;
}

export function fetchedAt(ts?: number | null) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

import type { Category, Product } from "../types";
export const categories: Category[] = [
  { id:"1", name:"Lighting", slug:"lighting", art:"lamp" },
  { id:"2", name:"Wall Decor", slug:"wall-decor", art:"shelf" },
  { id:"3", name:"Paintings", slug:"paintings", art:"frame" },
  { id:"4", name:"Home Accessories", slug:"home-accessories", art:"vase" },
  { id:"5", name:"Mirrors", slug:"mirrors", art:"mirror" },
  { id:"6", name:"Clocks", slug:"clocks", art:"clock" },
  { id:"7", name:"Kitchen Decor", slug:"kitchen-decor", art:"tray" },
  { id:"8", name:"Furniture", slug:"furniture", art:"chair" },
];
export const products: Product[] = [
  { id:"p1", slug:"amber-glass-table-lamp", name:"Amber Glass Table Lamp", sku:"LGT-001", category:"Lighting", price:4800, discountPrice:4200, material:"Brass, glass", colour:"Amber", art:"lamp", customizable:true, stock:8, tag:"best", description:"A warm glass shade on an antique brass stem." },
  { id:"p2", slug:"brass-pitcher-vase", name:"Brass Pitcher Vase", sku:"ACC-002", category:"Home Accessories", price:2400, material:"Brass", colour:"Antique gold", art:"vase", customizable:false, stock:15, tag:"featured", description:"Hand-finished pitcher for dried stems and branches." },
  { id:"p3", slug:"corner-wall-shelf", name:"Carved Corner Wall Shelf", sku:"WAL-003", category:"Wall Decor", price:6200, material:"Teak", colour:"Walnut", art:"shelf", customizable:true, stock:5, tag:"new", description:"A carved teak shelf for plates, plants and candles." },
  { id:"p4", slug:"botanical-framed-print", name:"Botanical Framed Print", sku:"PNT-004", category:"Paintings", price:3100, discountPrice:2700, material:"Wood frame", colour:"Olive", art:"frame", customizable:true, stock:20, tag:"featured", description:"A pressed-leaf study in an aged wooden frame." },
  { id:"p5", slug:"oil-lantern-lamp", name:"Antique Oil Lantern Lamp", sku:"LGT-005", category:"Lighting", price:5400, material:"Brass, glass", colour:"Brass", art:"lamp", customizable:false, stock:6, tag:"best", description:"A kerosene-style lantern, wired for a modern bulb." },
  { id:"p6", slug:"engraved-brass-trays", name:"Engraved Brass Tray Set", sku:"KIT-006", category:"Kitchen Decor", price:3600, material:"Brass", colour:"Antique gold", art:"tray", customizable:true, stock:12, tag:"new", description:"Three wall-hanging trays with engraved borders." },
  { id:"p7", slug:"arched-wall-mirror", name:"Arched Gilt Wall Mirror", sku:"MIR-007", category:"Mirrors", price:7800, discountPrice:6900, material:"Wood, glass", colour:"Gold", art:"mirror", customizable:false, stock:4, tag:"new", description:"A slim arched mirror with a gilded edge." },
  { id:"p8", slug:"candle-holder-dish", name:"Brass Candle Dish", sku:"ACC-008", category:"Home Accessories", price:1200, material:"Brass", colour:"Brass", art:"candle", customizable:false, stock:30, tag:"best", description:"A low dish with a ring handle for taper candles." },
];
export const formatINR = (n: number) => "₹" + n.toLocaleString("en-IN");

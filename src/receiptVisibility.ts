export type Bounds = { top:number;bottom:number;left:number;right:number;width:number;height:number };
// Half the bubble (or half the viewport for a long bubble) must be in view.
export function isViewed(box: Bounds,viewport: Bounds,visibility: string) {
  if (visibility!=='visible' || box.width<=0 || box.height<=0 || viewport.height<=0 || viewport.width<=0) return false;
  const height=Math.max(0,Math.min(box.bottom,viewport.bottom)-Math.max(box.top,viewport.top));
  const width=Math.max(0,Math.min(box.right,viewport.right)-Math.max(box.left,viewport.left));
  return height>=Math.min(box.height,viewport.height)*0.5 && width>=Math.min(box.width,viewport.width)*0.5;
}

import productLogo from '../assets/product-logo.svg';

export function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`brand-mark ${className}`} role="img" aria-label="文析 Logo"><img src={productLogo} alt="" aria-hidden /></span>;
}

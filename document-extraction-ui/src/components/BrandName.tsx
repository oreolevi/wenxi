import wordmark from '../assets/product-wordmark.svg';

export function BrandName({ className = '' }: { className?: string }) {
  const mask = `url("${wordmark}")`;
  return <span className={`brand-name ${className}`} role="img" aria-label="文析"
    style={{ maskImage: mask, WebkitMaskImage: mask }} />;
}

/** Brand mark: a rounded tile with a stylised photo (mountain + sun) and a spark. */
export const Logo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="ie-logo-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#8b5cf6" />
        <stop offset="1" stopColor="#d946ef" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="8" fill="url(#ie-logo-bg)" />
    <path d="M6 23.5 12.5 15l4.2 5.3 2.8-3.3L26 23.5Z" fill="#fff" fillOpacity=".95" />
    <circle cx="21.5" cy="10.5" r="2.6" fill="#fde68a" />
    <path d="M10 7.2l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8Z" fill="#fff" />
  </svg>
);

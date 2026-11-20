import React from 'react';
import { useTheme } from '../context/ThemeContext';

export default function GlobalBackground() {
  const { theme } = useTheme();

  return (
    <div
      id="global-artwork-container"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Base Artwork Image Layer */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          backgroundImage: 'url("/auth-artwork.jpg")',
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
          backgroundRepeat: 'no-repeat',
          opacity: 'var(--artwork-opacity, 0.75)',
          filter: theme === 'dark' ? 'none' : 'saturate(1.18) brightness(1.02)',
          transition: 'opacity 0.3s ease, filter 0.3s ease',
          transform: 'scale(1.02)', // Prevents edge artifacts on high-DPI displays
        }}
      />

      {/* Theme-aware Atmospheric Overlay Layer */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background:
            theme === 'dark'
              ? 'radial-gradient(circle at 15% 15%, rgba(6, 182, 212, 0.20) 0%, transparent 45%), radial-gradient(circle at 85% 85%, rgba(139, 92, 246, 0.16) 0%, transparent 45%), linear-gradient(180deg, rgba(7, 10, 19, 0.72) 0%, rgba(11, 15, 25, 0.82) 100%)'
              : 'radial-gradient(circle at 12% 15%, rgba(2, 132, 199, 0.08) 0%, transparent 45%), radial-gradient(circle at 88% 85%, rgba(99, 102, 241, 0.05) 0%, transparent 45%), linear-gradient(180deg, rgba(238, 242, 248, 0.88) 0%, rgba(228, 234, 242, 0.94) 100%)',
          transition: 'background 0.3s ease',
        }}
      />
    </div>
  );
}

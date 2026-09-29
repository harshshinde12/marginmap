/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        body: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: '#0f172a',
        paper: '#f1f5f9',
        accent: '#059669',
        danger: '#dc2626',
        navy: '#0F172A',
        navyCard: '#1E293B',
        neon: '#3B82F6',
        neonPurple: '#8B5CF6',
        pos: '#10B981',
        neg: '#EF4444',
        navyCardHover: '#243247',
        slate50: '#F8FAFC',
        borderLight: 'rgba(0,0,0,0.05)',
        borderDark: 'rgba(255,255,255,0.05)',
        neonDim: 'rgba(59,130,246,0.3)',
      },
      fontSize: {
        xs: '12px',
        sm: '13px',
        base: '14px',
        lg: '16px',
        xl: '20px',
        '2xl': '28px',
        '3xl': '36px',
        '4xl': '40px',
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.06)',
        'card-hover': '0 0 0 1px rgba(59,130,246,0.1), 0 8px 24px -8px rgba(0,0,0,0.3)',
        'card-dark': '0 1px 3px 0 rgba(0,0,0,0.4), 0 1px 2px -1px rgba(0,0,0,0.3)',
        'card-hover-dark': '0 0 0 1px rgba(59,130,246,0.15), 0 8px 24px -8px rgba(0,0,0,0.6)',
        'glow-neon': '0 0 0 3px rgba(59,130,246,0.15)',
      },
      transitionDuration: {
        175: '175ms',
      },
    },
  },
  plugins: [],
}

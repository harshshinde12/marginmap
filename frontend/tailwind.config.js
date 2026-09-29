/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Segoe UI"', 'system-ui', 'sans-serif'],
        body: ['system-ui', '"Helvetica Neue"', 'Arial', 'sans-serif'],
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
      },
      transitionDuration: {
        175: '175ms',
      },
    },
  },
  plugins: [],
}

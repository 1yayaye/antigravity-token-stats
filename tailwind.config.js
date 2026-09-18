/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          border: 'var(--card-border)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        // Antigravity Heatmap Blue Scale
        heat: {
          0: '#eef3f8',
          1: '#cde0f5',
          2: '#93bbe6',
          3: '#4d87cf',
          4: '#1f53a3',
          'dark-0': '#1b222d',
          'dark-1': '#223650',
          'dark-2': '#2f5582',
          'dark-3': '#407abf',
          'dark-4': '#629be6',
        }
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        'modal': '0 20px 45px -10px rgba(0, 0, 0, 0.12), 0 10px 20px -5px rgba(0, 0, 0, 0.06)',
        'modal-dark': '0 20px 45px -10px rgba(0, 0, 0, 0.5), 0 10px 20px -5px rgba(0, 0, 0, 0.3)',
      }
    },
  },
  plugins: [],
}

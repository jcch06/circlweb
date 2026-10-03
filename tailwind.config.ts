import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      fontSize: {
        'h1': ['22px', { lineHeight: '28px', letterSpacing: '-0.03em', fontWeight: '500' }],
        'body': ['16px', { lineHeight: '24px' }],
        'sm-body': ['13px', { lineHeight: '20px' }],
        'caption': ['11px', { lineHeight: '16px' }],
        'micro': ['10px', { lineHeight: '14px' }],
      },
      colors: {
        border: "hsl(var(--ui-border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--ui-accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--ui-card))",
          foreground: "hsl(var(--card-foreground))",
          hover: "hsl(var(--card-hover))",
        },
        // Hémicycle custom colors
        navy: {
          950: "hsl(var(--h-navy-950))",
          900: "hsl(var(--h-navy-900))",
          800: "hsl(var(--h-navy-800))",
          700: "hsl(var(--h-navy-700))",
          600: "hsl(var(--h-navy-600))",
          500: "hsl(var(--h-navy-500))",
          400: "hsl(var(--h-navy-400))",
          300: "hsl(var(--h-navy-300))",
          200: "hsl(var(--h-navy-200))",
          100: "hsl(var(--h-navy-100))",
          50: "hsl(var(--h-navy-50))",
        },
        gold: {
          500: "hsl(var(--h-gold-500))",
          200: "hsl(var(--h-gold-200))",
        },
        hgreen: {
          500: "hsl(var(--h-green-500))",
          100: "hsl(var(--h-green-100))",
        },
        hred: {
          500: "hsl(var(--h-red-500))",
          100: "hsl(var(--h-red-100))",
        },
        hamber: {
          500: "hsl(var(--h-amber-500))",
          100: "hsl(var(--h-amber-100))",
        },
        hgray: {
          800: "hsl(var(--h-gray-800))",
          600: "hsl(var(--h-gray-600))",
          400: "hsl(var(--h-gray-400))",
          200: "hsl(var(--h-gray-200))",
          100: "hsl(var(--h-gray-100))",
          50: "hsl(var(--h-gray-50))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      spacing: {
        '0.5': '2px',
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '7': '28px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
        '14': '56px',
        '16': '64px',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;

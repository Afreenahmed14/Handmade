/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {
    colors: {
      plum: "#713B58", "plum-deep": "#51283F", "plum-soft": "#A45E78",
      dusty: "#B77E8B", "dusty-light": "#F2DCDD", lavender: "#F7E8E7",
      ivory: "#FFF9F5", charcoal: "#49343D", white: "#FFFFFF",
      // Warm CasaLoom aliases keep all existing customer and admin screens on-brand.
      brass: "#C5A06A", walnut: "#713B58", cream: "#FFF9F5",
      espresso: "#49343D", rose: "#D9A5A8", olive: "#8C9A7A"
    },
    fontFamily: {
      display: ['"Cormorant Garamond"', "serif"],
      heading: ['"Playfair Display"', "serif"],
      body: ["Lato", "sans-serif"]
    },
    boxShadow: {
      soft: "0 14px 38px rgba(113,59,88,.10)",
      card: "0 6px 24px rgba(91,54,67,.07)"
    },
    keyframes: {
      glow: { "0%,100%": { opacity: ".85" }, "50%": { opacity: "1" } },
      rise: { "0%": { opacity: "0", transform: "translateY(14px)" }, "100%": { opacity: "1", transform: "translateY(0)" } }
    },
    animation: { glow: "glow 5s ease-in-out infinite", rise: "rise .7s ease-out both" }
  } },
  plugins: []
};

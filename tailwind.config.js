/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./*.html",
    "./services/*.html",
    "./industries/*.html",
    "./templates/*.html",
    "./scripts/*.cjs"
  ],
  safelist: [
    // Classes dynamically added via JavaScript classList operations
    'hidden',
    'visible',
    'rotate-90',
    'rotate-180',
    'shadow-md',
    // Arbitrary value classes toggled by JS in index.html pipeline
    'text-[#4EA6FE]',
    'border-[#4EA6FE]',
    'text-gray-400',
    'text-gray-700',
    'border-gray-200',
  ],
  theme: {
    extend: {
      colors: {
        // Config A names (index.html, industries.html)
        'belkins-orange': '#4EA6FE',
        'belkins-dark': '#1A1A1A',
        'belkins-gray': '#6B7280',
        'belkins-light': '#FFFFFF',
        'bpo-blue-light': '#78BBFA',
        'bpo-blue-dark': '#4EA6FE',

        // Config B names (about, pricing, case-studies, 404, legal pages, careers)
        'bpo-blue': '#4EA6FE',
        'bpo-light': '#78BBFA',

        // Config C names (service pages)
        'bpo-dark': '#1A1A1A',
        'bpo-gray': '#6B7280',
      },
      fontFamily: {
        'inter': ['Inter', 'sans-serif'],
      },
    }
  },
  plugins: [],
}

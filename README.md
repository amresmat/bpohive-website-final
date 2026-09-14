# BPOHIVE - B2B Lead Generation Agency Landing Page

## Outbound assessment setup

`outbound-assessment.html` qualifies prospects before showing the Discovery Call calendar. Qualified submissions prefill name, email, and ten custom Calendly answers. Keep the Discovery Call invitee questions in this exact order:

1. Company name
2. Company website
3. Job title
4. Phone number
5. What product/service are you selling?
6. Who are you trying to reach?
7. Average revenue per closed sale
8. Services needed
9. Initial campaign budget
10. Desired launch timeline

Add the variables in `.env.example` to the Vercel project. The main Zapier webhook receives every assessment field plus ready-to-send prospect and owner email content. Set `ZAPIER_SENDS_EMAIL=true` only after the Zap's two email actions are enabled. The optional booking webhook records completed Calendly bookings.

A pixel-perfect recreation of the Belkins.io landing page built with HTML, Tailwind CSS, and React.

## 📁 Project Structure

```
belkins-clone/
├── index.html              # Complete single-file HTML version (production-ready)
├── react-version/
│   ├── App.jsx             # React component-based version
│   └── styles.css          # Custom CSS animations and utilities
└── README.md               # This file
```

## 🎨 Design System

### Color Palette
| Color | Hex | Usage |
|-------|-----|-------|
| Belkins Orange | `#FF5C35` | Primary CTAs, highlights, accents |
| Dark | `#1A1A1A` | Headings, primary text |
| Gray | `#6B7280` | Body text, descriptions |
| Light | `#F9FAFB` | Section backgrounds |

### Typography
- **Font Family:** Inter (Google Fonts)
- **Headings:** 700-800 weight, tight line-height
- **Body:** 400-500 weight, relaxed line-height

### Spacing
- Section padding: `py-20` (5rem)
- Max content width: `max-w-7xl` (80rem)
- Card padding: `p-6` to `p-8`

## 🎭 Animations

### Entrance Animations
1. **fadeInUp** - Primary entrance for headings and content
2. **fadeIn** - Subtle opacity transitions
3. **slideInLeft/Right** - Horizontal slide animations
4. **scaleIn** - Scale with fade for cards

### Interactive Animations
1. **float** - Subtle floating motion for decorative elements
2. **marquee** - Infinite horizontal scroll for logo carousel
3. **hover effects** - Card lifts, button shadows, arrow translations

### Scroll Animations
All major sections use Intersection Observer for scroll-triggered animations:
- Elements start at `opacity: 0` and `translateY(30px)`
- Animate to visible state when entering viewport
- Staggered delays for list items

## 📐 Component Breakdown

### 1. Navigation (`Navbar`)
- Fixed position with blur backdrop
- Dropdown menus on hover
- Mobile hamburger menu
- Shadow on scroll

### 2. Hero Section (`HeroSection`)
- Animated text entrance
- Decorative orange blobs
- Client logo carousel

### 3. Services Section (`ServicesSection`)
- Two-column layout
- Omnichannel appointment card
- Service grid with hover effects

### 4. Challenges Section (`ChallengesSection`)
- 3-column grid of challenge cards
- Icon + title + description format
- Hover state with orange border

### 5. Stats Section (`StatsSection`)
- Large typography with orange highlight
- Centered CTA button

### 6. Pipeline Section (`PipelineSection`)
- Dark background theme
- Interactive journey steps
- Visual funnel diagram

### 7. What Sets Us Apart (`WhatSetsUsApartSection`)
- Sticky left column on desktop
- Scrolling feature cards
- Dark card theme

### 8. Placeholder Sections
- Reviews/Testimonials (placeholder div)
- Case Studies (placeholder div)

### 9. Footer
- Multi-column link grid
- Social icons
- Partner badges
- Legal links

## 🚀 Usage

### HTML Version
Simply open `index.html` in a browser. Uses Tailwind CDN.

```html
<!-- Tailwind CDN included -->
<script src="https://cdn.tailwindcss.com"></script>
```

### React Version
1. Copy `App.jsx` into your React project
2. Import `styles.css`
3. Configure Tailwind with custom colors:

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        'belkins-orange': '#FF5C35',
        'belkins-dark': '#1A1A1A',
        'belkins-gray': '#6B7280',
        'belkins-light': '#F9FAFB',
      },
      fontFamily: {
        'inter': ['Inter', 'sans-serif'],
      },
    }
  }
}
```

## 📱 Responsive Breakpoints

| Breakpoint | Width | Changes |
|------------|-------|---------|
| Mobile | < 640px | Single column, hamburger menu |
| Tablet | 640-1024px | Two columns, adapted spacing |
| Desktop | > 1024px | Full layout, hover effects |

## ✨ Key Features

- **Fully Responsive** - Mobile-first design
- **Smooth Animations** - CSS transitions and keyframes
- **Accessible** - Semantic HTML, focus states, reduced motion support
- **Performance** - No heavy dependencies, optimized animations
- **Clean Code** - Well-organized, documented components

## 🔧 Customization

### Changing Colors
Update the CSS custom properties in `:root`:
```css
:root {
  --belkins-orange: #YOUR_COLOR;
}
```

### Modifying Animations
Animation keyframes are defined in `styles.css`. Adjust timing, transforms, and easing as needed.

### Adding Content
Replace placeholder sections with actual content by modifying the `PlaceholderSection` components.

## 📝 Notes

- **Excluded Sections:** Reviews, Testimonials, and Case Studies are placeholders as requested
- **Images:** Using placeholder images - replace with actual assets
- **Forms:** No functional forms - add backend integration as needed

## 🌐 Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

Includes `prefers-reduced-motion` support for accessibility.

---

Built with ❤️ using Tailwind CSS and React

# gd fairy Design System

## Brand

**Name:** gd fairy (all lowercase)
**Legal entity:** DataFairy LLC
**Domains:** gdfairy.com (primary), gdferry.com (redirects), datafairy.com (corporate)

**Concept:** "gd" stands for Google Data — the lowercase g mirrors Google's own lowercase styling. It's also the other thing you mutter when your GA4 is broken. Fairy is the AI agent: whimsical, smart, and a little bit magic. The fairy inspects your data with a wave of its wand, turning chaos into clarity. No boat required — just pure enchantment.

**Wordmark:** All lowercase "gd fairy"
- **"g"** in Google blue (#4285F4) — set in Inter Medium Italic
- **"d fairy"** in brand indigo (#6366F1) — "d" in Inter Medium, "fairy" in Inter ExtraBold
- The only color differentiation is the "g" in Google blue; everything else is indigo
- The fairy icon sits to the left on a rounded indigo-to-indigo-600 gradient background (used in contexts where the Chrome extension icon isn't already present)

**Tone:** Superhuman meets Figma — bright, whimsical, animated. Personality lives in the design itself. Playful but efficient. Think: "a wickedly smart analyst who makes you laugh while saving your data."

---

## Color Palette

### Primary — Indigo
| Token              | Hex       | Usage                                       |
|--------------------|-----------|----------------------------------------------|
| `--indigo-50`      | `#EEF2FF` | Backgrounds, subtle highlights               |
| `--indigo-100`     | `#E0E7FF` | Hover states, selected row backgrounds       |
| `--indigo-200`     | `#C7D2FE` | Borders on active elements                   |
| `--indigo-400`     | `#818CF8` | Secondary buttons, links                     |
| `--indigo-500`     | `#6366F1` | **Primary brand color** — buttons, tabs, CTA |
| `--indigo-600`     | `#4F46E5` | Primary button hover, "Fairy" wordmark       |
| `--indigo-700`     | `#4338CA` | Primary button active/pressed                |
| `--indigo-900`     | `#312E81` | Dark text on light backgrounds               |

### Secondary — Violet / Lavender
| Token              | Hex       | Usage                                        |
|--------------------|-----------|-----------------------------------------------|
| `--violet-50`      | `#F5F3FF` | Info cards, subtle accents, hover states      |
| `--violet-100`     | `#EDE9FE` | Info badge backgrounds, card borders          |
| `--violet-400`     | `#A78BFA` | Info severity dots, secondary icons           |
| `--violet-500`     | `#8B5CF6` | Violet accent — tags, secondary highlights    |
| `--violet-600`     | `#7C3AED` | Info text, secondary links                    |
| `--lavender-50`    | `#F8F7FF` | Lightest lavender tints                       |
| `--lavender-100`   | `#EDEBFE` | Mode selector background                     |
| `--lavender-200`   | `#DDD6FE` | Inactive count badges                         |
| `--lavender-400`   | `#B4A5F7` | Decorative accents                            |
| `--lavender-500`   | `#9B8AFB` | Lavender brand accent                         |

### Accent — Gold
| Token              | Hex       | Usage                                        |
|--------------------|-----------|-----------------------------------------------|
| `--gold-50`        | `#FFFBEB` | Gold tint backgrounds                         |
| `--gold-100`       | `#FEF3C7` | Gold badge backgrounds                        |
| `--gold-400`       | `#FBBF24` | **Primary gold accent** — PRO badge, sparkles |
| `--gold-500`       | `#F59E0B` | Gold hover, emphasis                          |

### Google Brand Colors (wordmark only)
| Letter | Hex       | Usage                  |
|--------|-----------|------------------------|
| G      | `#4285F4` | "g" in gd wordmark     |

### Semantic Colors
| Token              | Hex       | Usage                                      |
|--------------------|-----------|---------------------------------------------|
| `--error`          | `#DC2626` | Error severity, critical findings           |
| `--error-bg`       | `#FEF2F2` | Error card backgrounds                      |
| `--error-border`   | `#FECACA` | Error card borders                          |
| `--warning`        | `#D97706` | Warning severity                            |
| `--warning-bg`     | `#FFFBEB` | Warning card backgrounds                    |
| `--warning-border` | `#FDE68A` | Warning card borders                        |
| `--info`           | `#8B5CF6` | Info severity (violet, not blue)            |
| `--info-bg`        | `#F5F3FF` | Info card backgrounds (violet-50)           |
| `--info-border`    | `#EDE9FE` | Info card borders (violet-100)              |
| `--success`        | `#059669` | Passing checks, healthy status              |
| `--success-bg`     | `#ECFDF5` | Success card backgrounds                    |
| `--rose`           | `#F43F5E` | Events-with-errors variant                  |
| `--rose-bg`        | `#FFF1F2` | Rose tint backgrounds                       |

### Neutrals
| Token              | Hex       | Usage                                      |
|--------------------|-----------|---------------------------------------------|
| `--gray-50`        | `#F9FAFB` | Page background                             |
| `--gray-100`       | `#F3F4F6` | Card backgrounds, code blocks               |
| `--gray-200`       | `#E5E7EB` | Borders, dividers                           |
| `--gray-400`       | `#9CA3AF` | Placeholder text, muted labels              |
| `--gray-500`       | `#6B7280` | Secondary text                              |
| `--gray-700`       | `#374151` | Primary body text                           |
| `--gray-900`       | `#111827` | Headings, emphasis text                     |

---

## Typography

**Font stack:** `Inter, system-ui, -apple-system, sans-serif`
(Inter loaded from Google Fonts — weights 400–800)

| Element            | Size  | Weight    | Color            |
|--------------------|-------|-----------|------------------|
| "g" in wordmark    | 15px  | 500 (Medium) Italic | Google blue |
| "d fairy" wordmark | 15px  | 500/800 (Medium/ExtraBold) | indigo-600 |
| Panel heading      | 16px  | 600       | gray-900         |
| Section heading    | 13px  | 600       | gray-900         |
| Body text          | 13px  | 400       | gray-700         |
| Detail/help        | 12px  | 400       | gray-500         |
| Badge text         | 11px  | 600       | (contextual)     |
| Tiny labels        | 10px  | 600       | gray-400         |
| Code/mono          | 11px  | 400       | gray-700         |

**Monospace:** `"JetBrains Mono", "Fira Code", "SF Mono", monospace`

---

## Component Patterns

### Header
- "gd fairy" wordmark: g in #4285F4 (italic), "d fairy" in indigo-600
- No inline logo icon (Chrome side panel already shows the extension icon)
- Toolbar controls aligned right (Record / Export / Clear)

### Mode Selector (GA4 / GTM)
- Segmented control below header
- Background: `bg-indigo-50/60` with `border-indigo-100/50`
- Active segment: white bg, indigo-600 text, subtle shadow
- Inactive: indigo-300 text, hover to indigo-500

### Score Cards (top of panel)
- Row of 4 cards, equal width: Events → w/ Errors → Errors → Warnings
- Large number (2xl, bold), small label below (11px, uppercase, muted)
- Subtle left border in variant color (4px):
  - Events: `border-l-indigo-500`, text `indigo-900`
  - w/ Errors: `border-l-rose-400`, text `rose-600`, percentage subtitle
  - Errors: `border-l-red-500`, text `red-600`
  - Warnings: `border-l-amber-500`, text `amber-600`
- White background, light shadow

### Agent Report Panel
- Appears after recording/crawl stops with analysis results
- Health card: indigo gradient background, white border
- Session overview: violet-50 bg, violet accents
- Risk buckets: Critical (red), High (amber), Medium (blue), Low (violet)
- PRO features: gold gradient bolt icon, indigo-to-violet gradient CTA
- Dismiss/View Findings actions

### Analyze Button
- Full-width, gradient: `from-indigo-50 to-violet-50`
- Indigo-200/60 border, indigo-600 text
- Lightbulb icon, hover deepens gradient

### Finding Cards (grouped by rule)
- Grouped by ruleId — expandable accordion
- Left border: 3px in severity color (red/amber/violet)
- Background: severity-bg tint
- Badge: severity pill + category pill
- Info severity uses violet (not blue): `bg-violet-50`, `border-l-violet-400`

### Event Rows (grouped by name)
- Grouped by event name — expandable accordion with count badge
- White card, gray-200 border, shadow-sm
- Error/warning count badges on right
- Hover: `bg-violet-50/30`
- Expand: individual occurrences with JSON payload viewer

### Tabs
- Bottom border style (not enclosed)
- Active: indigo-500 text + 2px bottom border
- Inactive: gray-400 text, count badge in `bg-violet-50 text-violet-400`
- Hover: gray-600 text

### Buttons
- **Primary (Record):** `bg-gradient-to-r from-indigo-500 to-indigo-600`, white text, rounded-lg
- **Secondary (Export/Clear):** white bg, gray-200 border, hover `bg-indigo-50/50`
- **Danger:** error bg, white text
- **CTA (Pro):** `bg-gradient-to-r from-indigo-500 to-violet-500`, white text
- Record active state: red-500 with pulsing dot, "Stop" label
- All buttons: rounded, medium weight

### Crawler Panel
- Start Crawl: indigo gradient button
- Input focus ring: violet-200
- Source badges: dataLayer = `indigo-50/indigo-600`, gtag = `violet-50/violet-600`

---

## Layout

- **Panel background:** white (p-4)
- **Content max-width:** none (fills side panel)
- **Padding:** 16px
- **Card spacing:** 6px gap (mb-1.5)
- **Card border-radius:** 8px (rounded-lg)
- **Card shadow:** `shadow-sm` (~0 1px 2px rgba(0,0,0,0.05))
- **Section spacing:** 12px between major sections (mb-3)

---

## Logo

The gd fairy logo is a fairy figure with butterfly-like wings, holding a golden wand with a sparkle star. A whimsical, magical character with no boat in sight.

### Elements
- **Fairy Figure:** Delicate humanoid silhouette in indigo/violet
- **Wings:** Two pairs of butterfly-like wings in violet tones with iridescent shimmer
- **Wand:** Golden staff with a star sparkle at the tip (#FBBF24)
- **Sparkles:** Golden circles and stars surrounding the fairy (#FBBF24, #F59E0B)
- **Color Scheme:** Indigo-600 to Violet-500 gradient for the fairy, gold accents

### Icon Sizes
- 16×16: Toolbar favicon
- 48×48: Extension management
- 128×128: Chrome Web Store

### Wordmark
```
[fairy icon] G D  Fairy
             ↑ ↑    ↑
          blue indigo indigo-600
```

---

## Website Design

### Aesthetic: Superhuman meets Figma
- **Hero:** Dark gradient (slate-900 → deep indigo → indigo)
- **Sparkle particles:** CSS-animated floating dots in gold/violet/indigo
- **Cards:** Glassmorphism-lite (rgba bg, backdrop blur, border glow on hover)
- **Scroll animations:** `.reveal` class with IntersectionObserver fade-in
- **Typography:** Inter 400–800, large bold headlines, generous whitespace
- **Footer:** Dark, minimal — "Built for analysts who are tired of saying 'gd' at their data."

### Copy Tone
- Irreverent but knowledgeable
- "The data you're sending Google is broken." / "gd fairy fixes it."
- "The gd data quality tool you've been wishing for"
- "No fairy dust required. (Okay, maybe a little.)"
- "Wave goodbye to broken analytics."

---

## Dark Mode (future)

Side panel inherits system/Chrome theme preferences. Plan for dark mode support by using CSS custom properties for all colors and defining a dark variant.

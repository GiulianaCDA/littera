# Littera — Design System

**Littera:** Estude inglês através de cartas romanas. Sistema de repetição espaçada elegante e minimalista.

---

## Brand Identity

### Name & Meaning
- **Littera** (lat.) — letra, escrita, correspondência
- Refere-se ao ato de estudar através de textos e cartas
- Elegante, clássico, memorável

### Logo
```
L
—
```
Letra "L" em linhas retas (serif-free), representando:
- Simplicidade e clareza
- Estrutura e disciplina
- Foco no essencial

---

## Visual Language

### Paleta de Cores
```
Primary Background:   #0b0b0d  (Preto profundo)
Surface:              #131317  (Superfície elevada)
Surface Secondary:    #1a1a20  (Camada de profundidade)
Border/Line:          #26262e  (Linhas sutis)
Text Primary:         #e8e8ec  (Quase branco, não puro)
Text Muted:           #8b8b96  (Cinza médio)

Accent (Primary):     #a3e635  (Verde lima, confiante)
Alert/Urgent:         #f87171  (Vermelho, atenção)
Warning:              #fbbf24  (Âmbar, cautela)
Info:                 #7dd3fc  (Azul claro, informativo)
```

**Filosofia:**
- Dark mode por padrão (reduz fadiga ocular em estudo)
- Cores saturas e confiantes (não pastéis)
- Accent verde reflete crescimento e progresso
- Contraste WCAG AA mantido em todos os estados

---

## Typography

### Font Stack
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
/* System fonts: rápido, sem dependências, familiar */
```

### Monospace (Dados/Números)
```css
font-family: "SF Mono", "Cascadia Code", "Monaco", monospace;
```

### Type Scale
```
Display/Title:  16-18px, weight 700, -0.02em letter-spacing
Body:           15px,    weight 400, 1.6 line-height
Label/Caption:  12px,    weight 500, 0.04em letter-spacing, uppercase
Monospace:      13px,    weight 400, 1.4 line-height
```

---

## Spacing Scale
```
--space-xs:   4px   (micro adjustments)
--space-sm:   8px   (compact)
--space-md:  12px   (standard)
--space-lg:  16px   (comfortable)
--space-xl:  24px   (generous)
--space-2xl: 32px   (dramatic)
```

**Aplicação:** Todos os paddings, gaps e margins usam essa escala (ritmado, consistente).

---

## Components

### Badges
- **Purpose:** Exibir estado e contadores (cartões, revisões, sequência)
- **States:** 
  - Default (muted): informativo
  - Warm (amber): aviso leve (15+ cartões)
  - Hot (red): crítico (30+ cartões)
- **Style:** Monospace, uppercase, border 1px sutil
- **NO emojis:** Apenas números e cores

### Buttons
- **Tab buttons:** 44px min-height, padding 10px 14px
- **Grade buttons:** 48px min-height, padding 12px 14px, ícones SVG
- **Icon buttons:** 44px min-height, circular
- **Primary buttons:** Accent green, bold

### Cards
- **Flashcard:** Principal componente de estudo
  - Padding responsivo (24px-40px)
  - Border 1px subtle
  - Background surface
  - Radius 14px
- **Practice result:** Border-left colorido (green/amber), animação slide-in

### Forms
- **Inputs:** Bottom border style (não full border), focus color accent
- **Labels:** Monospace, uppercase, muted color
- **Textarea:** Monospace, relaxed line-height

---

## Motion & Animations

### Principles
- **Subtlety:** Animações refinadas, não alarmantes
- **Purpose:** Feedback visual, transições de estado
- **Respect:** Honrar `prefers-reduced-motion`

### Library
```css
fade:     opacity + translateY(4px), 0.2s ease
spin:     rotate(360deg), 0.8s linear (loading)
slideIn:  opacity + translateY(-8px), 0.3s ease (feedback)
```

---

## Responsive Design

### Breakpoints
- **320px-380px:** Small phones (reflow agressivo)
- **381px-560px:** Regular phones (2-column layouts)
- **561px-768px:** Tablets (comfortable spacing)
- **769px+:** Desktop (max-width 720px container)

### Touch Targets
- Mínimo 44px (Apple Human Interface Guidelines)
- Botões, tabs, inputs com padding generoso

---

## Accessibility

### Contrast
- Todos os elementos mantêm WCAG AA
- Text primary (#e8e8ec) em backgrounds dark (contrast 15+)
- Muted text em surfaces (contrast 7+)

### Interaction
- Keyboard navigation suportado (tab, enter, arrow keys)
- Focus states visíveis (border + cor)
- Aria-labels em ícones e buttons

### Motion
- `prefers-reduced-motion` respected (sem spin, fade apenas)

---

## Code Organization

### CSS
- **Tokens:** `:root` com cores, spacing, radius, fontes
- **Global:** Reset, body, typography base
- **Sections:** Cada seção documentada (header, card, forms, etc)
- **Breakpoints:** Mobile-first, organized by viewport
- **No nesting:** Flat structure, classes specific

### HTML
- **Semantic:** `<header>`, `<main>`, `<section>`, `<form>`
- **Accessibility:** Aria-labels onde necessário
- **Classes:** BEM-like (`.card`, `.card-meta`, `.card-tag`)

---

## Design Principles

1. **Minimalismo:** Apenas o necessário, nada mais
2. **Clareza:** Interface transparente, intent óbvio
3. **Elegância:** Refinada, não juvenil
4. **Consistência:** Padrões repetidos, previsível
5. **Acessibilidade:** Inclusivo por padrão
6. **Performance:** Sem animações pesadas, SVG nativo

---

## Evolution Notes

**v1.0 (Current):**
- Dark mode elegante e minimalista
- Mobile-first responsive design
- Sem emojis (ícones SVG apenas)
- Sistema de tokens completo
- 4 views principais: Estudar, Praticar, Cartões, Adicionar

**Futuro considerações:**
- Light mode (opcional)
- Temas customizáveis (token swapping)
- Animações mais sofisticadas
- Suporte a múltiplos idiomas (i18n)
- Gestos em mobile (swipe)

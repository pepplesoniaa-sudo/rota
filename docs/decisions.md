# Rota Architectural & Product Decisions

This file is append-only. New decisions are added at the top, dated, with the question and the decision. Never edit or delete past entries.

---

### 2026-10-22: Client UI Dependencies Approved (GIT-7, GIT-9)

- **Question:** Are `expo-font`, `@expo-google-fonts/inter`, and `expo-system-ui` approved as client dependencies in `apps/mobile` for embedding static Inter fonts at build time and synchronizing root background color?
- **Answer:** Rox approves `expo-font`, `@expo-google-fonts/inter`, and `expo-system-ui`.

---

### 2026-10-21: Mobile Design System Architecture, Color Palette & Typography

- **Decision:** Port the design token system from Digital book to `apps/mobile` using W3C/Figma token JSON as the single source of truth, primitive tonal palettes (HCT) as Tier 1, semantic M3 color roles as Tier 2, 4px spacing grid, and 5 elevation levels.
- **Color Palette:** New custom Rota palette generated via `@material/material-color-utilities` TonalPalette (HCT) with primary `#006878` (deep teal, hue 215), secondary hue 215 chroma 16, tertiary hue 275 chroma 28 (muted indigo), neutral hue 215 chroma 4, neutralVariant hue 215 chroma 8, error `#FC1740`, success `#1E9454`, warning `#F2913C`. Includes all 24 tone steps required for M3 surface container roles (0, 4, 6, 10, 12, 17, 20, 22, 24, 30, 40, 50, 60, 70, 80, 87, 90, 92, 94, 95, 96, 98, 99, 100).
- **Typography:** Inter only (`@expo-google-fonts/inter`), embedded at build time. Lora is dropped because Rota displays dense, glanceable operational shift schedules and rotas. Each typography token maps to an exact static font family (e.g. `Inter_600SemiBold`, `Inter_500Medium`, `Inter_400Regular`) to ensure consistent rendering across Android and iOS. Numerical tokens for shift times, dates, and amounts include `fontVariant: ['tabular-nums']`.
- **Token Resolution Pipeline:** A runtime TypeScript resolver in `src/ui/tokens/resolve.ts` validates tokens with Zod and resolves aliases into a typed `Theme` object at import time. No `node:` code generation script under `apps/mobile/**` (per CS-5).
- **Hardcoded Colors Ban:** Enforce CS-13 via ESLint rule (`no-restricted-syntax` banning hex color string literals in `apps/mobile/**` outside `src/ui/tokens/**`).

---

### 2026-10-21: Decisions from PRD v1.1

- **Backend Framework:** Next.js App Router route handlers on Node 22 runtime (not Hono).
- **Free Trial:** 14-day trial for new teams before the first charge is due.
- **Cache & Queues:** Redis 7 in the Docker Compose stack (not Upstash).
- **Draft & Publish:** Shifts support a draft and publish workflow (FR-15c) so staff receive batched notifications.
- **Availability Warning:** Availability warning (FR-20) is a Must requirement.
- **Apple Developer Program:** Decision pending. Push notifications default to Android only; iOS runs in Simulator.

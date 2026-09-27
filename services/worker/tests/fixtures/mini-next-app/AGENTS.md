# Contributor guide

## Layout

- `app/` Next.js App Router pages and `layout.tsx` (the HTML shell).
- `components/` small React components, one per file, named in PascalCase.
- `styles/tokens.css` every colour as a CSS custom property on `:root`. Tailwind maps them to
  utilities in `app/globals.css` (`bg-canvas`, `bg-surface`, `text-ink`, `text-muted`, `border-line`, `text-brand`).

## Rules

- No literal colours in components. Use the token utilities only.
- A theme is a class on `<html>` that redefines the token properties in `styles/tokens.css`.
- Global header controls are rendered from `components/HeaderActions.tsx`, in order.
- Client components start with `"use client"`. Anything touching `window` or `localStorage` is a client component.
- Keep files small and single-purpose.
- `npm run typecheck` and `npm run build` are the contract. Both must pass before a change is merged.
- Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`).

// Intentionally empty: this page REMOUNTS on every focus navigation (App
// Router keys pages by their dynamic params), so nothing stateful can live
// here. The whole interactive tree — provider, graph, undo history — is
// mounted once by ../layout.tsx and reads the focus path from usePathname().
export default function GraphTimelinePage() {
  return null;
}

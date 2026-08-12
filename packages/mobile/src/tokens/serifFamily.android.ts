// Android serif display face: the generic 'serif' alias resolves to Noto Serif, bundled with
// the OS — no font file, no licensing. A bare 'Georgia' here would silently fall back to the
// default SANS on Android (the "absent typeface" bug tokens.ts's family comment documents).
export const serifFamily = 'serif';

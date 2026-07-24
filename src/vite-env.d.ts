/// <reference types="vite/client" />

interface ImportMetaEnv {
	// ID del Pixel de Meta (Events Manager). Se define en Vercel como VITE_META_PIXEL_ID.
	// Si no está definido, el Pixel queda deshabilitado (no-op) sin romper nada.
	readonly VITE_META_PIXEL_ID?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

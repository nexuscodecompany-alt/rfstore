import {
	HiOutlineSquares2X2,
	HiOutlineSparkles,
	HiOutlineSpeakerWave,
	HiOutlineDevicePhoneMobile,
	HiOutlineCpuChip,
	HiOutlineBuildingOffice2,
	HiOutlinePrinter,
	HiOutlineKey,
	HiOutlineWifi,
	HiOutlineComputerDesktop,
	HiOutlineCommandLine,
	HiOutlineShieldCheck,
	HiOutlineVideoCamera,
	HiOutlinePuzzlePiece,
	HiOutlineGift,
} from 'react-icons/hi2';
import { IconType } from 'react-icons';

// Mapea el nombre de categoría a un icono de react-icons.
// Match por keywords case-insensitive — si no hace match, ícono genérico.
const RULES: Array<{ keywords: string[]; icon: IconType }> = [
	{ keywords: ['audio', 'imagen', 'sonido', 'parlante'], icon: HiOutlineSpeakerWave },
	{ keywords: ['celular', 'smartphone', 'teléfono', 'telefono', 'movil', 'móvil'], icon: HiOutlineDevicePhoneMobile },
	{ keywords: ['gaming', 'gamer', 'juego', 'consola'], icon: HiOutlinePuzzlePiece },
	{ keywords: ['hardware', 'componente'], icon: HiOutlineCpuChip },
	{ keywords: ['hogar', 'oficina', 'home', 'office'], icon: HiOutlineBuildingOffice2 },
	{ keywords: ['impresora', 'printer'], icon: HiOutlinePrinter },
	{ keywords: ['licencia', 'software'], icon: HiOutlineKey },
	{ keywords: ['network', 'redes', 'wifi'], icon: HiOutlineWifi },
	{ keywords: ['notebook', 'laptop', 'pc', 'tablet', 'computadora'], icon: HiOutlineComputerDesktop },
	{ keywords: ['periféric', 'periferic', 'teclado', 'mouse', 'accesorio'], icon: HiOutlineCommandLine },
	{ keywords: ['seguridad', 'cámara', 'camara', 'cctv', 'vigilancia'], icon: HiOutlineShieldCheck },
	{ keywords: ['foto', 'video', 'streaming'], icon: HiOutlineVideoCamera },
];

export const ALL_ICON: IconType = HiOutlineSquares2X2;
export const NEW_ARRIVALS_ICON: IconType = HiOutlineSparkles;
// Categorías especiales / campañas (Día del Niño, Black Friday…).
export const SPECIAL_ICON: IconType = HiOutlineGift;
export const NEW_ARRIVALS_ID = '__new_arrivals__';

export const getCategoryIcon = (name?: string): IconType => {
	if (!name) return HiOutlineSquares2X2;
	const lower = name.toLowerCase();
	for (const r of RULES) {
		if (r.keywords.some(k => lower.includes(k))) return r.icon;
	}
	return HiOutlineSquares2X2;
};

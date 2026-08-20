import {
    FaBoxOpen,
    FaCartShopping,
    FaInstagram,
    FaLinkedin,
    FaFacebookF,
    FaCloudArrowDown,
    FaChartLine,
    FaUsers,
    FaTruckFast,
    FaStore,
    FaHouse,
    FaGear,
} from 'react-icons/fa6';

export const navbarLinks = [
    {
        id: 1,
        title: 'Inicio',
        href: '/',
    },
    {
        id: 2,
        title: 'Tienda',
        href: '/tienda',
    },
    {
        id: 3,
        title: 'Blog',
        href: '/blog',
    },
    {
        id: 4,
        title: 'Contacto',
        href: '/nosotros',
    },
];

export const socialLinks = [
    {
        id: 1,
        title: 'Linkedin',
        href: 'https://www.linkedin.com/company/rfstore/',
        icon: <FaLinkedin />,
    },
    {
        id: 2,
        title: 'Facebook',
        href: 'https://www.facebook.com/people/RF-Store/61568113774015/?_rdr',
        icon: <FaFacebookF />,
    },
    {
        id: 3,
        title: 'Instagram',
        href: 'https://www.instagram.com/rfstore.uy/',
        icon: <FaInstagram />,
    },
];

/**
 * Menú del panel. Los ítems con `children` son GRUPOS: no navegan solos, se
 * despliegan. La idea es que el lateral muestre pocas entradas y que todo lo que
 * es de la misma familia viva junto — antes había 16 ítems sueltos y encontrar
 * "Márgenes" o "Legales" era cuestión de barrer la lista con la vista.
 */
export interface DashboardLink {
    id: number;
    title: string;
    href: string;
    icon?: JSX.Element;
    children?: { id: number; title: string; href: string; end?: boolean }[];
}

export const dashboardLinks: DashboardLink[] = [
    {
        id: 0,
        title: 'Dashboard',
        href: '/dashboard',
        icon: <FaChartLine size={22} />,
    },
    {
        // Todo lo que define QUÉ se vende y a qué precio.
        id: 1,
        title: 'Productos',
        href: '/dashboard/productos',
        icon: <FaBoxOpen size={22} />,
        children: [
            { id: 101, title: 'Catálogo', href: '/dashboard/productos', end: true },
            { id: 102, title: 'Categorías y marcas', href: '/dashboard/productos/taxonomias' },
            { id: 103, title: 'Márgenes', href: '/dashboard/productos/margenes' },
            { id: 104, title: 'Extras del checkout', href: '/dashboard/productos/extras' },
        ],
    },
    {
        id: 2,
        title: 'Ordenes',
        href: '/dashboard/ordenes',
        icon: <FaCartShopping size={22} />,
    },
    {
        id: 14,
        title: 'Clientes',
        href: '/dashboard/clientes',
        icon: <FaUsers size={22} />,
    },
    {
        id: 15,
        title: 'Compras',
        href: '/dashboard/compras',
        icon: <FaTruckFast size={22} />,
    },
    {
        id: 5,
        title: 'CDR Sync',
        href: '/dashboard/cdr',
        icon: <FaCloudArrowDown size={22} />,
    },
    {
        id: 11,
        title: 'Mercado Libre',
        href: '/dashboard/mercadolibre',
        icon: <FaStore size={22} />,
    },
    {
        id: 13,
        title: 'Home',
        href: '/dashboard/home',
        icon: <FaHouse size={22} />,
    },
    {
        // El resto: cosas que se tocan una vez y se dejan andando.
        id: 16,
        title: 'Configuración',
        href: '/dashboard/pagos',
        icon: <FaGear size={22} />,
        children: [
            { id: 161, title: 'Pagos', href: '/dashboard/pagos' },
            { id: 162, title: 'Envíos', href: '/dashboard/envios' },
            { id: 163, title: 'Cupones', href: '/dashboard/cupones' },
            { id: 164, title: 'Blog', href: '/dashboard/blog' },
            { id: 165, title: 'Legales', href: '/dashboard/legales' },
        ],
    },
];
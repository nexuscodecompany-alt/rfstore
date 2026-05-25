import {
    FaBoxOpen,
    FaCartShopping,
    FaInstagram,
    FaLinkedin,
    FaFacebookF,
    FaPenToSquare,
    FaCloudArrowDown,
    FaMoneyBillTransfer,
    FaChartLine,
    FaTags,
    FaPercent,
    FaStar,
    FaScaleBalanced,
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

export const dashboardLinks = [
    {
        id: 0,
        title: 'Inicio',
        href: '/dashboard',
        icon: <FaChartLine size={22} />,
    },
    {
        id: 1,
        title: 'Productos',
        href: '/dashboard/productos',
        icon: <FaBoxOpen size={22} />,
    },
    {
        id: 2,
        title: 'Ordenes',
        href: '/dashboard/ordenes',
        icon: <FaCartShopping size={22} />,
    },
    {
        id: 3,
        title: 'Taxonomías',
        href: '/dashboard/taxonomias',
        icon: <FaTags size={22} />,
    },
    {
        id: 4,
        title: 'Gestionar Blog',
        href: '/dashboard/blog',
        icon: <FaPenToSquare size={22} />,
    },
    {
        id: 5,
        title: 'CDR Sync',
        href: '/dashboard/cdr',
        icon: <FaCloudArrowDown size={22} />,
    },
    {
        id: 6,
        title: 'Pagos',
        href: '/dashboard/pagos',
        icon: <FaMoneyBillTransfer size={22} />,
    },
    {
        id: 7,
        title: 'Precios',
        href: '/dashboard/precios',
        icon: <FaPercent size={22} />,
    },
    {
        id: 8,
        title: 'Vitrina Home',
        href: '/dashboard/vitrina',
        icon: <FaStar size={22} />,
    },
    {
        id: 9,
        title: 'Legales',
        href: '/dashboard/legales',
        icon: <FaScaleBalanced size={22} />,
    },
];
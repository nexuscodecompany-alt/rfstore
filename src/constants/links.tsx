import {
    FaBoxOpen,
    FaCartShopping,
    FaInstagram,
    FaLinkedin,
    FaFacebookF,
    FaPenToSquare,
    FaCloudArrowDown,
    FaMoneyBillTransfer,
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
        id: 1,
        title: 'Productos',
        href: '/dashboard/productos',
        icon: <FaBoxOpen size={25} />,
    },
    {
        id: 2,
        title: 'Ordenes',
        href: '/dashboard/ordenes',
        icon: <FaCartShopping size={25} />,
    },
    {
        id: 3,
        title: 'Taxonomías',
        href: '/dashboard/taxonomias',
        icon: <FaBoxOpen size={25} />,
    },
    {
        id: 4,
        title: 'Gestionar Blog',
        href: '/dashboard/blog',
        icon: <FaPenToSquare size={25} />,
    },
    {
        id: 5,
        title: 'CDR Sync',
        href: '/dashboard/cdr',
        icon: <FaCloudArrowDown size={25} />,
    },
    {
        id: 6,
        title: 'Pagos',
        href: '/dashboard/pagos',
        icon: <FaMoneyBillTransfer size={25} />,
    },
];
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RootLayout } from '../layouts/RootLayout';
import {
    HomePage,
    CellPhonesPage,
    AboutPage,
    BlogPage,
    CellPhonePage,
    LoginPage,
    PostDetailPage,
    DashboardBlogPage,
    RegisterPage,
    OrdersUserPage,
    AccountProfilePage,
    DashboardPostFormPage,
    CheckoutPage,
    ThankyouPage,
    OrderUserPage,
    DashboardProductsPage,
    DashboardNewProductPage,
    DashboardProductSlugPage,
    DashboardOrdersPage,
    DashboardOrderPage,
    DashboardTaxonomiesPage,
    DashboardCdrSyncPage,
    DashboardPaymentsPage,
    DashboardHomePage,
    DashboardMarginsPage,
    DashboardCouponsPage,
    DashboardCustomersPage,
    DashboardPurchasesPage,
    DashboardHomeConfigPage,
    DashboardLegalPage,
    DashboardShippingPage,
    DashboardMercadoLibrePage,
    DashboardExtrasPage,
    RecoverCartPage,
    LegalPage,
} from '../pages';
import { ClientLayout } from '../layouts/ClientLayout';
import { DashboardLayout } from '../layouts/DashboardLayout';

export const router = createBrowserRouter([
    {
        path: '/',
        element: <RootLayout />,
        children: [
            // --- Rutas Públicas Principales ---
            {
                index: true,
                element: <HomePage />,
            },
            {
                path: 'tienda',
                element: <CellPhonesPage />,
            },
            {
                path: 'producto/:slug',
                element: <CellPhonePage />,
            },
            {
                path: 'nosotros',
                element: <AboutPage />,
            },

            // --- Rutas Públicas del Blog (Agrupadas) ---
            {
                path: 'blog', // Esta es la ruta PÚBLICA para que los clientes vean el blog
                element: <BlogPage />,
            },
             {
                path: 'blog/:slug', // Esta es la ruta PÚBLICA para que los clientes vean el blog
                element: <PostDetailPage />,
            },

            // --- Páginas legales (Términos, Privacidad, etc.) ---
            {
                path: 'legal/:slug',
                element: <LegalPage />,
            },


            // --- Rutas de Autenticación y Cuentas de Usuario ---
            {
                path: 'login',
                element: <LoginPage />,
            },
            {
                path: 'registro',
                element: <RegisterPage />,
            },
            {
                path: 'account',
                element: <ClientLayout />,
                children: [
                    {
                        index: true,
                        element: <Navigate to='/account/perfil' replace />,
                    },
                    {
                        path: 'perfil',
                        element: <AccountProfilePage />,
                    },
                    {
                        path: 'pedidos',
                        element: <OrdersUserPage />,
                    },
                    {
                        path: 'pedidos/:id',
                        element: <OrderUserPage />,
                    },
                ],
            },
        ],
    },
    // --- Rutas de Flujo de Compra (Checkout) ---
    {
        path: '/checkout',
        element: <CheckoutPage />,
    },
    {
        path: '/checkout/:id/thank-you',
        element: <ThankyouPage />,
    },
    // Destino del botón "Retomar mi compra" del mail de carrito abandonado.
    // Sin layout a propósito: restaura y redirige al checkout enseguida.
    {
        path: '/carrito/recuperar/:token',
        element: <RecoverCartPage />,
    },
    // --- Rutas del Panel de Administrador ---
    {
        path: '/dashboard',
        element: <DashboardLayout />,
        children: [
            {
                index: true,
                element: <DashboardHomePage />,
            },
            {
                path: 'productos',
                element: <DashboardProductsPage />,
            },
            {
                path: 'productos/new',
                element: <DashboardNewProductPage />,
            },
            {
                path: 'productos/editar/:slug',
                element: <DashboardProductSlugPage />,
            },
            // Todo lo que define QUÉ se vende y a qué precio vive dentro de
            // Productos. Las rutas viejas quedan como redirect para no romper
            // links guardados ni botones internos.
            {
                path: 'productos/taxonomias',
                element: <DashboardTaxonomiesPage />,
            },
            {
                path: 'productos/margenes',
                element: <DashboardMarginsPage />,
            },
            {
                path: 'productos/extras',
                element: <DashboardExtrasPage />,
            },
            {
                path: 'ordenes',
                element: <DashboardOrdersPage />,
            },
            {
                path: 'ordenes/:id',
                element: <DashboardOrderPage />,
            },
            {
                path: 'taxonomias',
                element: <Navigate to='/dashboard/productos/taxonomias' replace />,
            },
            // --- AÑADIMOS LAS RUTAS DEL BLOG DE ADMIN AQUÍ ---
            {
                path: 'blog',
                element: <DashboardBlogPage />,
            },
            {
                path: 'blog/nuevo',
                element: <DashboardPostFormPage />,
            },
            {
                path: 'blog/editar/:postId',
                element: <DashboardPostFormPage />,
            },
            {
                path: 'cdr',
                element: <DashboardCdrSyncPage />,
            },
            {
                path: 'pagos',
                element: <DashboardPaymentsPage />,
            },
            {
                path: 'precios',
                element: <Navigate to='/dashboard/productos/margenes' replace />,
            },
            {
                path: 'cupones',
                element: <DashboardCouponsPage />,
            },
            {
                path: 'clientes',
                element: <DashboardCustomersPage />,
            },
            {
                path: 'compras',
                element: <DashboardPurchasesPage />,
            },
            {
                path: 'vitrina',
                element: <Navigate to='/dashboard/home' replace />,
            },
            {
                path: 'home',
                element: <DashboardHomeConfigPage />,
            },
            {
                path: 'legales',
                element: <DashboardLegalPage />,
            },
            {
                path: 'envios',
                element: <DashboardShippingPage />,
            },
            {
                path: 'mercadolibre',
                element: <DashboardMercadoLibrePage />,
            },
        ],
    },
]);
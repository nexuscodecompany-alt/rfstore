import { LuMinus, LuPlus } from "react-icons/lu";
import { Separator } from "../components/shared/Separator";
import { formatPrice, prepareProducts, salePrice } from "../helpers";
import { usePaymentsEnabled, usePricingConfig } from "../hooks";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BsChatLeftText } from "react-icons/bs";
import { FaWhatsapp } from "react-icons/fa";
import { ProductDescription } from "../components/one-product/ProductDescription";
import { GridImages } from "../components/one-product/GridImages";
import { useProduct } from "../hooks/products/useProduct";
import { useQuery } from "@tanstack/react-query";
import { getSimilarProductsByCategory } from "../actions";
import { ProductGrid } from "../components/home/ProductGrid";
import { useEffect, useState } from "react";
import { Tag } from "../components/shared/Tag";
import { Loader } from "../components/shared/Loader";
import { useCounterStore } from "../store/counter.store";
import { useCartStore } from "../store/cart.store";
import toast from "react-hot-toast";
import type { Product } from "../interfaces";
import { trackViewContent, trackAddToCart } from "../lib/pixel";

export const CellPhonePage = () => {
  const { slug } = useParams<{ slug: string }>();

  const [currentSlug, setCurrentSlug] = useState(slug);

  const { product, isLoading, isError } = useProduct(currentSlug || "");

  const count = useCounterStore((state) => state.count);
  const increment = useCounterStore((state) => state.increment);
  const decrement = useCounterStore((state) => state.decrement);
  const resetCounter = useCounterStore((state) => state.reset);

  const addItem = useCartStore((state) => state.addItem);
  const pricing = usePricingConfig();
  const { enabled: paymentsEnabled } = usePaymentsEnabled();

  const navigate = useNavigate();

  // Producto = una sola "variante" interna. Tomamos la primera (única).
  const variant = product?.variants?.[0];
  const stock = variant?.stock ?? 0;
  const isOutOfStock = stock === 0;

  useEffect(() => {
    resetCounter();
  }, [variant?.id, resetCounter]);

  // Meta Pixel: ViewContent al ver la ficha del producto.
  useEffect(() => {
    if (!product || !variant) return;
    trackViewContent({
      id: product.id,
      name: product.name,
      price: salePrice(variant.price, pricing),
      category: (product as any).category?.name ?? null,
    });
    // Solo cuando cambia el producto mostrado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, variant?.id]);

  const isCdr = product?.source === 'cdr' && paymentsEnabled;
  const whatsappHref = product
    ? `https://wa.me/59894116299?text=${encodeURIComponent(
        `Hola, me interesa el producto "${product.name}". ¿Está disponible?`
      )}`
    : '#';

  const addToCart = () => {
    if (!variant || !product) return;
    addItem({
      variantId: variant.id,
      productId: product.id,
      name: product.name,
      image: product.images[0] || "",
      color: "",
      storage: "",
      price: salePrice(variant.price, pricing),
      quantity: count,
      source: (product.source as 'local' | 'cdr') || 'local',
      externalCode: product.external_code ?? null,
      stock: variant.stock,
    });
    trackAddToCart({
      id: product.id,
      name: product.name,
      price: salePrice(variant.price, pricing),
      quantity: count,
    });
    toast.success("Producto añadido al carrito", { position: "bottom-right" });
  };

  const buyNow = () => {
    if (!variant || !product) return;
    addItem({
      variantId: variant.id,
      productId: product.id,
      name: product.name,
      image: product.images[0] || "",
      color: "",
      storage: "",
      price: salePrice(variant.price, pricing),
      quantity: count,
      source: (product.source as 'local' | 'cdr') || 'local',
      externalCode: product.external_code ?? null,
      stock: variant.stock,
    });
    trackAddToCart({
      id: product.id,
      name: product.name,
      price: salePrice(variant.price, pricing),
      quantity: count,
    });
    // InitiateCheckout se dispara al montar CheckoutPage (fuente única), no acá.
    navigate("/checkout");
  };

  useEffect(() => {
    setCurrentSlug(slug);
  }, [slug]);

  if (isLoading) return <Loader />;

  if (!product || isError)
    return (
      <div className="flex justify-center items-center h-[80vh]">
        <p>Producto no encontrado</p>
      </div>
    );

  return (
    <>
      <div className="flex flex-col gap-16 mt-8 h-fit md:flex-row">
        {/* GALERÍA DE IMAGENES */}
        <GridImages images={product.images} />

        <div className="flex-1 space-y-5">
          <h1 className="text-3xl font-bold tracking-tight">{product.name}</h1>

          <div className="flex items-center gap-5">
            <span className="text-lg font-semibold tracking-wide">
              {formatPrice(salePrice(variant?.price ?? 0, pricing))}{" "}
              <span className="text-xs font-medium text-ink-500">
                IVA incluido
              </span>
            </span>

            <div className="relative">
              {isOutOfStock && <Tag contentTag="agotado" />}
            </div>
          </div>

          <Separator />

          {/* Características */}
          <ul className="my-10 space-y-2 ml-7">
            {product.features.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-2 text-sm font-medium tracking-tight"
              >
                <span className="bg-black w-[5px] h-[5px] rounded-full" />
                {feature}
              </li>
            ))}
          </ul>

          {/* COMPRAR */}
          {isOutOfStock ? (
            <button
              className=" uppercase font-semibold tracking-widest text-xs py-4 rounded-full transition-all duration-300 hover:bg-[#e2e2e2] w-full"
              disabled
            >
              Agotado
            </button>
          ) : !isCdr ? (
            // Productos no-CDR: solo consulta por WhatsApp.
            <div className="flex flex-col gap-3">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="py-4 text-xs font-semibold tracking-widest text-white uppercase bg-[#25D366] rounded-full flex items-center justify-center gap-2 hover:bg-[#1ebe5d] transition-colors"
              >
                <FaWhatsapp size={18} />
                Consultar por WhatsApp
              </a>
              <p className="text-[11px] text-center text-ink-500">
                Este producto se vende por consulta. Te respondemos en minutos.
              </p>
            </div>
          ) : (
            <>
              {/* Contador */}
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  Cantidad:
                  {stock > 0 && stock <= 5 && (
                    <span className="ml-2 text-xs font-normal text-amber-700">
                      (quedan {stock} en stock)
                    </span>
                  )}
                </p>

                <div className="flex gap-8 px-5 py-3 border rounded-full border-slate-200 w-fit">
                  <button onClick={decrement} disabled={count === 1}>
                    <LuMinus size={15} />
                  </button>
                  <span className="text-sm text-slate-500">{count}</span>
                  <button
                    onClick={() => {
                      if (count >= stock) {
                        toast.error(
                          stock === 1
                            ? "Solo queda 1 disponible"
                            : `Solo quedan ${stock} disponibles`,
                          { position: "bottom-right" }
                        );
                        return;
                      }
                      increment(stock);
                    }}
                    disabled={count >= stock}
                  >
                    <LuPlus size={15} />
                  </button>
                </div>
              </div>

              {/* BOTONES ACCIÓN */}
              <div className="flex flex-col gap-3">
                <button
                  className="bg-[#f3f3f3] uppercase font-semibold tracking-widest text-xs py-4 rounded-full transition-all duration-300 hover:bg-[#e2e2e2]"
                  onClick={addToCart}
                >
                  Agregar al carro
                </button>
                <button
                  className="py-4 text-xs font-semibold tracking-widest text-white uppercase bg-black rounded-full"
                  onClick={buyNow}
                >
                  Comprar ahora
                </button>
              </div>
            </>
          )}

          <div className="flex justify-center pt-2">
            <Link
              to="#"
              className="flex flex-col items-center justify-center gap-1"
            >
              <BsChatLeftText size={30} />
              <p className="flex flex-col items-center text-xs">
                <span className="font-semibold">¿Necesitas ayuda?</span>
                Contáctanos aquí
              </p>
            </Link>
          </div>
        </div>
      </div>

      {/* DESCRIPCIÓN */}
      <ProductDescription content={product.description} />

      {/* SIMILARES POR CATEGORÍA */}
      <SimilarProductsSection
        categoryId={product.category_id}
        currentProductId={product.id}
      />
    </>
  );
};

const SimilarProductsSection = ({
  categoryId,
  currentProductId,
}: {
  categoryId?: string | null;
  currentProductId?: string | null;
}) => {
  const canFetch = !!categoryId && !!currentProductId;

  const {
    data = [] as Awaited<ReturnType<typeof getSimilarProductsByCategory>>,
  } = useQuery<Awaited<ReturnType<typeof getSimilarProductsByCategory>>>({
    queryKey: ["similarProducts", categoryId, currentProductId],
    queryFn: () =>
      getSimilarProductsByCategory(
        categoryId as string,
        currentProductId as string
      ),
    enabled: canFetch,
  });

  if (!canFetch || data.length === 0) return null;

  const prepared = prepareProducts(data as unknown as Product[]);

  return (
    <div className="mt-10">
      <ProductGrid title="Productos similares" products={prepared} />
    </div>
  );
};

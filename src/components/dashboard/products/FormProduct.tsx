import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ProductFormValues, productSchema } from "../../../lib/validators";
import { IoIosArrowBack } from "react-icons/io";
import { useNavigate, useParams } from "react-router-dom";
import { SectionFormProduct } from "./SectionFormProduct";
import { InputForm } from "./InputForm";
import { FeaturesInput } from "./FeaturesInput";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { generateSlug, hasMarginOverride } from "../../../helpers";
import { VariantsInput } from "./VariantsInput";
import { UploaderImages } from "./UploaderImages";
import { Editor } from "./Editor";
import { PriceBox } from "./PriceBox";
import { CdrSyncLocksModal, type CdrSyncLocksValue } from "./CdrSyncLocksModal";
import {
  useCreateProduct,
  useProduct,
  useUpdateProduct,
  useTaxonomiesAdmin,
  useSetProductSyncLocks,
} from "../../../hooks";
import { Loader } from "../../shared/Loader";
import { JSONContent } from "@tiptap/react";
import { create } from "zustand";
import type { ProductInput } from "../../../interfaces";
import type { CdrSyncLocks } from "../../../actions";
import { repriceProductsMl } from "../../../actions/ml";



const EMPTY_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

// --- Definición del Store (se mantiene igual) ---

const initialState: ProductFormValues = {
  name: "",
  slug: "",
  brandId: "",
  categoryId: "",
  subcategoryId: "",
  features: [{ value: "" }],
  description: {} as JSONContent,
  images: [],
  variants: [
    { price: 0, stock: 0, storage: "", color: "#000000", colorName: "Único" },
  ],
  // Por defecto los productos manuales van "por consulta" (WhatsApp), igual
  // que antes de existir esta opción. El admin lo prende por producto.
  onlinePayment: false,
  fulfillment: 'propio' as 'dropship' | 'propio' | 'ambos',
  // Precio manual apagado en los dos canales: cada uno sale de su tabla de márgenes.
  manualPrice: false,
  marginPercent: 0,
  manualPriceMl: false,
  marginPercentMl: 0,
};

interface ProductFormState {
  formData: ProductFormValues;
  setFormData: (data: Partial<ProductFormValues>) => void;
  resetForm: () => void;
}

const useProductFormStore = create<ProductFormState>((set) => ({
  formData: initialState,
  setFormData: (data) =>
    set((state) => ({
      formData: { ...state.formData, ...data },
    })),
  resetForm: () => set({ formData: initialState }),
}));

interface Props {
  titleForm: string;
}

export const FormProduct = ({ titleForm }: Props) => {
  const { formData, setFormData, resetForm } = useProductFormStore();
  const { slug } = useParams<{ slug: string }>();

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    setValue,
    watch,
    control,
    reset, // <-- Importante: Obtenemos la función 'reset' de useForm
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: formData,
  });

  // ================== INICIO DE LA CORRECCIÓN ==================
  // Este useEffect ahora usa el método de suscripción de watch.
  // Solo se ejecuta UNA VEZ para crear la suscripción, rompiendo el bucle infinito.
  useEffect(() => {
    const subscription = watch((value) => {
      setFormData(value as ProductFormValues);
    });
    return () => subscription.unsubscribe();
  }, [watch, setFormData]);
  // =================== FIN DE LA CORRECCIÓN ====================

  // Limpia el formulario solo si estamos en modo "creación" al desmontar
  useEffect(() => {
    return () => {
      if (!slug) {
        resetForm();
      }
    };
  }, [resetForm, slug]);

  const { product, isLoading } = useProduct(slug || "");
  const { mutate: createProduct, isPending } = useCreateProduct();
  const { mutate: updateProduct, isPending: isUpdatePending } =
    useUpdateProduct(product?.id || "");
  const { brands, categories, subcategories } = useTaxonomiesAdmin();
  const navigate = useNavigate();

  const isCdrProduct = product?.source === "cdr";

  // Modal de candados de CDR: se abre solo cuando el admin guarda con precio
  // manual (así elige qué deja de sincronizar antes de que se guarde).
  const [locksModalOpen, setLocksModalOpen] = useState(false);
  const [locksValue, setLocksValue] = useState<CdrSyncLocksValue>({
    price: false,
    content: false,
    stock: false,
  });
  const [pendingSubmit, setPendingSubmit] = useState<ProductInput | null>(null);
  const { setSyncLocksAsync, isSettingSyncLocks } = useSetProductSyncLocks();

  const watchCategory = watch("categoryId");
  const filteredSubcategories = subcategories.filter(
    (s) => s.category_id === watchCategory
  );

  // Carga los datos del producto en modo "edición".
  // Recargamos el form cada vez que llegan datos frescos del producto (p. ej. al
  // reabrirlo tras guardar), PERO solo si el usuario no empezó a editar (isDirty),
  // así no le pisamos los cambios mientras trabaja.
  useEffect(() => {
    if (product && !isLoading && !isDirty) {
      const formDataFromProduct: ProductFormValues = {
        name: product.name ?? "",
        slug: product.slug ?? "",

        // Forzamos string (en la BD pueden venir null)
        brandId: product.brand_id ?? "",
        categoryId: product.category_id ?? "",
        subcategoryId: (product as any).subcategory_id ?? "",

        // El form espera [{ value: string }]
        features: (product.features ?? []).map((f: any) => ({
          value: String(f),
        })),

        // TipTap JSONContent
        description: (product.description as JSONContent) ?? EMPTY_DOC,

        // Si tu uploader usa URLs existentes como string[]
        images: (product.images ?? []) as string[],

        // Ya no usamos variantes: tomamos solo la primera fila (precio + stock).
        // Si el producto venía con varias, las demás quedan ignoradas a nivel UI
        // (el modelo las mantiene en DB hasta que se reescriba el producto).
        variants: (() => {
          const v0 = (product.variants ?? [])[0] as any;
          return [
            {
              id: v0?.id ?? undefined,
              stock: Number(v0?.stock ?? 0),
              price: Number(v0?.price ?? 0),
              storage: v0?.storage ?? "",
              color: v0?.color ?? "#000000",
              colorName: v0?.color_name ?? v0?.colorName ?? "Único",
            },
          ];
        })(),

        onlinePayment: product.online_payment === true,
        fulfillment: (product as { fulfillment?: 'dropship' | 'propio' | 'ambos' }).fulfillment ?? 'propio',
        // Márgenes manuales guardados, uno por canal (null = automático).
        manualPrice: hasMarginOverride(
          (product as { margin_override_percent?: number | null }).margin_override_percent
        ),
        marginPercent: Number(
          (product as { margin_override_percent?: number | null })
            .margin_override_percent ?? 0
        ),
        manualPriceMl: hasMarginOverride(
          (product as { ml_margin_override_percent?: number | null })
            .ml_margin_override_percent
        ),
        marginPercentMl: Number(
          (product as { ml_margin_override_percent?: number | null })
            .ml_margin_override_percent ?? 0
        ),
      };

      // Actualizamos el form y el store
      reset(formDataFromProduct);
      setFormData(formDataFromProduct);
    }
  }, [product, isLoading, isDirty, reset, setFormData]);

  // Guarda de verdad (crear o actualizar). Se llama directo, o después de que el
  // admin resuelve el modal de candados cuando puso precio manual.
  const persistProduct = (payload: ProductInput) => {
    if (slug) {
      updateProduct(payload, {
        // Si el producto está publicado en ML, el margen nuevo tiene que llegar
        // también a la publicación: encolamos el repreciado sólo de este producto
        // (la cola lo empuja a ML). Sin esto, la web quedaba con el precio nuevo y
        // Mercado Libre con el viejo.
        onSuccess: () => {
          const isInMl = (product as { is_in_ml?: boolean } | undefined)?.is_in_ml === true;
          // Sólo el margen de ML cambia el precio de la publicación; el de la web no.
          const prev =
            (product as { ml_margin_override_percent?: number | null } | undefined)
              ?.ml_margin_override_percent ?? null;
          const next = payload.mlMarginOverride ?? null;
          const marginChanged =
            prev === null || next === null
              ? prev !== next
              : Number(prev) !== Number(next);
          if (!isInMl || !marginChanged || !product?.id) return;
          repriceProductsMl([product.id])
            .then(() =>
              toast.success('Precio de Mercado Libre encolado para actualizar', {
                position: 'bottom-right',
              })
            )
            .catch(() =>
              toast.error(
                'El producto se guardó, pero no se pudo encolar el precio de ML. Usá “Repreciar publicaciones”.',
                { position: 'bottom-right', duration: 6000 }
              )
            );
        },
      });
    } else {
      createProduct(payload, {
        onSuccess: () => {
          resetForm();
          navigate("/dashboard/productos");
        },
      });
    }
  };

  const onSubmit = handleSubmit((data) => {
    const features = data.features.map((feature) => feature.value);
    const submissionData: ProductInput = {
      name: data.name,
      slug: data.slug,
      variants: data.variants,
      images: data.images,
      description: data.description,
      features,
      brandId: data.brandId,
      categoryId: data.categoryId,
      subcategoryId: data.subcategoryId || null,
      onlinePayment: data.onlinePayment === true,
      fulfillment: data.fulfillment ?? 'propio',
      // Precio manual apagado -> null, o sea vuelve al margen por tramo.
      marginOverride: data.manualPrice ? Number(data.marginPercent ?? 0) : null,
      mlMarginOverride: data.manualPriceMl ? Number(data.marginPercentMl ?? 0) : null,
    };

    // Precio manual sobre un producto de CDR: antes de guardar le preguntamos qué
    // quiere pausar del sync, con el precio pre-tildado. Si no, CDR le sigue
    // moviendo el costo y el precio final se le cambia a cada rato.
    const needsLocksPrompt =
      isCdrProduct &&
      (data.manualPrice === true || data.manualPriceMl === true) &&
      !!product?.id &&
      (product as { price_locked?: boolean }).price_locked !== true;

    if (needsLocksPrompt) {
      setPendingSubmit(submissionData);
      setLocksValue({
        price: true,
        content: (product as { content_locked?: boolean }).content_locked === true,
        stock: (product as { stock_locked?: boolean }).stock_locked === true,
      });
      setLocksModalOpen(true);
      return;
    }

    persistProduct(submissionData);
  }, (formErrors) => {
    // Si la validación falla, antes el formulario no daba ninguna señal.
    // Mostramos el primer mensaje de error para que el admin sepa qué corregir.
    const collectMessage = (errObj: any): string | null => {
      if (!errObj) return null;
      if (typeof errObj.message === "string") return errObj.message;
      for (const key of Object.keys(errObj)) {
        const found = collectMessage(errObj[key]);
        if (found) return found;
      }
      return null;
    };
    const message = collectMessage(formErrors);
    toast.error(message || "Revisá los campos del formulario", {
      position: "bottom-right",
    });
  });

  const watchName = watch("name");

  useEffect(() => {
    if (!watchName || slug) return;
    const generatedSlug = generateSlug(watchName);
    setValue("slug", generatedSlug, { shouldValidate: true });
  }, [watchName, setValue, slug]);

  if (slug && isLoading) return <Loader />; // Mostramos Loader solo al editar

  // El JSX se mantiene exactamente igual que en la versión anterior
  return (
    <div className="relative flex flex-col gap-6">
      {/* ... Tu JSX completo aquí ... */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            className="bg-white p-1.5 rounded-md shadow-sm border border-slate-200 transition-all group hover:scale-105"
            onClick={() => navigate(-1)}
          >
            <IoIosArrowBack
              size={18}
              className="transition-all group-hover:scale-125"
            />
          </button>
          <h2 className="text-2xl font-bold tracking-tight capitalize">
            {titleForm}
          </h2>
        </div>
      </div>

      <form
        className="grid flex-1 grid-cols-1 gap-8 lg:grid-cols-3 auto-rows-max"
        onSubmit={onSubmit}
      >
        <SectionFormProduct
          titleSection="Detalles del Producto"
          className="lg:col-span-2 lg:row-span-2"
        >
          <InputForm
            type="text"
            placeholder="Ejemplo: iPhone 13 Pro Max"
            label="nombre"
            name="name"
            register={register}
            errors={errors}
            required
          />
          <FeaturesInput control={control} errors={errors} />
        </SectionFormProduct>

        <SectionFormProduct>
          <InputForm
            type="text"
            label="Slug"
            name="slug"
            placeholder="iphone-13-pro-max"
            register={register}
            errors={errors}
          />
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Marca</label>
            <select
              className="p-2 border border-gray-300 rounded-md"
              {...register("brandId")}
            >
              <option value="">Seleccionar marca</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
            {errors.brandId && (
              <p className="text-xs text-red-500">
                {errors.brandId.message as string}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Categoría</label>
            <select
              className="p-2 border border-gray-300 rounded-md"
              {...register("categoryId")}
            >
              <option value="">Seleccionar categoría</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {errors.categoryId && (
              <p className="text-xs text-red-500">
                {errors.categoryId.message as string}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">
              Subcategoría{" "}
              <span className="text-xs font-normal text-gray-400">
                (opcional)
              </span>
            </label>
            <select
              className="p-2 border border-gray-300 rounded-md disabled:bg-gray-100 disabled:cursor-not-allowed"
              disabled={!watchCategory}
              {...register("subcategoryId")}
            >
              <option value="">
                {watchCategory
                  ? "Sin subcategoría"
                  : "Elegí primero una categoría"}
              </option>
              {filteredSubcategories.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name}
                </option>
              ))}
            </select>
          </div>
        </SectionFormProduct>

        <SectionFormProduct
          titleSection="Precio y stock"
          className="lg:col-span-2 h-fit"
        >
          <VariantsInput
            control={control}
            errors={errors}
            register={register}
          />

          {/* Desglose del precio en vivo: costo -> margen -> IVA -> total, con
              el margen y el total editables si el admin prende "Precio manual". */}
          <PriceBox
            register={register}
            watch={watch}
            setValue={setValue}
            categoryId={watchCategory}
            subcategoryId={watch("subcategoryId")}
          />

          {/* Forma de venta: pago online vs. consulta por WhatsApp.
              Los productos de CDR se venden online siempre, así que ahí la
              opción no aplica (mostramos el estado, sin checkbox). */}
          <div className="p-3 mt-4 border rounded-lg bg-slate-50 border-slate-200">
            {isCdrProduct ? (
              <p className="text-sm text-slate-600">
                <span className="font-semibold text-slate-800">Pago online</span>
                <span className="block mt-0.5 text-xs text-slate-500">
                  Este producto viene del catálogo de CDR: se vende online siempre.
                </span>
              </p>
            ) : (
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-emerald-600"
                  {...register("onlinePayment")}
                />
                <span className="text-sm">
                  <span className="font-semibold text-slate-800">
                    Habilitar pago online
                  </span>
                  <span className="block mt-0.5 text-xs text-slate-500">
                    {watch("onlinePayment")
                      ? "El cliente lo agrega al carrito y paga por Mercado Pago o transferencia. Se descuenta del stock cargado arriba."
                      : "Se muestra con el botón “Consultar por WhatsApp” (sin carrito ni pasarela)."}
                  </span>
                </span>
              </label>
            )}

            {/* De dónde sale la unidad. Marcarlo como PROPIO deja al producto
                fuera del sync de precio/stock de CDR (le pone los candados). */}
            <label className="mt-4 block">
              <span className="text-sm font-semibold text-slate-800">
                Origen del stock
              </span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                {...register("fulfillment")}
              >
                <option value="dropship">Dropship — lo despacha CDR</option>
                <option value="propio">Propio — sale de nuestro depósito</option>
                <option value="ambos">Ambos — tenemos stock y además pedimos a CDR</option>
              </select>
              <span className="mt-1 block text-xs text-slate-500">
                {watch("fulfillment") === "dropship"
                  ? "El sync de CDR le maneja el precio y el stock."
                  : "Queda fuera del sync de CDR (precio y stock los manejás vos). El stock se carga con las compras."}
              </span>
            </label>
          </div>
        </SectionFormProduct>

        <SectionFormProduct titleSection="Imágenes del producto">
          <UploaderImages errors={errors} setValue={setValue} watch={watch} />
        </SectionFormProduct>

        <SectionFormProduct
          titleSection="Descripción del producto"
          className="col-span-full"
        >
          <Editor
            setValue={setValue}
            errors={errors}
            initialContent={(watch("description") as JSONContent) || EMPTY_DOC}
          />
        </SectionFormProduct>

        <div className="absolute top-0 right-0 flex gap-3">
          <button
            className="btn-secondary-outline"
            type="button"
            onClick={() => navigate(-1)}
          >
            Cancelar
          </button>
          <button
            className="btn-primary"
            type="submit"
            disabled={isPending || isUpdatePending}
          >
            {isPending || isUpdatePending ? "Guardando..." : "Guardar Producto"}
          </button>
        </div>
      </form>

      {/* Precio manual sobre un producto de CDR: elegí qué deja de sincronizar
          antes de guardar. Al confirmar se aplican los candados y recién ahí se
          guarda el producto. */}
      <CdrSyncLocksModal
        open={locksModalOpen}
        productName={product?.name ?? watch("name")}
        value={locksValue}
        submitting={isSettingSyncLocks || isUpdatePending}
        intro="Le pusiste precio manual a este producto. ¿Qué querés que CDR deje de tocar? Al guardar se aplican estos candados y se guarda el producto."
        onClose={() => {
          setLocksModalOpen(false);
          setPendingSubmit(null);
        }}
        onSubmit={async (locks: CdrSyncLocks) => {
          if (product?.id) {
            try {
              await setSyncLocksAsync({ id: product.id, locks });
            } catch {
              // El hook ya avisa por toast; si falla no guardamos a medias.
              return;
            }
          }
          setLocksModalOpen(false);
          if (pendingSubmit) {
            persistProduct(pendingSubmit);
            setPendingSubmit(null);
          }
        }}
      />
    </div>
  );
};

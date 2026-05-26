import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ProductFormValues, productSchema } from "../../../lib/validators";
import { IoIosArrowBack } from "react-icons/io";
import { useNavigate, useParams } from "react-router-dom";
import { SectionFormProduct } from "./SectionFormProduct";
import { InputForm } from "./InputForm";
import { FeaturesInput } from "./FeaturesInput";
import { useEffect } from "react";
import toast from "react-hot-toast";
import { generateSlug } from "../../../helpers";
import { VariantsInput } from "./VariantsInput";
import { UploaderImages } from "./UploaderImages";
import { Editor } from "./Editor";
import {
  useCreateProduct,
  useProduct,
  useUpdateProduct,
  useTaxonomies,
} from "../../../hooks";
import { Loader } from "../../shared/Loader";
import { JSONContent } from "@tiptap/react";
import { create } from "zustand";



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
    { price: 0, stock: 0, storage: "", color: "#000000", colorName: "Negro" },
  ],
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
  const { brands, categories, subcategories } = useTaxonomies();
  const navigate = useNavigate();

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

        // Normalizamos variantes al shape del form (colorName)
        variants: (product.variants ?? []).map((v) => ({
          id: (v as any).id ?? undefined,
          stock: Number((v as any).stock ?? 0),
          price: Number((v as any).price ?? 0),
          storage: (v as any).storage ?? "",
          color: (v as any).color ?? "#000000",
          colorName: (v as any).color_name ?? (v as any).colorName ?? "",
        })),
      };

      // Actualizamos el form y el store
      reset(formDataFromProduct);
      setFormData(formDataFromProduct);
    }
  }, [product, isLoading, isDirty, reset, setFormData]);

  const onSubmit = handleSubmit((data) => {
    const features = data.features.map((feature) => feature.value);
    const submissionData = {
      name: data.name,
      slug: data.slug,
      variants: data.variants,
      images: data.images,
      description: data.description,
      features,
      brandId: data.brandId,
      categoryId: data.categoryId,
      subcategoryId: data.subcategoryId || null,
    };

    if (slug) {
      updateProduct(submissionData);
    } else {
      createProduct(submissionData, {
        onSuccess: () => {
          resetForm();
          navigate("/dashboard/productos");
        },
      });
    }
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
          titleSection="Variantes del Producto"
          className="lg:col-span-2 h-fit"
        >
          <VariantsInput
            control={control}
            errors={errors}
            register={register}
          />
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
    </div>
  );
};

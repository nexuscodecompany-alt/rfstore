import { useState } from 'react';
import { FieldErrors, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { ProductFormValues } from '../../../lib/validators';
import { IoIosCloseCircleOutline } from 'react-icons/io';

interface Props {
    setValue: UseFormSetValue<ProductFormValues>;
    watch: UseFormWatch<ProductFormValues>;
    errors: FieldErrors<ProductFormValues>;
}

export const UploaderImages = ({ setValue, errors, watch }: Props) => {
    const formImages = watch('images') || [];

    // Índice de la imagen que se está arrastrando y sobre cuál se está soltando,
    // para dar feedback visual (opacidad / anillo) durante el drag & drop.
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const newFiles = Array.from(e.target.files);
            const existingFiles = formImages.filter(img => img instanceof File || typeof img === 'string');
            setValue('images', [...existingFiles, ...newFiles], { shouldValidate: true });
        }
    };

    const handleRemoveImage = (indexToRemove: number) => {
        const updatedImages = formImages.filter((_, index) => index !== indexToRemove);
        setValue('images', updatedImages, { shouldValidate: true });
    };

    const getPreviewUrl = (image: File | string) => {
        if (typeof image === 'string') {
            return image;
        }
        return URL.createObjectURL(image);
    };

    // Reordena el array `images` moviendo el elemento `from` a la posición `to`.
    // Funciona mezclando strings (URLs ya subidas) y File (nuevas) sin distinción:
    // el orden del array = orden de visualización y la PRIMERA es la principal.
    const moveImage = (from: number, to: number) => {
        if (from === to) return;
        const updated = [...formImages];
        const [moved] = updated.splice(from, 1);
        updated.splice(to, 0, moved);
        setValue('images', updated, { shouldValidate: true });
    };

    const handleDrop = (targetIndex: number) => {
        if (dragIndex !== null) {
            moveImage(dragIndex, targetIndex);
        }
        setDragIndex(null);
        setOverIndex(null);
    };

    return (
        <>
            <input
                type='file'
                accept='image/*'
                multiple
                onChange={handleImageChange}
                className='block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200'
            />

            {formImages.length > 1 && (
                <p className='text-xs text-ink-500 mt-2'>
                    Arrastrá las imágenes para reordenarlas. La primera es la principal.
                </p>
            )}

            <div className='grid grid-cols-4 lg:grid-cols-2 gap-4 mt-4'>
                {formImages.map((image, index) => (
                    <div
                        key={index}
                        draggable
                        onDragStart={() => setDragIndex(index)}
                        onDragOver={(e) => {
                            e.preventDefault();
                            if (overIndex !== index) setOverIndex(index);
                        }}
                        onDragLeave={() => {
                            if (overIndex === index) setOverIndex(null);
                        }}
                        onDrop={() => handleDrop(index)}
                        onDragEnd={() => {
                            setDragIndex(null);
                            setOverIndex(null);
                        }}
                        className={`transition-all cursor-grab active:cursor-grabbing ${
                            dragIndex === index ? 'opacity-40' : 'opacity-100'
                        }`}
                    >
                        <div
                            className={`border w-full h-20 rounded-md p-1 relative lg:h-28 transition-all ${
                                overIndex === index && dragIndex !== index
                                    ? 'border-brand-500 ring-2 ring-brand-300'
                                    : 'border-gray-200'
                            }`}
                        >
                            {index === 0 && (
                                <span className='absolute top-1 left-1 z-10 inline-flex items-center rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-soft'>
                                    Principal
                                </span>
                            )}
                            <img
                                src={getPreviewUrl(image)}
                                alt={`Preview ${index}`}
                                draggable={false}
                                className='rounded-md w-full h-full object-contain pointer-events-none'
                            />
                            <button
                                type='button'
                                onClick={() => handleRemoveImage(index)}
                                className='flex justify-end absolute -top-3 -right-4 hover:scale-110 transition-all z-10'
                            >
                                <IoIosCloseCircleOutline size={22} className='text-red-500 bg-white rounded-full' />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {errors.images && (
                <p className='text-red-500 text-xs mt-1'>
                    {errors.images.message as string}
                </p>
            )}
        </>
    );
};

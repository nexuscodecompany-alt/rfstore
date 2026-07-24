import { useQuery } from '@tanstack/react-query';
import { getFilteredProducts } from '../../actions/';

export const useFilteredProducts = ({
  brands,
  categories,
  subcategories,
  priceMin,
  priceMax,
  page,
  searchTerm,
  sortOrder,
  newArrivalsOnly,
  specialProductIds,
  enabled = true,
}: {
  brands: string[];
  categories?: string[];
  subcategories?: string[];
  priceMin?: number;
  priceMax?: number;
  page: number;
  searchTerm?: string;
  sortOrder?: 'asc' | 'desc';
  newArrivalsOnly?: boolean;
  specialProductIds?: string[] | null;
  // Se usa para esperar a que resuelva ?special=<slug> antes de pegarle a la
  // base: sin esto se vería un flash con TODO el catálogo antes del filtro.
  enabled?: boolean;
}) => {
  const { data, isLoading } = useQuery({
    queryKey: ['filteredProducts', brands, categories, subcategories, priceMin, priceMax, page, searchTerm, sortOrder, newArrivalsOnly, specialProductIds],
    queryFn: () =>
      getFilteredProducts({
        brands,
        categories,
        subcategories,
        priceMin,
        priceMax,
        page,
        searchTerm,
        sortOrder,
        newArrivalsOnly,
        specialProductIds,
      }),
    retry: false,
    enabled,
  });

  return {
    data: data?.data,
    isLoading,
    totalProducts: data?.count ?? 0,
  };
};

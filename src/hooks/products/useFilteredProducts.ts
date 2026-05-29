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
}) => {
  const { data, isLoading } = useQuery({
    queryKey: ['filteredProducts', brands, categories, subcategories, priceMin, priceMax, page, searchTerm, sortOrder, newArrivalsOnly],
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
      }),
    retry: false,
  });

  return {
    data: data?.data,
    isLoading,
    totalProducts: data?.count ?? 0,
  };
};

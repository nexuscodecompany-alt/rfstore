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
}: {
  brands: string[];
  categories?: string[];
  subcategories?: string[];
  priceMin?: number;
  priceMax?: number;
  page: number;
  searchTerm?: string;
  sortOrder?: 'asc' | 'desc';
}) => {
  const { data, isLoading } = useQuery({
    queryKey: ['filteredProducts', brands, categories, subcategories, priceMin, priceMax, page, searchTerm, sortOrder],
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
      }),
    retry: false,
  });

  return {
    data: data?.data,
    isLoading,
    totalProducts: data?.count ?? 0,
  };
};

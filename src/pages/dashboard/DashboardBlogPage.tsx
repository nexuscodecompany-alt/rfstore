import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAllPostsForAdmin, deletePost } from '../../actions/post';
import { Toaster, toast } from 'react-hot-toast';
import { Loader } from '../../components/shared/Loader';

export const DashboardBlogPage = () => {
    const queryClient = useQueryClient();

    // Usamos useQuery para obtener todos los posts
    const { data: posts, isLoading, error } = useQuery({
        queryKey: ['adminPosts'],
        queryFn: getAllPostsForAdmin,
    });

    // Usamos useMutation para manejar la eliminación de posts
    const deletePostMutation = useMutation({
        mutationFn: deletePost,
        onSuccess: () => {
            toast.success('Post eliminado con éxito');
            // Invalidamos la query para que la lista se actualice automáticamente
            queryClient.invalidateQueries({ queryKey: ['adminPosts'] });
        },
        onError: (err) => {
            const errorMessage = err instanceof Error ? err.message : 'Ocurrió un error';
            toast.error(`Error al eliminar: ${errorMessage}`);
        },
    });

    const handleDelete = (postId: string) => {
        if (window.confirm('¿Estás seguro de que quieres eliminar este post?')) {
            deletePostMutation.mutate(postId);
        }
    };

    if (isLoading) return <Loader />;
    if (error) return <p>Error al cargar los posts: {error.message}</p>;

    return (
        <div>
            <Toaster position="top-right" />
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold">Gestionar Blog</h1>
                <Link
                    to="/dashboard/blog/nuevo"
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                >
                    Crear Nuevo Post
                </Link>
            </div>
            <div className="bg-white shadow-md rounded-lg overflow-x-auto">
                <table className="min-w-full leading-normal">
                    <thead>
                        <tr>
                            <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Título</th>
                            <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Estado</th>
                            <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {posts?.map((post) => (
                            <tr key={post.id}>
                                <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                    <p className="text-gray-900 whitespace-no-wrap">{post.title}</p>
                                </td>
                                <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                    <span className={`relative inline-block px-3 py-1 font-semibold leading-tight ${post.status === 'published' ? 'text-green-900' : 'text-yellow-900'}`}>
                                        <span aria-hidden className={`absolute inset-0 ${post.status === 'published' ? 'bg-green-200' : 'bg-yellow-200'} opacity-50 rounded-full`}></span>
                                        <span className="relative">{post.status}</span>
                                    </span>
                                </td>
                                <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                    <Link to={`/dashboard/blog/editar/${post.id}`} className="text-indigo-600 hover:text-indigo-900 mr-4">Editar</Link>
                                    <button
                                        onClick={() => handleDelete(post.id)}
                                        className="text-red-600 hover:text-red-900"
                                        disabled={deletePostMutation.isPending}
                                    >
                                        Eliminar
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
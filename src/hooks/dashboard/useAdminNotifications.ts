import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	getAdminNotifications,
	getUnreadNotificationsCount,
	markAllNotificationsRead,
	markNotificationRead,
} from '../../actions';

export const useAdminNotifications = (onlyUnread = false) => {
	const queryClient = useQueryClient();

	const list = useQuery({
		queryKey: ['admin-notifications', onlyUnread],
		queryFn: () => getAdminNotifications(onlyUnread),
		refetchInterval: 60 * 1000,
	});

	const unreadCount = useQuery({
		queryKey: ['admin-notifications-unread-count'],
		queryFn: getUnreadNotificationsCount,
		refetchInterval: 60 * 1000,
	});

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
		queryClient.invalidateQueries({
			queryKey: ['admin-notifications-unread-count'],
		});
	};

	const markOne = useMutation({
		mutationFn: markNotificationRead,
		onSuccess: invalidate,
	});
	const markAll = useMutation({
		mutationFn: markAllNotificationsRead,
		onSuccess: invalidate,
	});

	return {
		notifications: list.data ?? [],
		unreadCount: unreadCount.data ?? 0,
		isLoading: list.isLoading,
		markOne: markOne.mutate,
		markAll: markAll.mutate,
	};
};

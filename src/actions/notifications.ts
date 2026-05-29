// deno-lint-ignore-file no-explicit-any
import { supabase } from '../supabase/client';

export interface AdminNotification {
	id: number;
	type: string;
	payload: {
		count?: number;
		products?: { id: string; name: string; code: string }[];
		sync_mode?: string;
		[k: string]: unknown;
	};
	read_at: string | null;
	created_at: string;
}

// admin_notifications no está en los types generados de Supabase (tabla nueva).
// Castamos a any localmente — funciona en runtime y RLS exige is_admin().
const table = (supabase as any).from('admin_notifications');

export const getAdminNotifications = async (
	onlyUnread = false
): Promise<AdminNotification[]> => {
	let q = table.select('*').order('created_at', { ascending: false }).limit(50);
	if (onlyUnread) q = q.is('read_at', null);

	const { data, error } = await q;
	if (error) throw new Error(error.message);
	return (data ?? []) as AdminNotification[];
};

export const getUnreadNotificationsCount = async (): Promise<number> => {
	const { count, error } = await table
		.select('id', { count: 'exact', head: true })
		.is('read_at', null);
	if (error) throw new Error(error.message);
	return count ?? 0;
};

export const markNotificationRead = async (id: number) => {
	const { error } = await table
		.update({ read_at: new Date().toISOString() })
		.eq('id', id);
	if (error) throw new Error(error.message);
};

export const markAllNotificationsRead = async () => {
	const { error } = await table
		.update({ read_at: new Date().toISOString() })
		.is('read_at', null);
	if (error) throw new Error(error.message);
};

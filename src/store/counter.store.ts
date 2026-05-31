import { create, StateCreator } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface CounterState {
	count: number;
	increment: (max?: number) => void;
	decrement: () => void;
	reset: () => void;
}

const storeApi: StateCreator<CounterState> = set => ({
	count: 1,

	increment: (max?: number) => {
		set(state => ({
			count: max != null ? Math.min(max, state.count + 1) : state.count + 1,
		}));
	},

	decrement: () => {
		set(state => ({ count: Math.max(1, state.count - 1) }));
	},

	reset: () => set({ count: 1 }),
});

export const useCounterStore = create<CounterState>()(
	devtools(storeApi)
);

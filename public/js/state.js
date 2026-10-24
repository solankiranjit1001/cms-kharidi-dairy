import { get } from './api.js';

export const state = {
  user: null,
  meta: null,
  date: null,
  page: 'home',
};

export const ROLE_LABEL = { owner: 'માલિક', entry: 'એન્ટ્રી', viewer: 'ફક્ત જોવું' };
export const canWrite = () => state.user && (state.user.role === 'owner' || state.user.role === 'entry');
export const isOwner = () => state.user && state.user.role === 'owner';

export async function reloadMeta() {
  state.meta = await get('/meta');
  state.user = state.meta.user;
  return state.meta;
}

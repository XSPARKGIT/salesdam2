import api from '../api';

export const dial = (payload) => api.post('/telephony/calls', payload);
export default { dial };

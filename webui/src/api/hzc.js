import { get, post } from '../util/axios';

export default {
  list: async () => {
    const url = '/api/hzc/list';
    return await get(url);
  },
  modify: async (hzc) => {
    const url = '/api/hzc/' + (hzc.id ? 'modify' : 'add');
    return await post(url, hzc);
  },
  delete: async (id) => {
    const url = '/api/hzc/delete';
    return await post(url, { id });
  },
  listState: async () => {
    const url = '/api/hzc/listState?_=' + Math.random();
    return await get(url);
  },
  refresh: async (id) => {
    const url = '/api/hzc/refresh';
    return await post(url, { id });
  },
  run: async (id) => {
    const url = '/api/hzc/run';
    return await post(url, { id });
  },
  discover: async (body) => {
    const url = '/api/hzc/discover';
    return await post(url, body);
  }
};

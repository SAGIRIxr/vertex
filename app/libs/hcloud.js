const util = require('./util');

const apiUrl = 'https://api.hetzner.cloud/v1';

const _request = async function (apiToken, method, path, json) {
  const res = await util.requestPromise({
    url: apiUrl + path,
    method,
    headers: {
      Authorization: 'Bearer ' + apiToken
    },
    json: json || true
  }, false);
  const body = typeof res.body === 'string' ? (res.body ? JSON.parse(res.body) : {}) : (res.body || {});
  if (body && body.error) {
    throw new Error(`${body.error.code}: ${body.error.message}`);
  }
  if (res.statusCode >= 400) {
    throw new Error('Hetzner API 状态码: ' + res.statusCode);
  }
  return body;
};

exports.listServers = async function (apiToken) {
  const servers = [];
  let page = 1;
  while (page) {
    const body = await _request(apiToken, 'GET', `/servers?page=${page}&per_page=50`);
    servers.push(...(body.servers || []));
    page = body.meta && body.meta.pagination && body.meta.pagination.next_page;
  }
  return servers;
};

exports.createServer = async function (apiToken, options) {
  const body = await _request(apiToken, 'POST', '/servers', {
    name: options.name,
    server_type: options.serverType,
    image: options.image,
    location: options.location,
    volumes: options.volumes || []
  });
  return body.server;
};

exports.deleteServer = async function (apiToken, serverId) {
  return await _request(apiToken, 'DELETE', `/servers/${serverId}`);
};

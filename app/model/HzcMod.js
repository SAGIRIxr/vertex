const fs = require('fs');
const path = require('path');
const Hzc = require('../common/Hzc');
const hcloud = require('../libs/hcloud');

const util = require('../libs/util');

const hzcPath = path.join(__dirname, '../data/hzc');
const statsPath = path.join(hzcPath, 'stats');
if (!fs.existsSync(statsPath)) fs.mkdirSync(statsPath, { recursive: true });

class HzcMod {
  _list () {
    return fs.readdirSync(hzcPath)
      .filter(file => path.extname(file) === '.json')
      .map(file => JSON.parse(fs.readFileSync(path.join(hzcPath, file), { encoding: 'utf-8' })));
  };

  add (options) {
    const id = util.uuid.v4().split('-')[0];
    const hzcSet = { ...options };
    hzcSet.id = id;
    if (!hzcSet.apiToken) {
      throw new Error('API Token 不可为空');
    }
    this._validate(hzcSet);
    fs.writeFileSync(path.join(hzcPath, id + '.json'), JSON.stringify(hzcSet, null, 2));
    if (global.runningHzc[id]) global.runningHzc[id].destroy();
    if (hzcSet.enable) global.runningHzc[id] = new Hzc(hzcSet);
    return '添加 HZC 任务成功';
  };

  modify (options) {
    const hzcSet = { ...options };
    const filepath = path.join(hzcPath, options.id + '.json');
    const old = JSON.parse(fs.readFileSync(filepath, { encoding: 'utf-8' }));
    if (!hzcSet.apiToken || hzcSet.apiToken === '******') {
      hzcSet.apiToken = old.apiToken;
    }
    this._validate(hzcSet);
    fs.writeFileSync(filepath, JSON.stringify(hzcSet, null, 2));
    if (global.runningHzc[options.id]) global.runningHzc[options.id].destroy();
    if (hzcSet.enable) global.runningHzc[options.id] = new Hzc(hzcSet);
    return '修改 HZC 任务成功';
  };

  _validate (hzcSet) {
    hzcSet.serverNames = hzcSet.serverNames || [];
    hzcSet.strategies = (hzcSet.strategies || []).filter(item => item.serverType && item.snapshotId);
    if (hzcSet.enable) {
      if (hzcSet.serverNames.length === 0) {
        throw new Error('受管服务器名称列表不可为空');
      }
      if (+hzcSet.desiredCount > hzcSet.serverNames.length) {
        throw new Error('目标数量不可大于受管服务器名称数量');
      }
      if (hzcSet.strategies.length === 0) {
        throw new Error('至少需要一条创建策略');
      }
    }
  };

  delete (options) {
    fs.unlinkSync(path.join(hzcPath, options.id + '.json'));
    if (global.runningHzc[options.id]) global.runningHzc[options.id].destroy();
    const stats = path.join(statsPath, options.id + '.json');
    if (fs.existsSync(stats)) fs.unlinkSync(stats);
    return '删除 HZC 任务成功';
  };

  list () {
    return this._list().map(item => ({ ...item, apiToken: item.apiToken ? '******' : '' }));
  };

  listState () {
    return Object.keys(global.runningHzc).map(id => {
      const instance = global.runningHzc[id];
      return {
        id,
        alias: instance.alias,
        trafficLimit: instance.trafficLimit,
        state: instance.state,
        stats: instance.statSummary(),
        processing: instance.processing
      };
    });
  };

  async refresh (options) {
    const instance = global.runningHzc[options.id];
    if (!instance) throw new Error('该任务未启用');
    await instance.refreshState();
    return '刷新成功';
  };

  run (options) {
    const instance = global.runningHzc[options.id];
    if (!instance) throw new Error('该任务未启用');
    if (instance.processing) throw new Error('任务正在执行中');
    instance.process();
    return '任务已开始执行';
  };

  async discover (options) {
    let apiToken = options.apiToken;
    if ((!apiToken || apiToken === '******') && options.id) {
      const filepath = path.join(hzcPath, options.id + '.json');
      if (fs.existsSync(filepath)) {
        apiToken = JSON.parse(fs.readFileSync(filepath, { encoding: 'utf-8' })).apiToken;
      }
    }
    if (!apiToken || apiToken === '******') {
      throw new Error('请先填写 API Token');
    }
    const [servers, locations, serverTypes, snapshots, datacenters] = await Promise.all([
      hcloud.listServers(apiToken),
      hcloud.listLocations(apiToken),
      hcloud.listServerTypes(apiToken),
      hcloud.listSnapshots(apiToken),
      hcloud.listDatacenters(apiToken)
    ]);
    // 各区域支持的型号 id 集合, 用于标注策略型号在当前区域是否可用
    const typesByLocation = {};
    for (const dc of datacenters) {
      const loc = dc.location && dc.location.name;
      if (!loc) continue;
      if (!typesByLocation[loc]) typesByLocation[loc] = new Set();
      for (const id of ((dc.server_types && dc.server_types.available) || [])) {
        typesByLocation[loc].add(id);
      }
    }
    return {
      servers: servers.map(s => ({
        name: s.name,
        ip: s.public_net && s.public_net.ipv4 ? s.public_net.ipv4.ip : '',
        serverType: s.server_type && s.server_type.name,
        location: s.datacenter && s.datacenter.location ? s.datacenter.location.name : '',
        status: s.status
      })),
      locations: locations.map(l => ({
        name: l.name,
        description: l.description,
        city: l.city,
        country: l.country
      })),
      serverTypes: serverTypes.map(t => ({
        id: t.id,
        name: t.name,
        cores: t.cores,
        memory: t.memory,
        disk: t.disk,
        deprecated: !!t.deprecated,
        availableLocations: locations.map(l => l.name).filter(loc => typesByLocation[loc] && typesByLocation[loc].has(t.id))
      })),
      snapshots: snapshots.map(i => ({
        id: i.id,
        description: i.description,
        imageSize: i.image_size,
        created: i.created
      }))
    };
  };
}

module.exports = HzcMod;

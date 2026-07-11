const fs = require('fs');
const path = require('path');
const Hzc = require('../common/Hzc');

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
}

module.exports = HzcMod;

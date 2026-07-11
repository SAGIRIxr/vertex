const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const moment = require('moment');
const logger = require('../libs/logger');
const util = require('../libs/util');
const hcloud = require('../libs/hcloud');
const Push = require('./Push');

const statsDir = path.join(__dirname, '../data/hzc/stats');
const TIB = 1024 * 1024 * 1024 * 1024;

class Hzc {
  constructor (hzc) {
    this._hzc = hzc;
    this.id = hzc.id;
    this.alias = hzc.alias;
    this.apiToken = hzc.apiToken;
    this.location = hzc.location || 'nbg1';
    this.serverNames = hzc.serverNames || [];
    this.desiredCount = +hzc.desiredCount || 0;
    this.trafficLimit = +hzc.trafficLimit || 0;
    this.maxAgeDays = +hzc.maxAgeDays || 0;
    this.rebuildWait = +hzc.rebuildWait || 120;
    this.readyTimeout = hzc.readyTimeout === undefined || hzc.readyTimeout === '' ? 10 : +hzc.readyTimeout;
    this.strategies = (hzc.strategies || []).filter(item => item.serverType && item.snapshotId);
    this.updateClient = hzc.updateClient !== false;
    this.processing = false;
    this.state = { time: 0, servers: [] };
    this.summaryPushes = this._buildPushes(hzc.summaryNotify);
    this.rebuildPushes = this._buildPushes(hzc.rebuildNotify);
    if (!fs.existsSync(statsDir)) fs.mkdirSync(statsDir, { recursive: true });
    this.statsPath = path.join(statsDir, this.id + '.json');
    this.stats = [];
    try {
      if (fs.existsSync(this.statsPath)) {
        this.stats = JSON.parse(fs.readFileSync(this.statsPath, { encoding: 'utf-8' }));
      }
    } catch (e) {
      logger.error('HZC 任务', this.alias, '读取统计文件失败, 已重置\n', e);
      this.stats = [];
    }
    this.checkJob = cron.schedule(hzc.checkCron || '*/15 * * * *', () => this.process());
    if (hzc.reportCron) {
      this.reportJob = cron.schedule(hzc.reportCron, () => this.report());
    }
    logger.info('HZC 任务', this.alias, '初始化完毕');
  };

  _buildPushes (ids) {
    const pushes = [];
    for (const id of [...new Set(ids || [])]) {
      const tool = util.listPush().filter(item => item.id === id)[0];
      if (!tool) continue;
      pushes.push(new Push({ ...tool, push: true }));
    }
    return pushes;
  };

  destroy () {
    logger.info('HZC 任务', this.alias, '停止任务');
    this.checkJob.stop();
    if (this.reportJob) this.reportJob.stop();
    for (const push of [...this.summaryPushes, ...this.rebuildPushes]) {
      if (push.clearCountJob) push.clearCountJob.stop();
    }
    delete global.runningHzc[this.id];
  };

  async _notify (pushes, title, content) {
    for (const push of pushes) {
      try {
        await push.push(title, content);
      } catch (e) {
        logger.error('HZC 任务', this.alias, '通知发送失败', push.alias, '\n', e);
      }
    }
  };

  _recordStat (result) {
    const now = moment().unix();
    this.stats = this.stats.filter(i => now - i.time < 30 * 86400);
    this.stats.push({ time: now, result });
    try {
      fs.writeFileSync(this.statsPath, JSON.stringify(this.stats));
    } catch (e) {
      logger.error('HZC 任务', this.alias, '写入统计文件失败\n', e);
    }
  };

  statSummary () {
    const now = moment().unix();
    const events = this.stats.filter(i => now - i.time < 30 * 86400);
    return {
      rebuild: events.filter(i => i.result === 'rebuild').length,
      fail: events.filter(i => i.result === 'fail').length
    };
  };

  _progressBar (current, total, length = 10) {
    const percentage = total > 0 ? current / total : 0;
    const filledLength = Math.min(Math.max(Math.round(percentage * length), 0), length);
    return `[${'▓'.repeat(filledLength)}${'░'.repeat(length - filledLength)}]`;
  };

  _trafficEmoji (percentage) {
    if (percentage >= 80) return '🔴';
    if (percentage >= 50) return '🟡';
    return '🟢';
  };

  _matchClients (ip) {
    if (!ip) return [];
    const regex = new RegExp(`^(http[s]?:\\/\\/)?${ip.replace(/\./g, '\\.')}(\\b|:)`);
    return util.listClient().filter(client => regex.test(client.clientUrl));
  };

  _serverInfo (server) {
    const ip = server.public_net && server.public_net.ipv4 ? server.public_net.ipv4.ip : '';
    const limit = this.trafficLimit * TIB;
    const clients = this._matchClients(ip).map(client => {
      const running = global.runningClient[client.id];
      return {
        alias: client.alias,
        allTimeUpload: running && running.maindata ? running.maindata.allTimeUpload : null,
        allTimeDownload: running && running.maindata ? running.maindata.allTimeDownload : null
      };
    });
    return {
      id: server.id,
      name: server.name,
      ip,
      traffic: server.outgoing_traffic || 0,
      trafficLimit: limit,
      percentage: limit > 0 ? Math.round((server.outgoing_traffic || 0) / limit * 1000) / 10 : 0,
      uptimeMinutes: moment().diff(moment(server.created), 'minutes'),
      created: server.created,
      clients
    };
  };

  _serverMessage (info) {
    const usedTiB = (info.traffic / TIB).toFixed(2);
    const remaining = info.trafficLimit - info.traffic;
    const remainingTiB = this.trafficLimit ? (remaining > 0 ? (remaining / TIB).toFixed(2) : '0.00') : '-';
    const hours = Math.floor(info.uptimeMinutes / 60);
    const minutes = info.uptimeMinutes % 60;
    let message = `🖥 服务器: ${info.name} (${info.ip})\n\n`;
    if (this.trafficLimit) {
      message += `${this._trafficEmoji(info.percentage)} ${this._progressBar(info.traffic, info.trafficLimit)} ${info.percentage.toFixed(1)}%\n\n`;
    }
    message += `✅ 服务器已使用流量: ${usedTiB} TiB\n`;
    message += `🔻 服务器剩余可用流量: ${remainingTiB} TiB\n`;
    message += `⏳ 服务器运行时间: ${hours}小时 ${minutes}分钟\n\n`;
    if (info.clients.length > 0) {
      message += '📊 关联下载器统计:\n';
      for (const client of info.clients) {
        if (client.allTimeUpload !== null) {
          message += `  ${client.alias}: ⬆️ ${(client.allTimeUpload / TIB).toFixed(2)} TiB / ⬇️ ${(client.allTimeDownload / TIB).toFixed(2)} TiB\n`;
        } else {
          message += `  ${client.alias}: 数据获取失败\n`;
        }
      }
    } else {
      message += '🔗 关联 VT 下载器: 无\n';
    }
    return message;
  };

  async _createServer (name, oldServer) {
    if (this.strategies.length === 0) {
      throw new Error('未配置任何创建策略');
    }
    let retries = 3;
    while (retries > 0) {
      let lastError = null;
      for (const strategy of this.strategies) {
        try {
          logger.watch(this.alias, `正在尝试创建服务器 [${name}], 型号: ${strategy.serverType}, 快照: ${strategy.snapshotId}`);
          const server = await hcloud.createServer(this.apiToken, {
            name,
            serverType: strategy.serverType,
            image: +strategy.snapshotId,
            location: this.location,
            volumes: (oldServer && oldServer.volumes) || []
          });
          logger.watch(this.alias, `服务器 [${name}] 创建成功, 型号: ${strategy.serverType}`);
          return server;
        } catch (e) {
          logger.error('HZC 任务', this.alias, `策略 [${strategy.serverType}/${strategy.snapshotId}] 创建失败:`, e.message);
          lastError = e;
        }
      }
      retries--;
      if (retries > 0) {
        logger.watch(this.alias, `所有创建策略均失败, 30 秒后重试, 剩余重试次数: ${retries}`);
        await util.sleep(30000);
      } else {
        throw new Error(`所有创建策略均失败。最后一次错误: ${lastError.message}`);
      }
    }
  };

  async _waitReady (ip, oldIp) {
    if (!this.readyTimeout) return true;
    const urls = this._matchClients(oldIp).map(client => client.clientUrl.replace(oldIp, ip));
    if (urls.length === 0) return true;
    const deadline = moment().unix() + this.readyTimeout * 60;
    while (moment().unix() < deadline) {
      for (const url of urls) {
        try {
          await util.requestPromise({ url, timeout: 5000 }, false);
          logger.watch(this.alias, `新服务器 ${ip} 服务已就绪`);
          return true;
        } catch (e) {
          // 未就绪, 继续等待
        }
      }
      await util.sleep(15000);
    }
    logger.watch(this.alias, `新服务器 ${ip} 等待就绪超时 (${this.readyTimeout} 分钟)`);
    return false;
  };

  async _updateClients (oldIp, newIp) {
    // 延迟 require 避免模块循环引用
    const ClientMod = require('../model/ClientMod');
    const clientMod = new ClientMod();
    for (const client of this._matchClients(oldIp)) {
      try {
        client.clientUrl = client.clientUrl.replace(oldIp, newIp);
        clientMod.modify(client);
        logger.watch(this.alias, `VT 下载器 [${client.alias}] 地址已更新: ${oldIp} -> ${newIp}`);
      } catch (e) {
        logger.error('HZC 任务', this.alias, '更新下载器地址失败', client.alias, '\n', e);
      }
    }
  };

  async _rebuild (server, reason) {
    const info = this._serverInfo(server);
    logger.watch(this.alias, `服务器 ${server.name} (${info.ip}) 触发重建: ${reason}`);
    let message = `🚨 HZC 服务器重建通知 🚨\n服务器 ${server.name} (${info.ip}) 正在进行重建...\n触发原因: ${reason}\n\n`;
    message += this._serverMessage(info);
    await this._notify(this.rebuildPushes, 'HZC 服务器重建通知', message);
    await hcloud.deleteServer(this.apiToken, server.id);
    logger.watch(this.alias, `服务器 ${server.name} 已删除, 等待 ${this.rebuildWait} 秒后重建`);
    await util.sleep(this.rebuildWait * 1000);
    let newServer;
    try {
      newServer = await this._createServer(server.name, server);
    } catch (e) {
      this._recordStat('fail');
      logger.error('HZC 任务', this.alias, '重建服务器失败\n', e);
      await this._notify(this.rebuildPushes, 'HZC 服务器重建失败',
        `❌ HZC 服务器重建失败 ❌\n\n尝试为 ${server.name} 创建替代服务器失败, 请手动检查!\n错误: ${e.message}`);
      return;
    }
    this._recordStat('rebuild');
    const newIp = newServer.public_net && newServer.public_net.ipv4 ? newServer.public_net.ipv4.ip : '';
    let readyNote = '';
    if (this.updateClient && info.ip && newIp) {
      const ready = await this._waitReady(newIp, info.ip);
      readyNote = ready ? '' : `\n⚠️ 新服务器超过 ${this.readyTimeout} 分钟仍未就绪, 已直接切换下载器地址, 请留意下载器状态。`;
      await this._updateClients(info.ip, newIp);
    }
    await this._notify(this.rebuildPushes, 'HZC 服务器重建成功',
      `✅ HZC 服务器重建成功 ✅\n\n新服务器: ${newServer.name} (${newIp}) 已成功创建。${readyNote}`);
  };

  async process () {
    if (this.processing) return;
    this.processing = true;
    try {
      await this._process();
    } catch (e) {
      logger.error('HZC 任务', this.alias, '任务执行出错\n', e);
    } finally {
      this.processing = false;
    }
  };

  async _process () {
    const all = await hcloud.listServers(this.apiToken);
    const managed = all.filter(server => this.serverNames.includes(server.name));
    const usedNames = new Set(all.map(server => server.name));
    while (managed.length < this.desiredCount) {
      const name = this.serverNames.filter(n => !usedNames.has(n))[0];
      if (!name) {
        logger.error('HZC 任务', this.alias, '受管服务器名称已用尽, 无法补齐目标数量');
        break;
      }
      logger.watch(this.alias, `当前受管服务器数量 (${managed.length}) 小于目标数量 (${this.desiredCount}), 准备创建 [${name}]`);
      try {
        const server = await this._createServer(name, null);
        managed.push(server);
        usedNames.add(name);
        await this._notify(this.rebuildPushes, 'HZC 服务器创建成功',
          `✅ 已补建服务器 ${server.name} (${server.public_net && server.public_net.ipv4 ? server.public_net.ipv4.ip : ''})`);
      } catch (e) {
        this._recordStat('fail');
        logger.error('HZC 任务', this.alias, '补建服务器失败\n', e);
        await this._notify(this.rebuildPushes, 'HZC 服务器创建失败', `❌ 补建服务器 [${name}] 失败: ${e.message}`);
        break;
      }
    }
    for (const server of managed) {
      const overTraffic = this.trafficLimit > 0 && (server.outgoing_traffic || 0) > this.trafficLimit * TIB;
      const overAge = this.maxAgeDays > 0 && moment().diff(moment(server.created), 'days') >= this.maxAgeDays;
      if (overTraffic || overAge) {
        await this._rebuild(server, overTraffic ? `流量超过 ${this.trafficLimit} TiB` : `机龄超过 ${this.maxAgeDays} 天`);
      }
    }
    await this.refreshState();
  };

  async refreshState () {
    const all = await hcloud.listServers(this.apiToken);
    const managed = all.filter(server => this.serverNames.includes(server.name));
    this.state = {
      time: moment().unix(),
      servers: managed.map(server => this._serverInfo(server))
    };
    return this.state;
  };

  async report () {
    try {
      if (this.summaryPushes.length === 0) return;
      const state = await this.refreshState();
      if (state.servers.length === 0) return;
      const summary = this.statSummary();
      let message = state.servers.map(info => this._serverMessage(info)).join('\n────────────────────\n\n');
      message += `\n近 30 天: 重建 ${summary.rebuild} 次 / 失败 ${summary.fail} 次`;
      await this._notify(this.summaryPushes, 'HZC 服务器流量统计', message);
    } catch (e) {
      logger.error('HZC 任务', this.alias, '发送摘要报告失败\n', e);
    }
  };
}

module.exports = Hzc;

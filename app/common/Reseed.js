const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const moment = require('moment');
const util = require('../libs/util');
const logger = require('../libs/logger');

const queuePath = path.join(__dirname, '../data/reseed-queue.json');

class Reseed {
  constructor () {
    this.queue = [];
    try {
      if (fs.existsSync(queuePath)) {
        this.queue = JSON.parse(fs.readFileSync(queuePath, { encoding: 'utf-8' }));
      }
    } catch (e) {
      logger.error('等待辅种', '读取队列文件失败, 已重置队列\n', e);
      this.queue = [];
    }
    this.processing = false;
    this.job = cron.schedule('*/10 * * * * *', () => this.process());
  }

  _save () {
    fs.writeFileSync(queuePath, JSON.stringify(this.queue, null, 2));
  }

  hasTorrent (hash, bencodeHash) {
    return this.queue.some(item => item.torrent.hash === hash || (!!bencodeHash && item.bencodeHash === bencodeHash));
  }

  add (entry) {
    entry.id = util.uuid.v4().split('-')[0];
    entry.addTime = moment().unix();
    this.queue.push(entry);
    this._save();
    logger.watch(entry.rssAlias, `种子名称：${entry.torrent.name} 进入等待辅种,本地进度${Math.round(entry.progress * 100)}%,超时时间${entry.timeout}分钟`);
    return entry.id;
  }

  list () {
    return this.queue.map(item => {
      let bestProgress = null;
      let bestClientAlias = item.clientAlias;
      for (const key of item.clientIds) {
        const client = global.runningClient[key];
        if (!client || !client.maindata) continue;
        for (const t of client.maindata.torrents) {
          if (+t.size === +item.torrent.size && t.name === item.bencodeName && t.hash !== item.bencodeHash) {
            if (bestProgress === null || t.progress > bestProgress) {
              bestProgress = t.progress;
              bestClientAlias = client.alias;
            }
          }
        }
      }
      return {
        ...item,
        progress: bestProgress === null ? item.progress : bestProgress,
        clientAlias: bestClientAlias,
        expireAt: item.addTime + item.timeout * 60
      };
    });
  }

  async remove (id) {
    const item = this.queue.filter(i => i.id === id)[0];
    if (!item) throw new Error('该等待辅种记录不存在');
    await this._finish(item, 2, '拒绝原因: 手动放弃等待辅种');
  }

  async _finish (item, recordType, note) {
    this.queue = this.queue.filter(i => i.id !== item.id);
    this._save();
    await util.runRecord('INSERT INTO torrents (hash, name, size, rss_id, link, record_time, record_type, record_note) values (?, ?, ?, ?, ?, ?, ?, ?)',
      [item.torrent.hash, item.torrent.name, item.torrent.size, item.rssId, item.torrent.link, moment().unix(), recordType, note]);
    logger.watch(item.rssAlias, `种子名称：${item.torrent.name} ${note}`);
  }

  async process () {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    try {
      for (const item of [...this.queue]) {
        try {
          await this._processItem(item);
        } catch (e) {
          logger.error('等待辅种', item.torrent.name, '处理出错\n', e);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async _processItem (item) {
    const rssInstance = global.runningRss[item.rssId];
    if (moment().unix() > item.addTime + item.timeout * 60) {
      await this._finish(item, 2, '拒绝原因: 辅种失败,等待完成超时');
      if (rssInstance) await rssInstance.ntf.rejectTorrent(rssInstance._rss, undefined, item.torrent, '拒绝原因: 辅种失败,等待完成超时');
      return;
    }
    let found = false;
    for (const key of item.clientIds) {
      const client = global.runningClient[key];
      if (!client) continue;
      if (!client.status || !client.maindata) {
        // 下载器暂时离线, 无法判断, 继续等待
        found = true;
        continue;
      }
      for (const t of client.maindata.torrents) {
        if (+t.size !== +item.torrent.size || t.name !== item.bencodeName) continue;
        if (t.hash === item.bencodeHash) {
          await this._finish(item, 2, '拒绝原因: 辅种取消,下载器中已存在此种子');
          return;
        }
        found = true;
        if (+t.completed === +t.size) {
          await this._doReseed(item, client, t);
          return;
        }
      }
    }
    if (!found) {
      await this._finish(item, 2, '拒绝原因: 辅种失败,等待的本地种子已删除');
      if (rssInstance) await rssInstance.ntf.rejectTorrent(rssInstance._rss, undefined, item.torrent, '拒绝原因: 辅种失败,等待的本地种子已删除');
    }
  }

  async _doReseed (item, client, _torrent) {
    const rssInstance = global.runningRss[item.rssId];
    this.queue = this.queue.filter(i => i.id !== item.id);
    this._save();
    try {
      await client.addTorrent(item.torrent.url, item.torrent.hash, !!item.skipChecking, item.uploadLimit, item.downloadLimit, _torrent.savePath, item.category);
      await util.runRecord('INSERT INTO torrents (hash, name, size, rss_id, category, link, record_time, add_time, record_type, record_note) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [item.torrent.hash, item.torrent.name, item.torrent.size, item.rssId, item.category, item.torrent.link, moment().unix(), moment().unix(), 1, '辅种(等待完成)']);
      logger.watch(item.rssAlias, `种子名称：${item.torrent.name} 等待辅种成功,本地种子已完成,辅种至下载器 ${client.alias}${item.skipChecking ? ',跳过校验' : ',自动校验'}`);
      if (rssInstance) {
        rssInstance.addCount += 1;
        await rssInstance.ntf.addTorrent(rssInstance._rss, client, item.torrent);
      }
    } catch (error) {
      logger.error('等待辅种', item.rssAlias, '下载器', client.alias, '添加种子', item.torrent.name, '失败\n', error);
      await util.runRecord('INSERT INTO torrents (hash, name, size, rss_id, link, record_time, record_type, record_note) values (?, ?, ?, ?, ?, ?, ?, ?)',
        [item.torrent.hash, item.torrent.name, item.torrent.size, item.rssId, item.torrent.link, moment().unix(), 3, '辅种失败']);
      logger.watch(item.rssAlias, `种子名称：${item.torrent.name} 等待辅种失败`);
      if (rssInstance) await rssInstance.ntf.addTorrentError(rssInstance._rss, client, item.torrent);
    }
  }
}
module.exports = Reseed;

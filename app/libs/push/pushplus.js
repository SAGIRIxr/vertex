const logger = require('../logger');
const util = require('../util');

class PushPlus {
  constructor (push) {
    this.pushPlusToken = push.pushPlusToken;
    this.alias = push.alias;
  };

  async pushPushPlus (title, desp) {
    const option = {
      url: 'https://www.pushplus.plus/send',
      method: 'POST',
      json: {
        token: this.pushPlusToken,
        title,
        content: desp,
        template: 'txt'
      }
    };
    const res = await util.requestPromise(option);
    const json = res.body;
    if (!json || +json.code !== 200) {
      logger.error('推送失败', this.alias, title, res.body);
      return;
    }
    return json.data;
  };
}

module.exports = PushPlus;

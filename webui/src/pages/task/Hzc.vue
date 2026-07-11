<template>
  <div style="font-size: 24px; font-weight: bold;">HZC自动重建</div>
  <a-divider></a-divider>
  <div class="hzc">
    <a-table
      :style="`font-size: ${isMobile() ? '12px': '14px'};`"
      :columns="columns"
      size="small"
      :data-source="hzcList"
      :pagination="false"
      :scroll="{ x: 640 }"
    >
      <template #title>
        <span style="font-size: 16px; font-weight: bold;">任务列表</span>
        <span style="font-size: 12px; margin-left: 12px;">流量或机龄达到阈值时自动删除并从快照重建 Hetzner 服务器, 重建后自动更新 VT 下载器地址。</span>
      </template>
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'enable'">
          <a-switch @change="enableTask(record)" v-model:checked="record.enable" checked-children="启用" un-checked-children="禁用"/>
        </template>
        <template v-if="column.dataIndex === 'serverNames'">
          {{ (record.serverNames || []).join(' / ') }}
        </template>
        <template v-if="column.title === '操作'">
          <span>
            <a @click="modifyClick(record)">编辑</a>
            <a-divider type="vertical" />
            <a @click="runTask(record)">立即执行</a>
            <a-divider type="vertical" />
            <a-popover title="删除?" trigger="click" :overlayStyle="{ width: '84px', overflow: 'hidden' }">
              <template #content>
                <a-button type="primary" danger @click="deleteTask(record)" size="small">删除</a-button>
              </template>
              <a style="color: red">删除</a>
            </a-popover>
          </span>
        </template>
      </template>
    </a-table>
    <div v-for="task of states" :key="task.id" style="margin: 24px auto; text-align: center;">
      <div style="text-align: left; font-size: 16px; font-weight: bold; padding-left: 8px;">
        {{ task.alias }} - 服务器状态
        <span style="font-size: 12px; font-weight: normal; margin-left: 8px;" v-if="task.state.time">
          更新于 {{ $moment(task.state.time * 1000).format('MM-DD HH:mm:ss') }}
        </span>
        <a style="font-size: 12px; margin-left: 8px;" @click="refreshTask(task)">立即刷新</a>
        <span style="font-size: 12px; font-weight: normal; margin-left: 8px;">
          近 30 天: 重建 {{ task.stats.rebuild }} 次 / 失败 {{ task.stats.fail }} 次
          <span v-if="task.processing" style="color: #3A8FB7;"> · 执行中...</span>
        </span>
      </div>
      <template v-for="(server, index) of task.state.servers" :key="server.id">
        <div :class="`data-rect-2 ${index === 0 ? 'highlight-3' : ''}`" :style="index === 0 ? '' : 'background: #eff;'">
          <div :style="`font-size: 14px; font-weight: bold; padding: 12px 16px; ${index === 0 ? 'color: #fff;' : ''}`">
            <div>{{ server.name }} ({{ server.ip }})</div>
            <div style="margin: initial; font-size: 12px;" v-if="server.trafficLimit">
              {{ trafficEmoji(server.percentage) }} {{ progressBar(server.traffic, server.trafficLimit) }} {{ server.percentage.toFixed(1) }}%
            </div>
            <div style="margin: initial; font-size: 12px;">
              已用 {{ $formatSize(server.traffic) }}<template v-if="server.trafficLimit"> · 剩 {{ $formatSize(Math.max(0, server.trafficLimit - server.traffic)) }}</template>
              · 运行 {{ Math.floor(server.uptimeMinutes / 60) }}h {{ server.uptimeMinutes % 60 }}m
            </div>
            <div style="margin: initial; font-size: 12px;" v-if="server.clients.length">
              {{ server.clients.map(c => `${c.alias} ⬆ ${c.allTimeUpload === null ? '-' : $formatSize(c.allTimeUpload)}`).join(' / ') }}
            </div>
          </div>
        </div>
      </template>
      <div v-if="task.state.servers.length === 0" style="font-size: 12px; text-align: left; padding-left: 8px;">暂无受管服务器数据, 等待任务执行或点击立即刷新。</div>
    </div>
    <a-divider></a-divider>
    <div style="font-size: 16px; font-weight: bold; padding-left: 8px;">新增 | 编辑任务</div>
    <div style="text-align: left;">
      <a-form
        labelAlign="right"
        :labelWrap="true"
        :model="hzc"
        size="small"
        @finish="modifyHzc"
        :labelCol="{ span: 4 }"
        :wrapperCol="{ span: 20 }"
        autocomplete="off"
        :class="`container-form-${ isMobile() ? 'mobile' : 'pc' }`">
        <a-form-item
          label="别名"
          name="alias"
          extra="给任务取一个好记的名字"
          :rules="[{ required: true, message: '${label}不可为空! ' }]">
          <a-input size="small" v-model:value="hzc.alias"/>
        </a-form-item>
        <a-form-item
          label="启用"
          name="enable"
          extra="选择是否启用本任务">
          <a-checkbox v-model:checked="hzc.enable">启用</a-checkbox>
        </a-form-item>
        <a-form-item
          label="检查周期"
          name="checkCron"
          extra="Crontab 表达式, 每次执行检查流量与机龄并触发重建, 默认每 15 分钟"
          :rules="[{ required: true, message: '${label}不可为空! ' }]">
          <a-input size="small" v-model:value="hzc.checkCron"/>
        </a-form-item>
        <a-form-item
          label="摘要报告周期"
          name="reportCron"
          extra="Crontab 表达式, 按此周期发送流量摘要报告, 留空不发送">
          <a-input size="small" v-model:value="hzc.reportCron"/>
        </a-form-item>
        <a-form-item
          label="摘要报告通知"
          name="summaryNotify"
          extra="摘要报告发送到的通知工具, 可多选, 留空不发送">
          <a-select size="small" mode="multiple" v-model:value="hzc.summaryNotify">
            <a-select-option v-for="item of notifications" :key="item.id" :value="item.id">{{ item.alias }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item
          label="重建事件通知"
          name="rebuildNotify"
          extra="重建开始/成功/失败等事件发送到的通知工具, 可多选, 留空不发送">
          <a-select size="small" mode="multiple" v-model:value="hzc.rebuildNotify">
            <a-select-option v-for="item of notifications" :key="item.id" :value="item.id">{{ item.alias }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item
          label="API Token"
          name="apiToken"
          :extra="hzc.id ? '留空表示不修改' : 'Hetzner Cloud 项目的 API Token, 需要读写权限'">
          <a-input size="small" type="password" v-model:value="hzc.apiToken"/>
        </a-form-item>
        <a-form-item
          label="区域"
          name="location"
          extra="新建服务器所在区域, 例如: nbg1, fsn1, hel1, ash, hil"
          :rules="[{ required: true, message: '${label}不可为空! ' }]">
          <a-input size="small" v-model:value="hzc.location"/>
        </a-form-item>
        <a-form-item
          label="受管服务器名称"
          name="serverNames"
          extra="仅列表内名称的服务器会被管理, 账号内其他服务器不受影响; 顺序即补建顺序, 回车添加">
          <a-select size="small" mode="tags" v-model:value="hzc.serverNames" :open="false"/>
        </a-form-item>
        <a-form-item
          label="目标数量"
          name="desiredCount"
          extra="维持的受管服务器数量, 不足时自动按名称列表补建, 不可大于名称数量">
          <a-input size="small" type="number" min="0" v-model:value="hzc.desiredCount"/>
        </a-form-item>
        <a-form-item
          label="流量阈值 (TiB)"
          name="trafficLimit"
          extra="出站流量超过该值触发重建, 留空或 0 不启用; Hetzner 免费额度为 20TB ≈ 18.19TiB, 建议留有余量">
          <a-input size="small" type="number" min="0" step="0.1" v-model:value="hzc.trafficLimit"/>
        </a-form-item>
        <a-form-item
          label="机龄上限 (天)"
          name="maxAgeDays"
          extra="服务器创建超过该天数触发重建, 留空或 0 不启用">
          <a-input size="small" type="number" min="0" v-model:value="hzc.maxAgeDays"/>
        </a-form-item>
        <a-form-item
          label="重建等待 (秒)"
          name="rebuildWait"
          extra="删除服务器后等待该时间再创建, 默认 120">
          <a-input size="small" type="number" min="0" v-model:value="hzc.rebuildWait"/>
        </a-form-item>
        <a-form-item
          label="就绪等待 (分钟)"
          name="readyTimeout"
          extra="重建后轮询新服务器服务端口, 就绪后再切换下载器地址; 超时则直接切换, 填 0 不等待, 默认 10">
          <a-input size="small" type="number" min="0" v-model:value="hzc.readyTimeout"/>
        </a-form-item>
        <a-form-item
          label="创建策略"
          name="strategies"
          extra="从上到下依次尝试, 用于应对型号缺货; 型号需全小写 (如 cx43), 快照 ID 为数字">
          <div v-for="(strategy, index) of hzc.strategies" :key="index" style="margin-bottom: 4px;">
            <a-input size="small" style="width: 160px;" placeholder="型号, 如 cx43" v-model:value="strategy.serverType"/>
            <a-input size="small" style="width: 200px; margin-left: 8px;" placeholder="快照 ID" v-model:value="strategy.snapshotId"/>
            <a style="color: red; margin-left: 8px;" @click="hzc.strategies.splice(index, 1)">删除</a>
          </div>
          <a-button size="small" @click="hzc.strategies.push({ serverType: '', snapshotId: '' })">添加策略</a-button>
        </a-form-item>
        <a-form-item
          label="自动更新下载器"
          name="updateClient"
          extra="重建后将 clientUrl 匹配旧 IP 的 VT 下载器自动改为新 IP">
          <a-checkbox v-model:checked="hzc.updateClient">启用</a-checkbox>
        </a-form-item>
        <a-form-item
          :wrapperCol="isMobile() ? { span: 24 } : { span: 20, offset: 4 }">
          <a-button type="primary" html-type="submit" style="margin-top: 24px; margin-bottom: 48px;">应用 | 完成</a-button>
          <a-button style="margin-left: 12px;" @click="clearHzc()">清空</a-button>
        </a-form-item>
      </a-form>
    </div>
  </div>
</template>
<script>
export default {
  data () {
    const columns = [
      {
        title: '启用',
        dataIndex: 'enable',
        width: 15
      }, {
        title: '别名',
        dataIndex: 'alias',
        width: 30
      }, {
        title: '受管服务器',
        dataIndex: 'serverNames',
        width: 60
      }, {
        title: '检查周期',
        dataIndex: 'checkCron',
        width: 30
      }, {
        title: '操作',
        width: 40
      }
    ];
    return {
      columns,
      hzcList: [],
      states: [],
      notifications: [],
      hzc: {},
      defaultHzc: {
        id: '',
        alias: '',
        enable: true,
        checkCron: '*/15 * * * *',
        reportCron: '',
        summaryNotify: [],
        rebuildNotify: [],
        apiToken: '',
        location: 'nbg1',
        serverNames: [],
        desiredCount: 1,
        trafficLimit: 17,
        maxAgeDays: '',
        rebuildWait: 120,
        readyTimeout: 10,
        strategies: [],
        updateClient: true
      },
      stateTimer: null
    };
  },
  methods: {
    isMobile () {
      if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        return true;
      } else {
        return false;
      }
    },
    progressBar (current, total, length = 10) {
      const percentage = total > 0 ? current / total : 0;
      const filled = Math.min(Math.max(Math.round(percentage * length), 0), length);
      return '[' + '▓'.repeat(filled) + '░'.repeat(length - filled) + ']';
    },
    trafficEmoji (percentage) {
      if (percentage >= 80) return '🔴';
      if (percentage >= 50) return '🟡';
      return '🟢';
    },
    async listHzc () {
      try {
        const res = await this.$api().hzc.list();
        this.hzcList = res.data;
      } catch (e) {
        this.$message().error(e.message);
      }
    },
    async listState () {
      try {
        const res = await this.$api().hzc.listState();
        this.states = res.data;
      } catch (e) {
        this.$message().error(e.message);
      }
    },
    async listNotification () {
      try {
        const res = await this.$api().notification.list();
        this.notifications = res.data;
      } catch (e) {
        this.$message().error(e.message);
      }
    },
    async modifyHzc () {
      try {
        const res = await this.$api().hzc.modify({ ...this.hzc });
        this.$message().success((res.message || '保存成功') + ', 列表正在刷新...');
        setTimeout(() => {
          this.listHzc();
          this.listState();
        }, 1000);
        this.clearHzc();
      } catch (e) {
        this.$message().error(e.message);
      }
    },
    async enableTask (record) {
      try {
        const res = await this.$api().hzc.modify({ ...record });
        this.$message().success((res.message || '修改成功') + ', 列表正在刷新...');
        setTimeout(() => {
          this.listHzc();
          this.listState();
        }, 1000);
      } catch (e) {
        this.$message().error(e.message);
      }
    },
    async runTask (record) {
      try {
        const res = await this.$api().hzc.run(record.id);
        this.$message().success(res.message || '任务已开始执行');
        setTimeout(() => this.listState(), 3000);
      } catch (e) {
        this.$message().error(e.message);
      }
    },
    async refreshTask (task) {
      try {
        await this.$api().hzc.refresh(task.id);
        await this.listState();
        this.$message().success('刷新成功');
      } catch (e) {
        this.$message().error(e.message);
      }
    },
    async deleteTask (record) {
      try {
        await this.$api().hzc.delete(record.id);
        this.$message().success('删除成功, 列表正在刷新...');
        await this.listHzc();
        await this.listState();
      } catch (e) {
        this.$message().error(e.message);
      }
    },
    modifyClick (row) {
      this.hzc = { ...row, serverNames: [...(row.serverNames || [])], summaryNotify: [...(row.summaryNotify || [])], rebuildNotify: [...(row.rebuildNotify || [])], strategies: (row.strategies || []).map(item => ({ ...item })) };
      this.hzc.apiToken = '';
    },
    clearHzc () {
      this.hzc = {
        ...this.defaultHzc,
        serverNames: [],
        summaryNotify: [],
        rebuildNotify: [],
        strategies: [{ serverType: '', snapshotId: '' }]
      };
    }
  },
  async mounted () {
    this.clearHzc();
    this.listHzc();
    this.listState();
    this.listNotification();
    this.stateTimer = setInterval(() => this.listState(), 30000);
  },
  beforeUnmount () {
    if (this.stateTimer) clearInterval(this.stateTimer);
  }
};
</script>
<style scoped>
.hzc {
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
}

.data-rect-2 {
  text-align: left;
  vertical-align: top;
  width: 336px;
  min-height: 104px;
  transition: all 0.5s;
  color: #555;
  position: relative;
  display: inline-block;
  margin: 8px;
  border-radius: 8px;
}

.highlight-3 {
  background: #3A8FB7;
}
</style>

<template>
  <div style="font-size: 24px; font-weight: bold;">等待辅种</div>
  <a-divider></a-divider>
  <div class="reseed-queue" >
    <a-table
      :style="`font-size: ${isMobile() ? '12px': '14px'};`"
      :columns="columns"
      size="small"
      :loading="loading"
      :data-source="reseedQueue"
      :pagination="false"
      :scroll="{ x: 960 }"
    >
      <template #title>
        <span style="font-size: 16px; font-weight: bold;">等待辅种中</span>
        <span style="font-size: 12px; margin-left: 12px;">本地同体积种子完成后将自动辅入, 每 5 秒自动刷新。超时/放弃/成功的记录见 RSS 历史。</span>
        <div v-if="stats" style="font-size: 12px; margin-top: 4px;">
          近 {{ stats.days }} 天: 辅种成功 {{ stats.success }} · 超时 {{ stats.timeout }} · 放弃 {{ stats.abandon }} · 其他 {{ stats.other }}<span v-if="stats.avgWait"> · 平均等待 {{ stats.avgWait }} 分钟</span>
        </div>
      </template>
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'name'">
          {{ record.torrent.name }}
        </template>
        <template v-if="column.dataIndex === 'size'">
          {{ $formatSize(record.torrent.size) }}
        </template>
        <template v-if="column.dataIndex === 'progress'">
          {{ Math.round(record.progress * 100) }}%
        </template>
        <template v-if="column.dataIndex === 'addTime'">
          {{ $moment(record.addTime * 1000).format('YYYY-MM-DD HH:mm:ss') }}
        </template>
        <template v-if="column.dataIndex === 'expireAt'">
          {{ Math.max(0, Math.ceil((record.expireAt - $moment().unix()) / 60)) }} 分钟
        </template>
        <template v-if="column.title === '操作'">
          <a-popover title="放弃?" trigger="click" :overlayStyle="{ width: '84px', overflow: 'hidden' }">
            <template #content>
              <a-button type="primary" danger @click="deleteReseedQueue(record)" size="small">放弃</a-button>
            </template>
            <a style="color: red">放弃</a>
          </a-popover>
        </template>
      </template>
    </a-table>
  </div>
</template>
<script>
export default {
  data () {
    const columns = [
      {
        title: '种子名称',
        dataIndex: 'name',
        width: 120,
        fixed: true
      }, {
        title: '种子大小',
        dataIndex: 'size',
        width: 24
      }, {
        title: 'RSS',
        dataIndex: 'rssAlias',
        width: 24
      }, {
        title: '目标下载器',
        dataIndex: 'clientAlias',
        width: 24
      }, {
        title: '本地进度',
        dataIndex: 'progress',
        width: 24
      }, {
        title: '入队时间',
        dataIndex: 'addTime',
        width: 32
      }, {
        title: '剩余等待',
        dataIndex: 'expireAt',
        width: 24
      }, {
        title: '操作',
        dataIndex: 'option',
        width: 24
      }
    ];
    return {
      loading: true,
      columns,
      reseedQueue: [],
      stats: null,
      reseedTimer: null
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
    async listReseedQueue () {
      try {
        const res = await this.$api().rss.listReseedQueue();
        this.reseedQueue = res.data;
        const statsRes = await this.$api().rss.reseedQueueStats();
        this.stats = statsRes.data;
      } catch (e) {
        this.$message().error(e.message);
      }
      this.loading = false;
    },
    async deleteReseedQueue (record) {
      try {
        await this.$api().rss.deleteReseedQueue(record.id);
        this.$message().success('已放弃, 列表刷新中....');
        this.listReseedQueue();
      } catch (e) {
        await this.$message().error(e.message);
      }
    }
  },
  async mounted () {
    this.listReseedQueue();
    this.reseedTimer = setInterval(() => this.listReseedQueue(), 5000);
  },
  beforeUnmount () {
    if (this.reseedTimer) clearInterval(this.reseedTimer);
  }
};
</script>
<style scoped>
.reseed-queue {
  height: calc(100% - 92px);
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
}
</style>

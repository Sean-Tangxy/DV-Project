# TraceAtlas

纯静态离线原型，可用 Chrome 或 Edge 直接打开，不需要启动服务。

## 两个入口

- `review.html`：最新版本，包含测试主题分岛、可展开类别／文件索引、地块面积与颜色编码及岛间汇总线。右上「原版」进入修改前版本。
- `index.html`：本次地图修改前的 review 版本，保留原地图、深度 3D、上一轮／下一轮、逐轮／累积播放和性能优化。右上「新版」返回最新版本。

两个页面均支持 STS2 Agent 与 sszx_vs_zz。切换版本时保留所选数据集；轮次、刷选、文件选择等页面临时状态分别独立。更早的「检查演变／运行对照」页面已由修改前 review 替换。

## 使用与数据边界

左上选择对话轮次或单次测试循环，主图和右侧详情联动。底部时间轴可选择声明、运行或刷选时段，并支持逐轮、累积两种播放模式。

STS2 数据包含 2,234 条记录、888 次相关运行、235 条声明及 41,168 个测试执行身份条目；sszx_vs_zz 包含 858 条记录和 41 项规则识别的检查。执行实例会重复计数，不等于去重用例数。源码推断和邻近版本候选不证明测试实际通过；引用不是动态覆盖。保存的日志不保证完整历史版本或需求覆盖。

新版地图分类规则、视觉编码与布局算法见 `REVIEW_MAP_DESIGN.md`。页面右上「?」提供对应版本操作说明。

## 文件与验证

| 入口 | 主要文件 | 浏览器验证 |
|---|---|---|
| 最新版 `review.html` | `review-app.js`、`review-data.js`、`review.css`、`review-map-model.js`、`review-area-layout.js`、`review-map-view.js` | `node verify-review-browser.mjs` |
| 修改前版 `index.html` | `review-previous-app.js`、`review-previous-data.js`、`review-previous.css`、`atlas.js`、`map-view.js`、`map-3d.js` | `node verify-review-previous-browser.mjs` |

通用数据检查：`node verify-review.mjs`。新版分类与布局检查：`node verify-review-map.mjs`。浏览器验证需要本机安装 Chrome，会使用独立临时浏览器配置，不会重新运行原项目测试。

数据文件、模型和部分基础样式由两版共享；修改前版单独保存其控制逻辑、统计代码和界面样式，避免新版改动影响对照。

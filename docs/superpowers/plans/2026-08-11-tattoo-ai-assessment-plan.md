# Tattoo AI Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** 将现有单文件 tattoo-app 升级为符合已确认 PRD 的六维纹身难度评估与报告体验。

**Architecture:** 保留 `src/index.html` 的单文件运行方式和本地照片分析能力；把纯评分和报告生成集中在 `src/tattoo-analysis-core.js`，页面只负责收集选择、导航和展示结果。通过 Node 原生测试锁定评分边界和文案约束，再逐步替换页面数据与主题样式。

**Tech Stack:** HTML/CSS/原生 JavaScript、Node `node:test`、`coding-html-devserver`。

---

### Task 1: 为六维评分和报告生成建立失败测试

**Files:**
- Modify: `test/tattoo-analysis-core.test.mjs`
- Test: `test/tattoo-analysis-core.test.mjs`

- [ ] **Step 1: 添加评分 API 的失败测试**

在现有 `core` 测试后追加：

```js
test('calculates six assessment dimensions and caps total at 100', () => {
  const result = core.calculateAssessment({
    type: 'cover',
    colors: ['black', 'red', 'blue', 'green', 'yellow', 'purple'],
    density: 'high',
    cover: 'full',
    skin: 'raised',
    location: 'finger'
  });

  assert.equal(result.totalScore, 100);
  assert.equal(result.breakdown.density, 25);
  assert.equal(result.breakdown.cover, 20);
});

test('maps score boundaries to the four report levels', () => {
  assert.equal(core.getDifficultyLevel(25).level, 1);
  assert.equal(core.getDifficultyLevel(26).level, 2);
  assert.equal(core.getDifficultyLevel(50).level, 2);
  assert.equal(core.getDifficultyLevel(51).level, 3);
  assert.equal(core.getDifficultyLevel(75).level, 3);
  assert.equal(core.getDifficultyLevel(76).level, 4);
});

test('generates report tags and avoids treatment-count promises', () => {
  const report = core.generateReport({
    type: 'traditional',
    colors: ['black', 'red'],
    density: 'high',
    cover: 'none',
    skin: 'flat',
    location: 'arm'
  });

  assert.ok(report.tags.includes('#欧美传统'));
  assert.ok(report.riskFactors.some((item) => item.title === '色料密度'));
  assert.doesNotMatch(report.suggestion, /保证|几次洗掉|一定/);
});
```

- [ ] **Step 2: 运行测试确认是预期失败**

运行：`npm test`

预期：新增测试因 `calculateAssessment`、`getDifficultyLevel` 或 `generateReport` 尚未导出而失败；现有照片分析测试仍可运行。

- [ ] **Step 3: 保留测试中的输入契约**

确认测试使用的输入键固定为 `type`、`colors`、`density`、`cover`、`skin`、`location`，后续页面必须使用同一契约，不再让页面直接拼接分数。

### Task 2: 实现六维规则、等级和报告纯函数

**Files:**
- Modify: `src/tattoo-analysis-core.js`
- Test: `test/tattoo-analysis-core.test.mjs`

- [ ] **Step 1: 在 IIFE 内新增规则常量和纯函数**

在现有导出对象之前增加以下最小实现：

```js
const assessmentRules = {
  type: { black_gray: 5, traditional: 10, new_traditional: 10, line_text: 5, colorful: 13, cover: 15 },
  color: { black: 0, gray: 0, red: 3, blue: 5, green: 8, yellow: 10, purple: 8 },
  density: { low: 5, medium: 15, high: 25 },
  cover: { none: 0, partial: 10, full: 20 },
  skin: { flat: 0, raised: 7, scar_like: 15 },
  location: { torso: 0, arm: 3, leg: 5, finger: 10 }
};

function getDifficultyLevel(score) {
  const totalScore = Math.max(0, Math.min(100, Number(score) || 0));
  if (totalScore <= 25) return { level: 1, label: '一级', title: '相对简单' };
  if (totalScore <= 50) return { level: 2, label: '二级', title: '普通类型' };
  if (totalScore <= 75) return { level: 3, label: '三级', title: '复杂处理型' };
  return { level: 4, label: '四级', title: '高复杂案例' };
}

function calculateAssessment(input = {}) {
  const colors = Array.isArray(input.colors) ? input.colors : [];
  const colorScore = colors.reduce((sum, color) => sum + (assessmentRules.color[color] || 0), 0)
    + (colors.length >= 2 ? 5 : 0);
  const breakdown = {
    type: assessmentRules.type[input.type] || 0,
    color: Math.min(15, colorScore),
    density: assessmentRules.density[input.density] || 0,
    cover: assessmentRules.cover[input.cover] || 0,
    skin: assessmentRules.skin[input.skin] || 0,
    location: assessmentRules.location[input.location] || 0
  };
  const totalScore = Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0));
  return { breakdown, totalScore, level: getDifficultyLevel(totalScore) };
}
```

- [ ] **Step 2: 添加报告生成逻辑并导出**

报告必须输出 `title`、`tags`、`riskFactors`、`advantages`、`suggestion`。风险因素根据高密度、覆盖、彩色和凸起选择生成；优势因素根据无覆盖、低密度、平整皮肤选择生成；建议固定为循序渐进的人工评估表述。

在导出对象中加入：

```js
assessmentRules,
getDifficultyLevel,
calculateAssessment,
generateReport
```

- [ ] **Step 3: 运行单元测试确认通过**

运行：`npm test`

预期：所有旧测试和 Task 1 新增测试均 PASS。

### Task 3: 把页面问卷替换为六步评估数据模型

**Files:**
- Modify: `src/index.html`（步骤数组、状态、导航和结果计算相关脚本）
- Test: `test/tattoo-analysis-core.test.mjs`

- [ ] **Step 1: 替换 `steps` 和 `weights` 数据**

把现有五步旧问卷替换为六步：

```js
const steps = [
  { key: 'type', title: '你的纹身属于哪种类型？', desc: '选择最接近的一项', multi: false, options: [
    { value: 'black_gray', text: '黑灰写实' }, { value: 'traditional', text: '欧美传统' },
    { value: 'new_traditional', text: '新传统' }, { value: 'line_text', text: '线条文字' },
    { value: 'colorful', text: '彩色复杂' }, { value: 'cover', text: '覆盖纹身' }
  ] },
  { key: 'colors', title: '纹身里有哪些颜色？', desc: '可以多选', multi: true, options: [
    { value: 'black', text: '黑色' }, { value: 'gray', text: '灰色' }, { value: 'red', text: '红色' },
    { value: 'blue', text: '蓝色' }, { value: 'green', text: '绿色' }, { value: 'yellow', text: '黄色' }, { value: 'purple', text: '紫色' }
  ] },
  { key: 'density', title: '色料密度如何？', desc: '核心是单位区域的色料含量', options: [{ value: 'low', text: '低饱和' }, { value: 'medium', text: '正常' }, { value: 'high', text: '高饱和' }] },
  { key: 'cover', title: '是否有覆盖或修改？', desc: '覆盖可能意味着内部存在多层色料', options: [{ value: 'none', text: '无覆盖' }, { value: 'partial', text: '局部修改' }, { value: 'full', text: '完全覆盖' }] },
  { key: 'skin', title: '皮肤状态如何？', desc: '凸起不一定代表洗不掉', options: [{ value: 'flat', text: '平整' }, { value: 'raised', text: '轻微凸起' }, { value: 'scar_like', text: '明显凸起' }] },
  { key: 'location', title: '纹身位于哪里？', desc: '位置主要影响恢复速度', options: [{ value: 'torso', text: '躯干' }, { value: 'arm', text: '手臂' }, { value: 'leg', text: '腿' }, { value: 'finger', text: '手指 / 脚踝' }] }
];
```

- [ ] **Step 2: 更新选择、返回和继续逻辑**

`toggleTag` 使用 `step.multi` 判断单选/多选；单选步骤点击后替换数组，多选步骤切换数组成员。`nextStep` 在第六步把 `answers` 映射为核心层输入，调用 `calculateAssessment` 和 `generateReport`，不再按旧的 `weights` 计算。

- [ ] **Step 3: 更新页面文案和进度**

把 `STEP 1 / 5` 改为动态 `STEP 1 / 6`，颜色步骤显示“可多选”，其余步骤显示“请选择一项”；保留照片页可跳过行为。

- [ ] **Step 4: 在浏览器中手动验证导航**

启动：`npm run dev`

验证：欢迎页点击开始；照片页点击跳过；六步中前进/返回；颜色可同时选中两个颜色；最后一步进入报告。

### Task 4: 更新结果页为 PRD 报告结构

**Files:**
- Modify: `src/index.html`（结果 HTML、`calculateResult`、结果渲染函数）

- [ ] **Step 1: 调整结果 HTML 区块**

保留现有 `customer-summary` 和照片分析卡片；新增或改造以下容器：`result-score`、`result-tags`、`risk-factors`、`advantages`、`result-suggestion`。两个 CTA 的可见文案固定为“上传高清照片进一步分析”和“添加微信专业评估”。

- [ ] **Step 2: 渲染核心层输出**

`calculateResult` 将用户选择转换成 `{ type, colors, density, cover, skin, location }`，调用核心层，使用返回的 `level`, `totalScore`, `tags`, `riskFactors`, `advantages`, `suggestion` 更新 DOM。照片分析只作为额外卡片，不修改六维问卷分数。

- [ ] **Step 3: 添加空状态和安全文案**

没有照片时显示“未上传照片”；没有优势或风险项时不渲染空卡片；报告底部显示“结果仅供初步参考，具体方案以人工面诊为准”。

### Task 5: 应用冷光临床视觉并完成移动端适配

**Files:**
- Modify: `src/index.html`（`<style>` 内主题变量和相关组件样式）

- [ ] **Step 1: 替换设计变量**

设置深蓝黑背景、深色面板、青色主高光、现有金色品牌高光，并为风险/优势建立状态色变量。保留字体加载和现有圆角变量，避免无关布局重构。

- [ ] **Step 2: 更新首页、评估卡片和结果卡片样式**

首页采用深色 hero、扫描光背景和“3 分钟 / 6 维分析”信息块；评估选中态显示青色边框和轻微发光；结果分数采用圆环或高亮数字，风险因素采用琥珀提示卡，优势因素采用绿色卡。

- [ ] **Step 3: 加入小屏回归规则**

在现有媒体查询中确保 `.app` 最大宽度不造成横向溢出、卡片网格在 375px 宽度变为单列或两列、按钮高度至少 48px、长文案可换行。

- [ ] **Step 4: 浏览器视觉检查**

在移动视口检查首页、六步中间态、报告页；确认没有水平滚动条、按钮文字没有被截断、选中态有明显对比。

### Task 6: 构建、测试和交付检查

**Files:**
- Modify: `README.md`（补充六步评估和本地运行说明，如现有说明缺失）
- Generated: `dist/output/`（由构建命令生成）

- [ ] **Step 1: 运行完整测试**

运行：`npm test`

预期：所有测试 PASS，退出码为 0。

- [ ] **Step 2: 运行生产构建**

运行：`npm run build`

预期：命令成功并生成 `dist/output/index.html`。

- [ ] **Step 3: 检查工作区变更范围**

运行：`git diff --stat`（若目录仍无 Git 元数据，则使用 `Get-ChildItem src,test,docs -Recurse` 检查文件范围）。确认只有设计要求中的文件发生变化。

- [ ] **Step 4: 记录交付结果**

最终报告修改文件、新增功能、测试命令及结果，并注明本地照片分析仍是辅助判断、未接入真实 AI/CRM 后端。


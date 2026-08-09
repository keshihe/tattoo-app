# 本地纹身图像分析优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不上传客户照片的前提下，降低清洁、红色、面积和疤痕/脱色误判。

**Architecture:** 新增一个无 DOM 的浏览器兼容分析核心，负责像素证据判定和结果标签；现有 `src/index.html` 继续负责图片读取、Canvas 和页面渲染。通过 `<script>` 暴露 `window.TattooAnalysisCore`，Node 测试用 `vm` 加载同一份核心代码，避免测试逻辑和线上逻辑分叉。

**Tech Stack:** 原生 JavaScript、Canvas 2D、Node 内置 `node:test`、PowerShell/npm。

---

### Task 1: 建立分析核心与失败测试

**Files:**
- Create: `src/tattoo-analysis-core.js`
- Create: `test/tattoo-analysis-core.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

在测试中通过 `vm.runInNewContext` 加载 `src/tattoo-analysis-core.js`，覆盖这些输入输出：全皮肤或清洁图没有稳定色素时返回“未检测到明显纹身色素”；少量孤立红点不生成红色；暖色皮肤背景不生成红色；有效色素覆盖率低且主体包围盒小返回“小面积”；连续暗色主体返回黑灰；局部亮度/色度/纹理证据不足时不报疤痕；证据达到阈值时返回“疑似疤痕/脱色”；复杂场景返回低置信度和场景提示。

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/tattoo-analysis-core.test.mjs`

Expected: FAIL because `src/tattoo-analysis-core.js` and `window.TattooAnalysisCore` do not exist.

- [ ] **Step 3: Implement the minimal core API**

Expose `window.TattooAnalysisCore` with:

```js
{
  classifyPixel({ hue, sat, val, skinMeanV, localMeanV, localMeanS }),
  summarizeMetrics(metrics),
  createSceneWarning({ skinCoverage, edgeBackgroundRatio, nonSkinRegionRatio })
}
```

`classifyPixel` must require local contrast and reject isolated low-area color noise. `summarizeMetrics` must use both effective ink coverage and dominant component coverage, require stronger evidence for red, and use conservative scar/fade labels. `createSceneWarning` returns `null` for a clean single-skin scene and a short Chinese warning for complex scenes.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test test/tattoo-analysis-core.test.mjs`

Expected: all core behavior tests pass.

### Task 2: Integrate adaptive pixel evidence into the image analyzer

**Files:**
- Modify: `src/index.html:1736-2107`

- [ ] **Step 1: Add the core script before the inline application script**

Insert `<script src="./tattoo-analysis-core.js"></script>` immediately before the existing inline `<script>` so the existing global inline event handlers remain unchanged.

- [ ] **Step 2: Add local neighborhood statistics**

After HSV computation, build a low-cost integral/sampled neighborhood baseline for value and saturation. For each ROI pixel, compare its value and saturation with the surrounding skin window instead of relying only on `skinMeanV`.

- [ ] **Step 3: Replace raw pixel classification**

Call `TattooAnalysisCore.classifyPixel` from the existing pixel loop. Keep separate masks for ink and scar/fade evidence. Require connected components to be at least the larger of the current minimum and a small fraction of ROI pixels, while retaining a fallback for fine tattoo lines.

- [ ] **Step 4: Replace label and area aggregation**

Pass filtered color counts, effective ink coverage, dominant component coverage, red coverage, scar evidence, and scene metrics to `summarizeMetrics`. Preserve `topColors`, `isMultiColor`, `difficultyMod`, and all existing result-card fields.

- [ ] **Step 5: Add confidence and photo warning to the returned analysis**

Return `confidence`, `sceneWarning`, and `evidence` from `analyzeTattooImage`. Do not upload or persist the image anywhere.

### Task 3: Update customer-facing guidance without changing the flow

**Files:**
- Modify: `src/index.html:1456-1488`
- Modify: `src/index.html:2205-2228`

- [ ] **Step 1: Add concise shooting guidance**

Update the photo description and preview copy to recommend one tattoo per photo, close framing, natural light, no clothing/phone obstruction, and tattoo centered.

- [ ] **Step 2: Render conservative warnings**

When `sceneWarning` or low confidence exists, render a warning tag in the AI preview and result card. Keep the skip and continue buttons unchanged.

- [ ] **Step 3: Run a browser smoke check**

Start the app with `npm run dev`, upload the seven user-provided JPG files one at a time, and record the displayed color, area, and skin-condition labels. Confirm the first three do not show red or large area, the fourth/seventh can retain red-gray evidence, and the fifth/sixth/eighth-style complex scenes do not crash or silently report normal.

### Task 4: Build and final regression verification

**Files:**
- Modify: `README.md` only if the local-analysis behavior or photo guidance needs documentation.

- [ ] **Step 1: Run all automated tests**

Run: `node --test test/tattoo-analysis-core.test.mjs`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run the project build**

Run: `npm run build`

Expected: exit code 0 and output copied to `dist/output`.

- [ ] **Step 3: Verify the built artifact contains the core script**

Run: `Test-Path dist/output/tattoo-analysis-core.js; Test-Path dist/output/index.html`

Expected: both commands return `True`.

- [ ] **Step 4: Check the final diff and changed-file scope**

Run: `git -C C:\Users\Administrator\Downloads\app_17bddss3jav_refactored status --short` (expected to report that the directory is not a Git repository); inspect only the created/modified files listed above and do not add unrelated cleanup.

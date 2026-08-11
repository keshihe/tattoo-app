import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/tattoo-analysis-core.js', import.meta.url), 'utf8');
const context = {
  window: {}
};
vm.runInNewContext(source, context, { filename: 'tattoo-analysis-core.js' });
const core = context.window.TattooAnalysisCore;

test('local analysis does not expose a Gemini API', () => {
  assert.equal(core.analyzeWithGemini, undefined);
});

test('summarizeSelections keeps selected answers grouped by question', () => {
  const steps = [
    { key: 'position', title: 'Where', options: [{ text: 'Arm' }, { text: 'Leg' }] },
    { key: 'conditions', title: 'Condition', options: [{ text: 'Scar' }, { text: 'None' }] }
  ];

  const result = core.summarizeSelections(steps, { 0: [1], 1: [0] });

  assert.equal(JSON.stringify(result), JSON.stringify([
    { key: 'position', title: 'Where', items: ['Leg'] },
    { key: 'conditions', title: 'Condition', items: ['Scar'] }
  ]));
});

test('combined insight flags customer-reported skin concerns for review', () => {
  const insight = core.buildCombinedInsight([
    { key: 'conditions', title: 'Condition', items: ['Scar'] }
  ], {
    skinCondition: 'No obvious abnormality'
  });

  assert.equal(insight.hasConditionConcern, true);
  assert.match(insight.text, /复核/);
});

test('clean skin does not become tattoo pigment', () => {
  const result = core.summarizeMetrics({
    inkPixels: 0,
    totalRoiPixels: 10000,
    dominantInkPixels: 0,
    colorCounts: {},
    scarPixels: 0,
    scarEvidence: 0,
    scene: { skinCoverage: 0.82, edgeBackgroundRatio: 0.08, nonSkinRegionRatio: 0.12 }
  });

  assert.equal(result.colorType, '未检测到明显纹身色素');
  assert.equal(result.coverageLabel, '几乎无');
  assert.equal(result.skinCondition, '未见明显异常（照片无法完全判断）');
});

test('warm skin tones do not become red pigment', () => {
  const result = core.classifyPixel({
    hue: 24,
    sat: 0.38,
    val: 0.68,
    skinMeanV: 0.67,
    localMeanV: 0.67,
    localMeanS: 0.36
  });

  assert.equal(result.isInk, false);
  assert.notEqual(result.color, 'red');
});

test('red requires stronger chroma and local contrast', () => {
  const result = core.classifyPixel({
    hue: 4,
    sat: 0.62,
    val: 0.52,
    skinMeanV: 0.68,
    localMeanV: 0.66,
    localMeanS: 0.28
  });

  assert.equal(result.isInk, true);
  assert.equal(result.color, 'red');
});

test('isolated red noise does not create a red label', () => {
  const result = core.summarizeMetrics({
    inkPixels: 80,
    totalRoiPixels: 10000,
    dominantInkPixels: 20,
    colorCounts: { red: 80 },
    scarPixels: 0,
    scarEvidence: 0,
    scene: { skinCoverage: 0.8, edgeBackgroundRatio: 0.05, nonSkinRegionRatio: 0.08 }
  });

  assert.equal(result.colorType, '未检测到明显纹身色素');
});

test('small tattoo coverage is not reported as large area', () => {
  const result = core.summarizeMetrics({
    inkPixels: 420,
    totalRoiPixels: 10000,
    dominantInkPixels: 360,
    colorCounts: { black: 420 },
    scarPixels: 0,
    scarEvidence: 0,
    scene: { skinCoverage: 0.82, edgeBackgroundRatio: 0.05, nonSkinRegionRatio: 0.08 }
  });

  assert.equal(result.coverageLabel, '小面积');
});

test('continuous dark pigment is reported as black-gray', () => {
  const result = core.summarizeMetrics({
    inkPixels: 1800,
    totalRoiPixels: 10000,
    dominantInkPixels: 1500,
    colorCounts: { black: 1500, faded_black: 300 },
    scarPixels: 0,
    scarEvidence: 0,
    scene: { skinCoverage: 0.82, edgeBackgroundRatio: 0.05, nonSkinRegionRatio: 0.08 }
  });

  assert.match(result.colorType, /黑/);
  assert.notEqual(result.coverageLabel, '小面积');
});

test('scar or depigmentation needs sustained evidence', () => {
  const weak = core.summarizeMetrics({
    inkPixels: 0,
    totalRoiPixels: 10000,
    dominantInkPixels: 0,
    colorCounts: {},
    scarPixels: 500,
    scarEvidence: 0.25,
    scene: { skinCoverage: 0.8, edgeBackgroundRatio: 0.05, nonSkinRegionRatio: 0.08 }
  });
  const strong = core.summarizeMetrics({
    inkPixels: 0,
    totalRoiPixels: 10000,
    dominantInkPixels: 0,
    colorCounts: {},
    scarPixels: 700,
    scarEvidence: 0.78,
    scene: { skinCoverage: 0.8, edgeBackgroundRatio: 0.05, nonSkinRegionRatio: 0.08 }
  });

  assert.equal(weak.skinCondition, '未见明显异常（照片无法完全判断）');
  assert.equal(strong.skinCondition, '疑似疤痕/色差');
});

test('complex scenes reduce confidence and provide a warning', () => {
  const result = core.summarizeMetrics({
    inkPixels: 1200,
    totalRoiPixels: 10000,
    dominantInkPixels: 900,
    colorCounts: { black: 1200 },
    scarPixels: 0,
    scarEvidence: 0,
    scene: { skinCoverage: 0.38, edgeBackgroundRatio: 0.48, nonSkinRegionRatio: 0.55 }
  });

  assert.equal(result.confidence, 'low');
  assert.match(result.sceneWarning, /背景|单张/);
});

test('complex scenes with weak pigment evidence avoid specific labels', () => {
  const result = core.summarizeMetrics({
    inkPixels: 1400,
    totalRoiPixels: 100000,
    dominantInkPixels: 50,
    colorCounts: { blue: 850, black: 550 },
    scarPixels: 200,
    scarEvidence: 0.2,
    scene: { skinCoverage: 0.3, edgeBackgroundRatio: 0.5, nonSkinRegionRatio: 0.7 }
  });

  assert.equal(result.colorType, '未检测到稳定纹身色素');
  assert.equal(result.coverageLabel, '照片复杂，无法判断');
});

test('complex scenes with stable pigment evidence keep detected labels', () => {
  const result = core.summarizeMetrics({
    inkPixels: 1500,
    totalRoiPixels: 100000,
    dominantInkPixels: 1000,
    inkFootprintCoverage: 0.42,
    colorCounts: { black: 1500 },
    scarPixels: 0,
    scarEvidence: 0,
    scene: { skinCoverage: 0.3, edgeBackgroundRatio: 0.5, nonSkinRegionRatio: 0.7 }
  });

  assert.equal(result.colorType, '黑色/黑灰');
  assert.equal(result.coverageLabel, '大面积');
});

test('calculates six assessment dimensions and caps total at 100', () => {
  const result = core.calculateAssessment({
    type: 'cover',
    colors: ['black', 'red', 'blue', 'green', 'yellow', 'purple'],
    density: 'high',
    cover: 'full',
    skin: 'scar_like',
    location: 'finger'
  });

  assert.equal(result.totalScore, 100);
  assert.equal(result.breakdown.density, 25);
  assert.equal(result.breakdown.cover, 20);
  assert.equal(result.breakdown.color, 15);
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
  assert.ok(report.advantages.some((item) => item.title === '皮肤状态'));
  assert.doesNotMatch(report.suggestion, /保证|几次洗掉|一定/);
});

(function (global) {
    'use strict';

    /* ================================================================
     * 纯像素引擎 - 改进版
     * 无需外部 API，浏览器端 Canvas 分析
     * ================================================================ */

    const colorNames = {
        black: '黑色/黑灰',
        faded_black: '褪色黑灰',
        red: '红色',
        orange: '棕色/橙色',
        yellow: '黄色',
        green: '绿色',
        cyan: '青色',
        blue: '蓝色',
        purple: '紫色',
        magenta: '品红',
        white: '白色'
    };

    // 评分规则与标签从独立文件 tattooRules.js 加载（方便调参，不用改引擎代码）
    const assessmentRules = (window.TattooRules && window.TattooRules.assessmentRules) || {};
    const assessmentLabels = (window.TattooRules && window.TattooRules.assessmentLabels) || {};

    function numberOr(value, fallback) {
        return Number.isFinite(value) ? value : fallback;
    }

    /* ---------- 工具函数 ---------- */

    // RGB → HSV（0-360, 0-1, 0-1）
    function rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const delta = max - min;
        let h = 0;
        if (delta !== 0) {
            if (max === r) h = ((g - b) / delta) % 6;
            else if (max === g) h = (b - r) / delta + 2;
            else h = (r - g) / delta + 4;
        }
        h = Math.round(h * 60);
        if (h < 0) h += 360;
        const s = max === 0 ? 0 : delta / max;
        const v = max;
        return [h, s, v];
    }

    // 灰度亮度（感知加权）
    function luminance(r, g, b) {
        return 0.299 * r + 0.587 * g + 0.114 * b;
    }

    /* ---------- 多肤色范围皮肤检测 ---------- */
    function isSkinPixel(h, s, v) {
        // 排除极端值
        if (v < 0.18 || v > 0.96) return false;
        if (s > 0.62 && v > 0.35) return false; // 高饱和排除

        // 暖色皮肤范围 (亚洲/白种人)
        if (h >= 5 && h <= 46 && s >= 0.03 && s <= 0.58 && v >= 0.22) return true;

        // 深色皮肤范围
        if (h >= 3 && h <= 50 && s >= 0.08 && s <= 0.50 && v >= 0.10 && v <= 0.45) return true;

        // 中性/灰色范围 (非常浅的皮肤)
        if (s <= 0.12 && v >= 0.45 && v <= 0.95) return true;

        return false;
    }

    /* ---------- 像素颜色分类 ---------- */
    function classifyPixelColor(h, s, v) {
        // 黑色/深灰：低亮度 + 低饱和
        if (v < 0.32 && s < 0.35) return 'black';
        if (v < 0.22) return 'black';  // 极暗

        // 暗色但偏色 → 褪色黑灰
        if (v < 0.45 && s < 0.25) return 'faded_black';

        // 彩色识别
        if (s < 0.20) return 'faded_black';  // 低饱和 → 灰调

        // 红色 (0-14 或 345-360)
        if ((h <= 14 || h >= 345) && s > 0.25 && v > 0.10 && v < 0.80)
            return 'red';

        // 橙色/棕色 (14-45)
        if (h > 14 && h <= 45 && s > 0.30 && v > 0.10 && v < 0.80)
            return 'orange';

        // 黄色 (45-70)
        if (h > 45 && h <= 70 && s > 0.30 && v > 0.15 && v < 0.85)
            return 'yellow';

        // 绿色 (70-160)
        if (h > 70 && h <= 160 && s > 0.20 && v > 0.08 && v < 0.82)
            return 'green';

        // 青色 (160-200)
        if (h > 160 && h <= 200 && s > 0.20 && v > 0.08 && v < 0.82)
            return 'cyan';

        // 蓝色 (200-260)
        if (h > 200 && h <= 260 && s > 0.20 && v > 0.08 && v < 0.82)
            return 'blue';

        // 紫色 (260-300)
        if (h > 260 && h <= 300 && s > 0.20 && v > 0.08 && v < 0.80)
            return 'purple';

        // 品红 (300-345)
        if (h > 300 && h < 345 && s > 0.20 && v > 0.08 && v < 0.80)
            return 'magenta';

        // 白色/高亮（高亮+低饱和→可能是疤痕或高光）
        if (v > 0.90 && s < 0.15) return 'white';

        return 'faded_black';
    }

    /* ---------- 像素级分析 ---------- */
    function classifyPixel(input, calibration = {}) {
        const hue = numberOr(input.hue, 0);
        const sat = numberOr(input.sat, 0);
        const val = numberOr(input.val, 0);
        const isSkinPixel = Boolean(input.isSkinPixel);
        const localMeanS = numberOr(input.localMeanS, 0);
        const hasLocalSkinCount = Number.isFinite(input.localSkinCount);
        const localSkinCount = hasLocalSkinCount ? numberOr(input.localSkinCount, 0) : 49;
        const localMeanV = numberOr(input.localMeanV, 0.55);
        const skinMeanV = numberOr(input.skinMeanV, localMeanV);

        // Max pixels in 7x7 local window
        const LOCAL_WINDOW_SIZE = 49;

        // 根据 calibration 调整阈值（必须在任何使用前声明）
        let skinDensityThreshold = 0.50;
        let darknessThreshold = 0.10;
        let scarThresholdVal = 0.90;

        if (calibration.strictMode) {
            skinDensityThreshold = 0.60;
            darknessThreshold = 0.12;
        } else if (calibration.relaxedMode) {
            skinDensityThreshold = 0.35;
            darknessThreshold = 0.06;
        }

        if (calibration.scarWeight && calibration.scarWeight > 0) {
            scarThresholdVal = 0.90 - calibration.scarWeight * 0.03;
        }

        // 跳过皮肤像素（relaxedMode 例外：褪色纹身可能被皮肤检测误标为皮肤）
        if (isSkinPixel) {
            if (calibration.relaxedMode) {
                const darkness = Math.max(localMeanV, skinMeanV) - val;
                const skinDensity = localSkinCount / LOCAL_WINDOW_SIZE;
                // 褪色纹身像素：被误标为皮肤但略暗、低饱和 → 可能是残留墨水
                if (localSkinCount >= 25 && skinDensity >= skinDensityThreshold &&
                    darkness >= darknessThreshold && sat < 0.20) {
                    // 继续往下，按墨水像素分类
                } else if (val > scarThresholdVal && sat < 0.13) {
                    return { isInk: false, isScar: true, color: null };
                } else {
                    return { isInk: false, isScar: false, color: null };
                }
            } else {
                if (val > scarThresholdVal && sat < 0.13) {
                    return { isInk: false, isScar: true, color: null };
                }
                return { isInk: false, isScar: false, color: null };
            }
        }

        // 关键：周围皮肤密度不足 → 衣物/背景边界/皮肤纹理，排除
        // 纹身墨水被皮肤包围（高密度），衣物/纹理仅局部贴皮肤（低密度）
        // 实测：干净皮肤误检像素 avg_lsc≈15(30%)，真纹身边缘 avg_lsc≈35+(70%)
        const skinDensity = localSkinCount / LOCAL_WINDOW_SIZE;

        if (hasLocalSkinCount && (localSkinCount < 25 || skinDensity < skinDensityThreshold)) {
            return { isInk: false, isScar: false, color: null };
        }

        // 关键：必须比周围皮肤显著更深，排除阴影/皮肤纹理/浅色衣物
        // 实测：干净皮肤纹理 darkness≈0.05-0.09，真纹身 ink darkness≈0.15-0.35
        const darkness = Math.max(localMeanV, skinMeanV) - val;
        if (darkness < darknessThreshold) {
            return { isInk: false, isScar: false, color: null };
        }
        if (!hasLocalSkinCount && sat < Math.max(0.50, localMeanS + 0.18)) {
            return { isInk: false, isScar: false, color: null };
        }

        const color = classifyPixelColor(hue, sat, val);

        if (color === 'white') {
            return { isInk: false, isScar: true, color: null };
        }

        // relaxedMode：已通过皮肤密度+暗度检查的像素，即使颜色被归为faded_black也应计入（褪色残留）
        const isInk = calibration.relaxedMode
            ? true
            : (color !== 'faded_black' || (val < 0.35 && sat < 0.18));

        return {
            isInk,
            isScar: false,
            color: isInk ? color : null
        };
    }

    /* ---------- 改进版 summarization ---------- */
    function createSceneWarning(scene) {
        const skinCoverage = numberOr(scene && scene.skinCoverage, 1);
        const edgeBackgroundRatio = numberOr(scene && scene.edgeBackgroundRatio, 0);
        const nonSkinRegionRatio = numberOr(scene && scene.nonSkinRegionRatio, 0);
        const totalSkinPixels = numberOr(scene && scene.totalSkinPixels, 1);
        const inkPixels = numberOr(scene && scene.inkPixels, 0);

        // 场景复杂度判断
        if (skinCoverage < 0.25 && totalSkinPixels < 15000) {
            return '皮肤区域过小，请拍摄近距离、无遮挡的纹身照片';
        }
        if (edgeBackgroundRatio > 0.45 || nonSkinRegionRatio > 0.50) {
            return '背景较复杂，请使用单张、近距离、无遮挡的纹身照片';
        }
        if (skinCoverage < 0.30 && inkPixels < totalSkinPixels * 0.003) {
            return '未检测到明显皮肤区域，请确保照片包含纹身';
        }
        return null;
    }

    function summarizeMetrics(metrics) {
        const totalRoiPixels = Math.max(1, Math.round(numberOr(metrics.totalRoiPixels, 1)));
        const inkPixels = Math.max(0, Math.round(numberOr(metrics.inkPixels, 0)));
        const dominantInkPixels = Math.max(0, Math.round(numberOr(metrics.dominantInkPixels, 0)));
        const scarPixels = Math.max(0, Math.round(numberOr(metrics.scarPixels, 0)));
        const scarEvidence = numberOr(metrics.scarEvidence, 0);

        const inkCoverage = inkPixels / totalRoiPixels;
        const dominantCoverage = dominantInkPixels / totalRoiPixels;
        const inkFootprintCoverage = Math.max(0, numberOr(metrics.inkFootprintCoverage, dominantCoverage));

        const sceneWarning = createSceneWarning(metrics.scene || {});

        // 稳定性判断：至少有足够数量的墨水像素
        const minInkPixels = Math.max(120, totalRoiPixels * 0.001);
        const stableInk = inkPixels >= minInkPixels && inkCoverage >= 0.01;

        // 颜色统计 - 使用加权计数
        const colorCounts = metrics.colorCounts || {};
        const totalColorPixels = Object.values(colorCounts).reduce((a, b) => a + b, 0) || 1;

        // 构建颜色排名
        const sortedColors = Object.entries(colorCounts)
            .map(([color, count]) => ({ color, count, ratio: count / totalColorPixels }))
            .sort((a, b) => b.count - a.count);

        // 主色：占比最高的颜色
        const dominantColor = sortedColors[0] || null;
        const dominantRatio = dominantColor ? dominantColor.ratio : 0;

        // 判断是否多色（第二颜色占比 > 15%）
        const isMultiColor = sortedColors.length >= 2 && sortedColors[1].ratio >= 0.15;

        // 颜色类型描述
        let colorType = '未检测到明显纹身色素';
        const selectedColors = [];

        if (stableInk && sortedColors.length > 0) {
            // 取主要颜色（占比 > 12%）
            for (const c of sortedColors) {
                if (c.ratio >= 0.12 && selectedColors.length < 3) {
                    selectedColors.push(colorNames[c.color] || c.color);
                }
            }
            if (selectedColors.length === 0 && sortedColors[0].ratio >= 0.05) {
                selectedColors.push(colorNames[sortedColors[0].color] || sortedColors[0].color);
            }
            colorType = selectedColors.length > 0 ? selectedColors.join(' + ') : colorType;
        }

        // 覆盖面积标签
        let coverageLabel = '几乎无';
        if (stableInk) {
            const footprint = Math.max(inkCoverage, inkFootprintCoverage);
            if (footprint < 0.05) coverageLabel = '小面积';
            else if (footprint < 0.12) coverageLabel = '中等面积';
            else if (footprint < 0.22) coverageLabel = '较大面积';
            else coverageLabel = '大面积';
        }

        // 不确定场景
        const uncertainScene = Boolean(sceneWarning) && (!stableInk || dominantCoverage < 0.01);
        if (uncertainScene) {
            colorType = '未检测到稳定纹身色素';
            coverageLabel = '照片复杂，无法判断';
        }

        // 皮肤状态（疤痕检测）
        const scarRatio = scarPixels / totalRoiPixels;
        let skinCondition = '未见明显异常（照片无法完全判断）';
        if (scarEvidence >= 0.4 && scarRatio >= 0.008) {
            skinCondition = '疑似疤痕/色差';
        } else if (scarEvidence >= 0.6 && scarRatio >= 0.004) {
            skinCondition = '疑似疤痕/色差';
        }

        // 难度修正
        let difficultyMod = 0;
        if (stableInk) {
            // 颜色难度
            const redRatio = (colorCounts.red || 0) / totalColorPixels;
            const greenRatio = (colorCounts.green || 0) / totalColorPixels;
            const yellowRatio = (colorCounts.yellow || 0) / totalColorPixels;
            const blueRatio = (colorCounts.blue || 0) / totalColorPixels;
            const purpleRatio = (colorCounts.purple || 0) / totalColorPixels;
            const magentaRatio = (colorCounts.magenta || 0) / totalColorPixels;

            if (yellowRatio >= 0.08 || greenRatio >= 0.08) difficultyMod += 8;
            if (blueRatio >= 0.08) difficultyMod += 3;
            if (redRatio >= 0.08) difficultyMod += 2;
            if (purpleRatio >= 0.08 || magentaRatio >= 0.08) difficultyMod += 4;
            if (isMultiColor) difficultyMod += 5;

            // 覆盖面积难度
            if (inkCoverage > 0.25) difficultyMod += 3;
            else if (inkCoverage > 0.15) difficultyMod += 2;
            else if (inkCoverage > 0.08) difficultyMod += 1;

            // 密度难度（基于平均亮度）
            const avgBrightness = numberOr(metrics.avgBrightness, 0.55);
            if (avgBrightness < 0.20) difficultyMod += 3;
            else if (avgBrightness < 0.30) difficultyMod += 2;
            else if (avgBrightness < 0.40) difficultyMod += 1;
        }
        if (scarRatio >= 0.02) difficultyMod += 2;

        // 置信度
        const confidence = sceneWarning ? 'low' : (stableInk || inkCoverage < 0.003 ? 'high' : 'medium');

        // 密度标签
        const avgBrightness = numberOr(metrics.avgBrightness, 0.55);
        const densityLabel = stableInk
            ? (avgBrightness < 0.18 ? '色素很深'
                : avgBrightness < 0.28 ? '色素较深'
                : avgBrightness < 0.45 ? '色素适中'
                : avgBrightness < 0.60 ? '色素较浅'
                : '色素已基本清除')
            : '色素适中';

        return {
            colorType,
            coverageLabel,
            skinCondition,
            difficultyMod: Math.min(20, Math.max(0, difficultyMod)),
            confidence,
            sceneWarning,
            inkCoverage,
            dominantCoverage,
            inkFootprintCoverage,
            redCoverage: (colorCounts.red || 0) / totalColorPixels,
            scarEvidence,
            densityLabel,
            isMultiColor,
            inkCoveragePct: Math.min(100, Math.round(inkCoverage * 100)),
            colors: sortedColors.slice(0, 3).map(c => c.color)
        };
    }

    /* ---------- 其他保持兼容 ---------- */
    function summarizeSelections(steps, answers) {
        return (steps || []).map((step, stepIndex) => {
            const selected = Array.isArray(answers && answers[stepIndex]) ? answers[stepIndex] : [];
            const items = selected
                .map(optionIndex => step.options && step.options[optionIndex])
                .filter(Boolean)
                .map(option => option.text)
                .filter(Boolean);
            if (items.length === 0) return null;
            return {
                key: step.key || (stepIndex === steps.length - 1 ? 'conditions' : `step-${stepIndex}`),
                title: step.title,
                items
            };
        }).filter(Boolean);
    }

    function buildCombinedInsight(selectionSummary, photoAnalysis) {
        const conditionGroup = (selectionSummary || []).find(group => group.key === 'conditions' || group.key === 'skin');
        const hasConditionConcern = Boolean(conditionGroup && conditionGroup.items.some(item => {
            return !/以上都没有|没有|无|none|平整/i.test(String(item));
        }));
        let text = photoAnalysis
            ? '已结合照片和你填写的信息进行初步判断。'
            : '以下内容来自你填写的信息，建议补充清晰的纹身照片。';
        if (hasConditionConcern && photoAnalysis) {
            text += '你勾选了皮肤状态相关情况，即使照片看起来正常，建议师傅重点复核。';
        }
        return { hasConditionConcern, text };
    }

    function getDifficultyLevel(score) {
        const totalScore = Math.max(0, Math.min(100, Number(score) || 0));
        if (totalScore <= 25) return { level: 1, label: '一级', title: '相对简单', range: '0-25' };
        if (totalScore <= 50) return { level: 2, label: '二级', title: '普通类型', range: '26-50' };
        if (totalScore <= 75) return { level: 3, label: '三级', title: '复杂处理型', range: '51-75' };
        return { level: 4, label: '四级', title: '高复杂案例', range: '76-100' };
    }

    function calculateAssessment(input = {}) {
        const colors = Array.isArray(input.colors) ? input.colors : [];
        const colorScore = colors.reduce((sum, color) => sum + (assessmentRules.color[color] || 0), 0)
            + (colors.length >= 2 ? 5 : 0);
        const breakdown = {
            type: assessmentRules.type[input.type] || 0,
            color: Math.min(15, colorScore),
            status: assessmentRules.status[input.status] || 0,
            saturation: assessmentRules.saturation[input.saturation] || 0,
            skin: assessmentRules.skin[input.skin] || 0,
            location: assessmentRules.location[input.location] || 0
        };
        const rawScore = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
        const totalScore = Math.min(100, rawScore);
        return { breakdown, totalScore, level: getDifficultyLevel(totalScore) };
    }

    function generateReport(input = {}) {
        const assessment = calculateAssessment(input);
        const colors = Array.isArray(input.colors) ? input.colors : [];
        const tags = [
            assessmentLabels.type[input.type],
            ...colors.map(color => assessmentLabels.color[color]),
            assessmentLabels.status[input.status],
            assessmentLabels.saturation[input.saturation],
            assessmentLabels.skin[input.skin],
            assessmentLabels.location[input.location]
        ].filter(Boolean).map(label => '#' + label);

        const riskFactors = [];
        if (input.saturation === 'deep' || input.saturation === 'high_sat') {
            riskFactors.push({ title: '色料饱和度', text: '高饱和色料需要更谨慎地分层评估，通常不适合用单次结果判断整体方案。' });
        }
        if (input.status === 'covered' || input.status === 'modified' || input.type === 'cover') {
            riskFactors.push({ title: '覆盖/修改历史', text: '覆盖或修改纹身可能存在多层色料，建议由师傅面诊确认底层颜色和层次。' });
        }
        if (input.status === 'washed') {
            riskFactors.push({ title: '已洗过纹身', text: '已做过清洗处理，色料可能不均匀残留，需要分层评估剩余色料分布。' });
        }
        if (colors.some(color => ['red', 'green', 'yellow', 'purple', 'blue', 'orange'].includes(color))) {
            riskFactors.push({ title: '彩色色料', text: '彩色色料对设备参数和恢复节奏更敏感，需要结合肤质制定个性化方案。' });
        }
        if (input.skin === 'raised' || input.skin === 'scar_like') {
            riskFactors.push({ title: '皮肤状态', text: '凸起或疑似疤痕区域需要先评估皮肤承受度，再判断是否适合继续处理。' });
        }
        if (input.location === 'hand' || input.location === 'foot' || input.location === 'joint' || input.location === 'neck') {
            riskFactors.push({ title: '恢复位置', text: '该位置血液循环或摩擦情况特殊，恢复过程需要更细致的观察和护理。' });
        }

        const advantages = [];
        if (input.status === 'original') {
            advantages.push({ title: '原始纹身', text: '没有覆盖或修改历史，色料层次通常更容易被清晰判断。' });
        }
        if (input.saturation === 'light') {
            advantages.push({ title: '浅色纹身', text: '色料较浅时，初步方案通常更容易循序推进，所需次数较少。' });
        }
        if (input.skin === 'flat') {
            advantages.push({ title: '皮肤状态良好', text: '皮肤平整有利于判断颜色边界和恢复反应。' });
        }
        if (colors.length > 0 && colors.every(color => color === 'black' || color === 'gray')) {
            advantages.push({ title: '颜色结构简单', text: '黑灰类色料的评估路径相对清晰，处理参数成熟。' });
        }
        if (input.location === 'arm' || input.location === 'leg') {
            advantages.push({ title: '四肢部位', text: '手臂和腿部血液循环好，恢复较快，护理也相对方便。' });
        }
        if (input.type === 'minimal' || input.type === 'line' || input.type === 'lettering') {
            advantages.push({ title: '简单风格', text: '线条类或小清新风格纹身通常面积小、色料集中，评估难度较低。' });
        }

        const suggestion = assessment.level.title + '。建议先上传清晰近照，由栩刺青专业师傅结合颜色、饱和度、纹身状态、皮肤条件和位置进行人工复核，再制定循序渐进的处理方案。';

        return Object.assign({}, assessment, {
            title: assessment.level.title,
            tags,
            riskFactors,
            advantages,
            suggestion
        });
    }

    /* ---------- 问卷校准 ---------- */
    function getRecommendedThresholds(questionnaire) {
        const q = questionnaire || {};
        const calibration = {};

        // strictMode: 从未治疗 + 纯黑
        if (q.treatments === 'never' && q.inkColor === 'black') {
            calibration.strictMode = true;
        }

        // relaxedMode: 已治疗过(1-3次/4+次) → 色素可能已淡化，降低检测门槛
        // 有疤痕 → 皮肤纹理变化影响局部皮肤密度判断，亦需放宽
        if (q.treatments === '1-3' || q.treatments === '4_plus' || q.hasScar === 'yes') {
            calibration.relaxedMode = true;
        }

        // scarWeight: 有疤痕 → 敏感度 0.7
        if (q.hasScar === 'yes') {
            calibration.scarWeight = 0.7;
        }

        return calibration;
    }

    /* ---------- 交叉验证 ---------- */
    function crossValidate(analysisResult, questionnaire) {
        const result = Object.assign({}, analysisResult);
        const q = questionnaire || {};
        const hasQuestionnaire = !!(q.duration || q.treatments || q.hasScar || q.inkColor);

        if (!hasQuestionnaire) {
            result.crossCheckNote = '未填写问卷，仅基于图片分析';
            result.needFollowUp = (result.confidence === 'low');
            result.followUpQuestion = result.needFollowUp ? '这张照片光线不太好，请问您之前洗过这个纹身吗？' : '';
            return result;
        }

        // 交叉验证逻辑
        const hasDeepInk = result.densityLabel === '色素很深' || result.densityLabel === '色素较深';
        const hasNoInk = result.colorType && result.colorType.includes('未检测到');
        const hasSignificantInk = result.inkCoveragePct >= 5 || result.coverageLabel === '中等面积' || result.coverageLabel === '较大面积' || result.coverageLabel === '大面积';

        // 1. 从未治疗 + 图片大量深色 → high
        if (q.treatments === 'never' && hasDeepInk) {
            result.confidence = 'high';
            result.crossCheckNote = '问卷与图片分析一致：从未治疗，图片显示色素较深，评估可靠';
            result.needFollowUp = false;
            result.followUpQuestion = '';
        }
        // 2. 已治疗过(1-3次或4+) + 图片少量/未检出 → high（符合治疗后预期）
        else if ((q.treatments === '1-3' || q.treatments === '4_plus') && (result.inkCoveragePct < 15 || result.coverageLabel === '小面积' || hasNoInk)) {
            result.confidence = 'high';
            result.crossCheckNote = '问卷与图片分析一致：已治疗过，图片显示色素已淡化或仅残留少量';
            result.needFollowUp = false;
            result.followUpQuestion = '';
        }
        // 3. 从未治疗 + 图片未检出 → medium
        else if (q.treatments === 'never' && hasNoInk) {
            result.confidence = 'medium';
            result.crossCheckNote = '问卷显示从未治疗，但图片未检出明显色素，可能受光线/角度影响';
            result.needFollowUp = true;
            result.followUpQuestion = '照片中未能清晰识别纹身，请问您之前洗过这个纹身吗？';
        }
        // 4. 问卷显示简单案件 + 图片检出大量 → low
        else if (q.treatments === 'never' && q.inkColor === 'black' && q.hasScar !== 'yes' && hasSignificantInk) {
            result.confidence = 'high';
            result.crossCheckNote = '问卷与图片分析一致：纯黑纹身，从未治疗，色素明显';
            result.needFollowUp = false;
            result.followUpQuestion = '';
        }
        // 5. 有问卷但无特殊匹配 → 保持原置信度，但在备注中说明
        else {
            // 默认：如果图片分析本身置信度不高且有问卷补充，提升到 medium
            if (result.confidence === 'low' && hasQuestionnaire) {
                result.confidence = 'medium';
            }
            result.crossCheckNote = '已结合你填写的问卷信息与图片分析结果';
            result.needFollowUp = (result.confidence === 'low');
            result.followUpQuestion = result.needFollowUp ? '这张照片光线不太好，请问您之前洗过这个纹身吗？' : '';
        }

        return result;
    }

    /* ---------- 导出 ---------- */
    global.TattooAnalysisCore = {
        classifyPixel,
        summarizeMetrics,
        createSceneWarning,
        summarizeSelections,
        buildCombinedInsight,
        assessmentRules,
        getDifficultyLevel,
        calculateAssessment,
        generateReport,
        crossValidate,
        getRecommendedThresholds
    };
})(typeof window !== 'undefined' ? window : globalThis);

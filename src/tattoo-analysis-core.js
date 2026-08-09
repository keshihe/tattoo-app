(function (global) {
    'use strict';

    const GEMINI_MODEL = 'gemini-2.0-flash';
    const GEMINI_TIMEOUT_MS = 8000;
    const GEMINI_ENDPOINT_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
        magenta: '品红'
    };

    function numberOr(value, fallback) {
        return Number.isFinite(value) ? value : fallback;
    }

    function classifyPixel(input) {
        const hue = numberOr(input.hue, 0);
        const sat = numberOr(input.sat, 0);
        const val = numberOr(input.val, 0);
        const skinMeanV = numberOr(input.skinMeanV, 0.55);
        const localMeanV = numberOr(input.localMeanV, skinMeanV);
        const localMeanS = numberOr(input.localMeanS, sat);
        const localSkinCount = numberOr(input.localSkinCount, 1);
        const wideMeanV = numberOr(input.wideMeanV, skinMeanV);
        const localDarkness = localMeanV - val;
        const wideDarkness = wideMeanV - val;
        const localColorContrast = sat - localMeanS;
        const isSkinPixel = Boolean(input.isSkinPixel);
        const hasLocalSkin = localSkinCount > 0;
        const isHighlight = (val > 0.91 && sat < 0.1) ||
            (val > skinMeanV + 0.14 && sat < 0.12);

        if (isHighlight && Boolean(input.isSkinPixel)) {
            return { isInk: false, isScar: true, color: null };
        }

        const isDarkInk = !isSkinPixel && hasLocalSkin && ((val < 0.36 &&
            wideDarkness > 0.12 && localDarkness > 0.1) ||
            (val < 0.44 && sat < 0.22 && wideDarkness > 0.14 && localDarkness > 0.1));
        const isRed = !isSkinPixel && hasLocalSkin && ((hue < 14 && hue >= 0) || hue >= 350) &&
            sat > 0.35 && localColorContrast > 0.08 && val < 0.72;
        const isOrange = !isSkinPixel && hasLocalSkin && hue >= 14 && hue < 45 &&
            sat > 0.46 && localColorContrast > 0.14 && val < 0.72;
        const isChromatic = !isSkinPixel && hasLocalSkin && sat > 0.46 &&
            localColorContrast > 0.16 && val > 0.1 && val < 0.8;

        if (!isDarkInk && !isRed && !isOrange && !isChromatic) {
            return { isInk: false, isScar: false, color: null };
        }

        let color = 'faded_black';
        if (isRed) color = 'red';
        else if (isOrange) color = 'orange';
        else if (isChromatic && hue >= 45 && hue < 75) color = 'yellow';
        else if (isChromatic && hue >= 75 && hue < 155) color = 'green';
        else if (isChromatic && hue >= 155 && hue < 195) color = 'cyan';
        else if (isChromatic && hue >= 195 && hue < 255) color = 'blue';
        else if (isChromatic && hue >= 255 && hue < 310) color = 'purple';
        else if (isChromatic && hue >= 310 && hue < 350) color = 'magenta';
        else if (val < 0.36 || sat < 0.3) color = 'black';

        return { isInk: true, isScar: false, color };
    }

    function createSceneWarning(scene) {
        const skinCoverage = numberOr(scene && scene.skinCoverage, 1);
        const edgeBackgroundRatio = numberOr(scene && scene.edgeBackgroundRatio, 0);
        const nonSkinRegionRatio = numberOr(scene && scene.nonSkinRegionRatio, 0);

        if (skinCoverage < 0.35 || edgeBackgroundRatio > 0.45 || nonSkinRegionRatio > 0.65) {
            return '背景较复杂，请使用单张、近距离、无遮挡的纹身照片';
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
        const dominantRatio = inkPixels > 0 ? dominantInkPixels / inkPixels : 0;
        const sceneWarning = createSceneWarning(metrics.scene);
        const stableInk = dominantInkPixels >= Math.max(30, totalRoiPixels * 0.0015) &&
            (inkCoverage >= 0.006 || dominantCoverage >= 0.004) &&
            dominantRatio >= 0.18;
        const redPixels = numberOr(metrics.colorCounts && metrics.colorCounts.red, 0);
        const redRatio = inkPixels > 0 ? redPixels / inkPixels : 0;
        const stableRed = stableInk && redPixels >= Math.max(80, totalRoiPixels * 0.003) && redRatio >= 0.12;

        let colorType = '未检测到明显纹身色素';
        const selectedColors = [];
        if (stableInk) {
            const sortedColors = Object.entries(metrics.colorCounts || {})
                .sort((a, b) => b[1] - a[1]);
            for (const [color, count] of sortedColors) {
                const ratio = inkPixels > 0 ? count / inkPixels : 0;
                const minimumRatio = color === 'red' ? 0.12 : color === 'orange' ? 0.18 : 0.14;
                if (ratio >= minimumRatio && (color !== 'red' || stableRed)) {
                    selectedColors.push(colorNames[color] || color);
                }
                if (selectedColors.length === 2) break;
            }
            if (selectedColors.length === 0) {
                const firstColor = Object.entries(metrics.colorCounts || {})
                    .sort((a, b) => b[1] - a[1])[0];
                if (firstColor) selectedColors.push(colorNames[firstColor[0]] || firstColor[0]);
            }
            colorType = selectedColors.length > 0 ? selectedColors.join(' + ') : colorType;
            if (selectedColors.some(color => color.includes('黑')) && stableRed && redRatio >= 0.25) {
                colorType = '黑灰 + 红色残留';
            }
        }

        let coverageLabel = '几乎无';
        if (stableInk) {
            if (inkCoverage < 0.06 && inkFootprintCoverage < 0.08) coverageLabel = '小面积';
            else if (inkCoverage < 0.14 && inkFootprintCoverage < 0.18) coverageLabel = '中等面积';
            else if (inkCoverage < 0.24 && inkFootprintCoverage < 0.35) coverageLabel = '较大面积';
            else coverageLabel = '大面积';
        }

        const uncertainScene = !stableInk && Boolean(sceneWarning) && dominantCoverage < 0.015 && redRatio < 0.2;
        if (uncertainScene) {
            colorType = '未检测到稳定纹身色素';
            coverageLabel = '照片复杂，无法判断';
        }

        const skinCondition = scarEvidence >= 0.5 && scarPixels / totalRoiPixels >= 0.015
            ? '疑似疤痕/色差'
            : '未见明显异常（照片无法完全判断）';

        const significantColorCount = selectedColors.length;
        let difficultyMod = 0;
        const averageBrightness = numberOr(metrics.avgBrightness, 0.5);
        if (stableInk) {
            if (['yellow', 'green'].some(color => numberOr(metrics.colorCounts && metrics.colorCounts[color], 0) / inkPixels >= 0.08)) difficultyMod += 8;
            if (numberOr(metrics.colorCounts && metrics.colorCounts.blue, 0) / inkPixels >= 0.08) difficultyMod += 3;
            if (stableRed && redRatio >= 0.08) difficultyMod += 2;
            if (['purple', 'magenta'].some(color => numberOr(metrics.colorCounts && metrics.colorCounts[color], 0) / inkPixels >= 0.08)) difficultyMod += 4;
            if (significantColorCount > 1) difficultyMod += 5;
            if (averageBrightness < 0.22) difficultyMod += 3;
            if (inkCoverage > 0.3) difficultyMod += 3;
        }
        if (scarEvidence >= 0.68 && scarPixels / totalRoiPixels >= 0.03) difficultyMod += 2;

        const confidence = sceneWarning ? 'low' : stableInk || inkCoverage < 0.006 ? 'high' : 'medium';
        return {
            colorType,
            coverageLabel,
            skinCondition,
            difficultyMod,
            confidence,
            sceneWarning,
            inkCoverage,
            dominantCoverage,
            inkFootprintCoverage,
            redCoverage: redRatio,
            scarEvidence
        };
    }

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
        const conditionGroup = (selectionSummary || []).find(group => group.key === 'conditions');
        const hasConditionConcern = Boolean(conditionGroup && conditionGroup.items.some(item => {
            return !/以上都没有|没有|无|none/i.test(String(item));
        }));
        let text = photoAnalysis
            ? '已结合照片和你填写的信息进行初步判断。'
            : '以下内容来自你填写的信息，建议补充清晰的纹身照片。';
        if (hasConditionConcern && photoAnalysis) {
            text += '你勾选了皮肤状态相关情况，即使照片看起来正常，也建议师傅重点复核。';
        }
        return { hasConditionConcern, text };
    }

    const GEMINI_ANALYSIS_PROMPT = `You are a professional tattoo removal specialist analyzing a tattoo photo. Examine the image carefully and return ONLY a JSON object (no markdown, no explanation) with these fields:

{
  "colors": ["black", "red", "blue", ...],  // list of detected ink colors from: black, dark_blue, red, orange, yellow, green, cyan, blue, purple, magenta, white. Use "black" for all dark/black/grey ink. Always include at least one color.
  "colorType": "黑色 + 红色",  // Chinese display string for main colors, e.g. "黑色/黑灰", "黑灰 + 红色残留", "彩色(蓝+绿)"
  "coverageLabel": "小面积",  // one of: "几乎无", "小面积", "中等面积", "较大面积", "大面积"
  "coveragePercent": 12,  // estimated percentage of skin area covered by tattoo ink (0-100)
  "densityLabel": "色素适中",  // one of: "色素已基本清除", "色素较浅", "色素适中", "色素较深", "色素很深"
  "skinCondition": "未见明显异常",  // describe any scarring, discoloration, or skin damage visible
  "hasScarring": false,  // true if scars or skin texture changes are visible
  "difficultyMod": 5,  // estimated removal difficulty bonus 0-20, higher = harder. Consider: colors (multi-color +5, yellow/green +8, red +2, blue +3, purple +4), coverage (>30% +3), density (dark +3), scarring (+2)
  "sceneWarning": null,  // null if photo is good quality close-up of a single tattoo. String warning if photo has distracting background, multiple tattoos, too far away, or poor lighting.
  "confidence": "high",  // "high" if photo is clear and analysis reliable, "medium" if somewhat ambiguous, "low" if photo quality is poor
  "isMultiColor": false  // true if more than one distinct ink color detected
}

Rules:
- Be conservative: if uncertain about a color, don't include it.
- For coverage, consider the tattoo's size relative to the visible skin area in the photo.
- If the photo background is cluttered or contains non-tattoo elements, set sceneWarning.
- densityLabel should reflect how saturated/dark the ink appears.
- difficultyMod should be based on standard tattoo removal knowledge (colors, size, density, scarring).`;

    async function analyzeWithGemini(imageDataUrl, apiKey) {
        const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

        try {
            const response = await fetch(`${GEMINI_ENDPOINT_BASE}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: GEMINI_ANALYSIS_PROMPT },
                            { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 500
                    }
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Gemini API error: ${response.status}`);
            }

            const data = await response.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error('Empty Gemini response');

            // Extract JSON from response (handle markdown code blocks)
            let jsonStr = text.trim();
            const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch) jsonStr = jsonMatch[1];
            else {
                const bracketMatch = jsonStr.match(/\{[\s\S]*\}/);
                if (bracketMatch) jsonStr = bracketMatch[0];
            }

            const result = JSON.parse(jsonStr);

            // Validate and normalize
            const validCoverageLabels = ['几乎无', '小面积', '中等面积', '较大面积', '大面积'];
            const validDensityLabels = ['色素已基本清除', '色素较浅', '色素适中', '色素较深', '色素很深'];

            return {
                colorType: String(result.colorType || '未检测到明显纹身色素'),
                coverageLabel: validCoverageLabels.includes(result.coverageLabel) ? result.coverageLabel : '小面积',
                skinCondition: String(result.skinCondition || '未见明显异常'),
                difficultyMod: Math.min(20, Math.max(0, Number.isFinite(result.difficultyMod) ? Math.round(result.difficultyMod) : 0)),
                confidence: ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'medium',
                sceneWarning: result.sceneWarning || null,
                densityLabel: validDensityLabels.includes(result.densityLabel) ? result.densityLabel : '色素适中',
                isMultiColor: Boolean(result.isMultiColor),
                inkCoveragePct: Math.min(100, Math.max(0, Number.isFinite(result.coveragePercent) ? Math.round(result.coveragePercent) : 0)),
                colors: Array.isArray(result.colors) ? result.colors : [],
                hasScarring: Boolean(result.hasScarring)
            };
        } catch (err) {
            clearTimeout(timeoutId);
            console.warn('Gemini analysis failed, falling back to rule engine:', err.message);
            return null;
        }
    }

    global.TattooAnalysisCore = {
        classifyPixel,
        summarizeMetrics,
        createSceneWarning,
        summarizeSelections,
        buildCombinedInsight,
        analyzeWithGemini
    };
})(typeof window !== 'undefined' ? window : globalThis);

/* ================================================================
 * 纹身评估评分规则表 (tattooRules.js) V2
 * ---------------------------------------------------------------
 * 评分说明：
 *   总分 = 6 个维度分数相加，满分 100，越高 = 越难处理。
 *   难度等级：0-25 一级(简单) / 26-50 二级(普通) / 51-75 三级(复杂) / 76-100 四级(高复杂)
 *
 * 各维度满分参考：
 *   纹身状态 status   最高 25 分（权重最大，覆盖/修改/洗过最影响难度）
 *   饱和度 saturation  最高 22 分
 *   纹身类型 type      最高 18 分
 *   颜色 color         最高 15 分（多选累加，封顶）
 *   皮肤状态 skin      最高 15 分
 *   位置 location      最高 5 分（权重最小）
 * ================================================================ */

window.TattooRules = {

    assessmentRules: {
        // 纹身类型（满分 18）
        type: {
            black_gray: 5,
            traditional: 12,
            new_traditional: 11,
            japanese: 15,
            line: 3,
            lettering: 4,
            geometric: 6,
            dotwork: 7,
            watercolor: 14,
            minimal: 2,
            cover: 18,
            retouch: 16,
            other: 10
        },
        // 颜色（多选累加，总分封顶 15；选 2 种以上额外 +5）
        color: {
            black: 0,
            gray: 0,
            red: 3,
            orange: 4,
            yellow: 10,
            green: 8,
            blue: 5,
            purple: 7,
            pink: 2,
            white: 5,
            skin_tone: 4,
            multi_mix: 8,
            unsure: 3
        },
        // 纹身状态（满分 25，权重最大）
        status: {
            original: 3,
            deepened: 15,
            covered: 25,
            modified: 18,
            washed: 20
        },
        // 饱和度（满分 22）
        saturation: {
            light: 3,
            normal: 10,
            deep: 18,
            high_sat: 22
        },
        // 皮肤状态（满分 15）
        skin: {
            flat: 0,
            raised: 7,
            scar_like: 15
        },
        // 位置（满分 5，权重最小）
        location: {
            arm: 1,
            leg: 2,
            torso: 2,
            back: 2,
            neck: 4,
            hand: 5,
            foot: 5,
            joint: 5,
            other_loc: 3
        }
    },

    assessmentLabels: {
        type: {
            black_gray: '黑灰写实',
            traditional: '欧美传统',
            new_traditional: '新传统',
            japanese: '日式传统',
            line: '线条纹身',
            lettering: '花体文字',
            geometric: '几何图案',
            dotwork: '点刺风格',
            watercolor: '水彩风格',
            minimal: '小清新',
            cover: '遮盖纹身',
            retouch: '修改补色',
            other: '其他类型'
        },
        color: {
            black: '黑色',
            gray: '灰色',
            red: '红色',
            orange: '橙色',
            yellow: '黄色',
            green: '绿色',
            blue: '蓝色',
            purple: '紫色',
            pink: '粉色',
            white: '白色',
            skin_tone: '肤色肉色',
            multi_mix: '多色混合',
            unsure: '颜色待确认'
        },
        status: {
            original: '原始纹身',
            deepened: '加深处理',
            covered: '覆盖旧纹身',
            modified: '修改过',
            washed: '已洗过'
        },
        saturation: {
            light: '浅色',
            normal: '正常',
            deep: '深色',
            high_sat: '高饱和填色'
        },
        skin: {
            flat: '皮肤平整',
            raised: '轻微凸起',
            scar_like: '明显凸起/疤痕感'
        },
        location: {
            arm: '手臂',
            leg: '腿部',
            torso: '胸腹部',
            back: '后背',
            neck: '脖子',
            hand: '手部',
            foot: '脚部',
            joint: '关节位置',
            other_loc: '其他位置'
        }
    }

};

import { after } from 'next/server';
import {
  generatePlacementPlanWithGemini,
  generateImageWithGemini,
  getBase64FromUrlOrData,
  saveGeneratedImageToSaas,
  type SaasInfo,
  verifyBeforeGenerate,
} from '../../../api/_shared';

export const runtime = 'nodejs';
export const maxDuration = 120;

function scheduleSaasSave({
  userId,
  toolId,
  saasInfo,
  generatedBase64,
  mimeType,
}: {
  userId: string;
  toolId: string;
  saasInfo?: SaasInfo;
  generatedBase64: string;
  mimeType: string;
}) {
  const saveTask = async () => {
    try {
      const saved = await saveGeneratedImageToSaas({
        userId,
        toolId,
        generatedBase64,
        mimeType,
        saasInfo,
      });
      console.info('SaaS background save success:', {
        recordId: saved.recordId,
        url: saved.url,
      });
    } catch (err: any) {
      console.error('SaaS background save failed:', {
        saveStep: err.saveStep,
        message: err.message,
      });
    }
  };

  try {
    after(saveTask);
  } catch (err: any) {
    console.error('Failed to schedule SaaS background save, running best-effort fallback:', err.message || err);
    void saveTask();
  }
}

function buildPrompt({
  angle,
  height,
  lighting,
  customPrompt,
  placementHint,
  shotName,
  cameraSpec,
  placementPlan,
}: {
  angle: string;
  height: string;
  lighting: string;
  customPrompt: string;
  placementHint: string;
  shotName: string;
  cameraSpec: string;
  placementPlan: string;
}) {
  return `
你是一位极其严谨的专业家居电商摄影师和空间合成专家。
你的任务是把【产品参考图】中的沙发本体，无缝融入【房间参考图】的真实空间，并生成单张照片级电商图片。

【参考图角色隔离】
1. 【房间参考图】是唯一的房间结构、墙面、窗户、门洞、电视墙/媒体墙、固定柜体、地面、吊顶和光线来源。
2. 【产品参考图】只允许用于提取沙发本体：款式、轮廓、比例、材质、颜色、纹理和细节。
3. 忽略【产品参考图】里的所有背景空间和其他物体，最终画面必须一眼看出仍然是【房间参考图】里的房间。

【产品还原】
1. 保留沙发本体的款式、轮廓、座位数量、扶手/靠背结构、坐垫厚度、缝线、褶皱、腿部结构、材质纹理和原本颜色。
2. 不要擅自改款、增减模块、改变比例，或把产品图背景带入最终图。

【房间构造】
1. 锁定房间参考图中的墙体关系、窗户/窗帘、门洞、电视墙/媒体墙、固定柜体、吊顶/梁、地面透视、墙角、光线方向和整体空间比例。
2. 不要重建、翻转、旋转或重新装修房间；不要移动电视墙、窗户、门洞、固定柜体和墙体开口。
3. 可移动家具可以被商品沙发合理替换或轻微调整，但不可移动建筑结构必须保持不变。

【当前生成设置】
- 景别类型: ${shotName}
- 摄影机参数: ${cameraSpec}
- 生成视角: ${angle}
- 镜头高度: ${height}
- 环境光线: ${lighting}
- 落位参考: ${placementHint}
${customPrompt ? `- 附加描述: ${customPrompt}` : ''}

【本次房间落位方案 - 必须优先执行】
${placementPlan}

【执行顺序 - 不可跳过】
1. 先读取并执行“唯一锁定落点”：沙发中心区域、底部接触地面、主坐面朝向和禁入边界都以该方案为准。
2. 再选择当前景别对应的相机机位：${shotName}。只允许移动相机、改变焦段、机位高度、景深和裁切。
3. 最后融合产品沙发本体。不要为了画面居中、商品正面角度、近景放大或构图美观，把沙发重新放到窗前、房间中央、门洞、通道、电视所在墙同侧、电视下方、电视旁边贴墙区或固定柜体前。
4. 如果窗前是主要采光面或落地窗/窗帘区域，窗前空地不是默认沙发区；除非落位方案明确允许，否则必须保留采光和通行。
5. 如果房间有电视/媒体墙，沙发必须落在电视对侧或斜对侧的观看区，主坐面朝向电视/媒体墙；禁止把沙发放在电视所在墙、电视下方或与电视同侧贴墙。
6. 如果电视/媒体墙在画面左侧墙，沙发应优先落在画面右半部或右下/下方开阔地并朝左；如果电视/媒体墙在画面右侧墙，沙发应优先落在画面左半部或左下/下方开阔地并朝右；如果电视/媒体墙在后墙，沙发应优先落在画面下方前景可用地面并朝后墙。

【当前景别强制规则】
- 远景：沙发仍在唯一锁定落点，相机后退，展示完整房间结构；沙发占比小，不能把沙发移动到窗前或画面中心来凑全景。
- 中景：沙发仍在唯一锁定落点，相机靠近到电商主图距离；能看到底部接触线、地面透视和一部分真实背景。
- 近景：沙发仍在唯一锁定落点，相机靠近拍扶手/坐垫/靠背/缝线/材质，可以自然裁切局部；不能把完整沙发整体巨大化，也不能重新选择窗前、通道或房间中央作为背景。

【景别与机位】
1. 远景/中景/近景共用同一个物理落位；差异来自摄影机，而不是沙发换位置或换大小贴图。
2. 摄影机可以从正面、侧面、背侧或斜侧拍摄，角度由合理落位和产品展示共同决定。
3. 沙发必须按房间透视缩放，底座/脚部贴合地面，并有真实接触阴影和投射阴影。
4. 如果产品图角度与房间最合理落位冲突，保持房间落位正确，选择最接近且真实可拍的商品角度。

【画面质量】
照片级真实摄影，高端电商主图质感，光影、比例、透视、地面接触关系真实；不要出现文字、水印、额外品牌 LOGO、人物、拼图、分屏、漫画或插画风格。

请生成最终合成后的单张实景照片。
`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      userId,
      toolId,
      saasInfo,
      productImage,
      roomImage,
      angle = '正面/侧面/背侧/斜侧自适应合理机位',
      height = '1.2米',
      lighting = '柔和自然光',
      aspectRatio = '4:3',
      imageSize = '1K',
      customPrompt = '',
      shotName = '中景：电商主图',
      cameraSpec = '35-50mm标准焦段，1.05-1.2米视平机位',
      placementX = 0.5,
      placementY = 0.68,
      hasManualPlacement = false,
    } = body;

    if (!productImage || !roomImage) {
      return Response.json({ success: false, errorMessage: '请上传或选择产品参考图与房间参考图' }, { status: 400 });
    }

    const isSaaS = userId && toolId && !String(userId).startsWith('mock_');
    if (isSaaS) {
      try {
        await verifyBeforeGenerate(userId, toolId, saasInfo);
      } catch (verifyErr: any) {
        return Response.json({
          success: false,
          errorMessage: `前置积分校验失败: ${verifyErr.message || verifyErr}`,
        }, { status: 502 });
      }
    }

    let productData;
    let roomData;
    try {
      [productData, roomData] = await Promise.all([
        getBase64FromUrlOrData(productImage),
        getBase64FromUrlOrData(roomImage),
      ]);
    } catch (imageErr: any) {
      return Response.json({
        success: false,
        errorMessage: `读取参考图失败: ${imageErr.message || imageErr}`,
      }, { status: 400 });
    }

    let generatedBase64;
    let mimeType;
    let modelUsed;
    let infoText;
    const placementHint = hasManualPlacement
      ? `用户手动拖动的预览锚点约为画面 X=${Math.round(Number(placementX) * 100)}%, Y=${Math.round(Number(placementY) * 100)}%。这只是软参考；如果该位置不在真实地面可摆放区域，或会挡住窗户、门洞、走道、固定柜体，或落在电视所在墙同侧/电视下方/电视旁边贴墙区，请必须自动选择更合理的电视对侧或斜对侧会客区。`
      : '用户没有手动指定落位坐标；不要使用默认画面中心或默认锚点作为摆放依据，必须完全根据房间参考图中的电视/媒体墙、主背景墙、窗户/窗帘、门洞、固定柜体、原座位区、地毯/茶几和通道自动选择最合理座位区；有电视/媒体墙时优先电视对侧或斜对侧，禁止电视同侧贴墙和电视下方。';
    let placementPlan = '空间落位分析未单独返回；请按房间参考图中的真实地面、原座位区、会客区、窗户、门洞、固定柜体、电视/媒体墙和主要通道，选择最稳定且不挡光不挡路的可摆放区域；有电视/媒体墙时必须在电视对侧或斜对侧，不能在电视所在墙同侧或电视下方。';
    try {
      placementPlan = await generatePlacementPlanWithGemini({
        roomData: roomData.data,
        roomMimeType: roomData.mimeType,
        productData: productData.data,
        productMimeType: productData.mimeType,
        shotName,
        cameraSpec,
      });
      console.info('Generated placement plan:', placementPlan.slice(0, 800));
    } catch (planErr: any) {
      console.warn('Placement plan analysis failed, falling back to built-in placement guard:', planErr.message || planErr);
    }

    try {
      ({ generatedBase64, mimeType, modelUsed, infoText } = await generateImageWithGemini({
        parts: [
          { text: '【房间参考图】唯一空间来源：必须锁定此房间的墙体、窗户、门洞、电视墙/媒体墙、固定柜体、吊顶、地面和光线。' },
          { inlineData: { data: roomData.data, mimeType: roomData.mimeType } },
          { text: '【产品参考图】只提取沙发本体的款式、比例、材质、颜色和细节；必须忽略这张图里的房间背景、柜墙、灯具、茶几和所有其他物体。' },
          { inlineData: { data: productData.data, mimeType: productData.mimeType } },
          {
            text: buildPrompt({
              angle,
              height,
              lighting,
              customPrompt,
              shotName,
              cameraSpec,
              placementHint,
              placementPlan,
            }),
          },
        ],
        aspectRatio,
        imageSize,
      }));
    } catch (aiErr: any) {
      return Response.json({
        success: false,
        errorMessage: `AI生成失败: ${aiErr.message || aiErr}`,
      }, { status: 502 });
    }

    if (isSaaS) {
      scheduleSaasSave({
        userId,
        toolId,
        saasInfo,
        generatedBase64,
        mimeType,
      });
      return Response.json({
        success: true,
        image: `data:${mimeType};base64,${generatedBase64}`,
        modelUsed,
        info: infoText,
        savedToSaas: false,
        saveScheduled: true,
        needsSaasSave: false,
      });
    }

    return Response.json({
      success: true,
      image: `data:${mimeType};base64,${generatedBase64}`,
      modelUsed,
      info: infoText,
    });
  } catch (err: any) {
    const isKeyError = !process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY_NEXT && !process.env.API_KEY;
    return Response.json({
      success: false,
      isKeyError,
      errorMessage: err.message || '模型生成失败，请确认 API Key 和 Vercel 函数配置。',
    }, { status: 500 });
  }
}

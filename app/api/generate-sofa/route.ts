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

执行要求：最终画面必须遵守上面的本次落位方案。若落位方案与画面居中、商品角度或景别构图发生冲突，优先执行落位方案；通过移动相机、改变焦段和裁切来完成构图，不要把沙发挪到禁放区。

【景别与机位】
1. 远景/中景/近景只通过相机距离、焦段、机位高度、景深和裁切区分，不改变沙发落位或房间构造。
2. 摄影机可以从正面、侧面、背侧或斜侧拍摄，角度由合理落位和产品展示共同决定。
3. 沙发必须按房间透视缩放，底座/脚部贴合地面，并有真实接触阴影和投射阴影。

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
      ? `用户手动拖动的预览锚点约为画面 X=${Math.round(Number(placementX) * 100)}%, Y=${Math.round(Number(placementY) * 100)}%。这只是软参考；如果该位置不在真实地面可摆放区域，或会挡住窗户、电视墙、门洞、走道、固定柜体，请必须自动选择更合理的客厅座位区。`
      : '用户没有手动指定落位坐标；不要使用默认画面中心或默认锚点作为摆放依据，必须完全根据房间参考图中的电视/媒体墙、主背景墙、窗户/窗帘、门洞、固定柜体、原座位区、地毯/茶几和通道自动选择最合理座位区。';
    let placementPlan = '空间落位分析未单独返回；请按房间参考图中的真实地面、原座位区、会客区、窗户、门洞、固定柜体、电视/媒体墙和主要通道，选择最稳定且不挡光不挡路的可摆放区域。';
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

import {
  generateImageWithGemini,
  getBase64FromUrlOrData,
  verifyBeforeGenerate,
} from '../../../api/_shared';

export const runtime = 'nodejs';
export const maxDuration = 60;

function buildPrompt({
  angle,
  height,
  lighting,
  customPrompt,
  placementHint,
}: {
  angle: string;
  height: string;
  lighting: string;
  customPrompt: string;
  placementHint: string;
}) {
  return `
你是一位极其严谨的专业家居电商摄影师和空间合成专家。
你的任务是将提供的【产品参考图】（第一张沙发）完美、无缝地融入到【房间参考图】（第二张客厅/房间空间）中。

【产品还原逻辑 - 绝对最高优先级】
1. 必须完全保留并严密还原【产品参考图】中沙发的全部造型与物理特征：
   - 整体款式、轮廓造型、座位数量必须100%一致。
   - 扶手设计和结构、靠背高度、倾斜角度。
   - 缝线走向、褶皱痕迹、坐垫数量和厚度。
   - 布料或皮革的真实材质纹理与原本的颜色。
   - 腿部结构（无论是金属、木质还是隐藏式底座）。
2. 绝对不允许对沙发进行款式改装或合并其他设计。

【房间融合逻辑 - 真实摄影棚质感】
1. 【房间参考图】仅用于提供背景空间框架、墙面颜色、地面材质、光线方向、窗户布局、其他既有家具风格和整体氛围。
2. 必须先判断房间里的真实可摆放区域：地面平面、主墙面、地毯/茶几/电视墙/窗户/动线关系。把沙发放在最合理的客厅座位区，不要随机放在画面中央、角落、门口、窗前遮挡处或漂浮在墙面上。
3. 沙发落位优先级：
   - 有地毯或茶几时，沙发应与地毯/茶几形成自然会客区，前沿与茶几保持合理距离。
   - 有主背景墙或电视墙时，沙发背部应平行或近似平行于主墙/地板透视线。
   - 没有明确家具时，选择画面下半部可见地面中最稳定的区域，保持四脚/底座完整接触地面。
   - 绝不能挡住门洞、主要通道、窗户主体或已有核心家具。
4. 必须按房间透视缩放沙发大小，近大远小；底座必须贴合地面透视线，不能悬浮、歪斜、穿墙或压在不合理物体上。
5. 必须生成沙发的真实接触阴影和投射阴影，阴影方向、软硬程度和长度要与房间光源一致，绝不能有生硬抠图感。
6. 沙发本身的受光方向、高光、阴影必须与房间参考图中的光源方向完全吻合。
7. 当前设置：
   - 生成视角: ${angle}
   - 镜头高度: ${height}
   - 环境光线: ${lighting}
   - 落位参考: ${placementHint}
   ${customPrompt ? `- 附加氛围描述: ${customPrompt}` : ''}

【生成镜头与画面要求】
1. 构图：根据所选远景/中景/近景合理决定沙发画面占比，但必须保留清晰的地面接触关系和真实空间深度。
2. 画质：高端电商主图级别，照片级真实摄影，真实阴影，真实比例，单张完整照片。
3. 限制：画面中绝对不能出现任何文字、水印、额外品牌LOGO、人物、多图拼接、分屏、漫画插画风格。

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
      angle = '45度侧切正面',
      height = '1.2米',
      lighting = '柔和自然光',
      aspectRatio = '4:3',
      imageSize = '1K',
      customPrompt = '',
      placementX = 0.5,
      placementY = 0.68,
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
    try {
      ({ generatedBase64, mimeType, modelUsed, infoText } = await generateImageWithGemini({
        parts: [
          { text: '【产品参考图】必须优先还原此沙发的款式、比例、材质、颜色和细节。' },
          { inlineData: { data: productData.data, mimeType: productData.mimeType } },
          { text: '【房间参考图】仅用于空间结构、光线、地面、墙面和整体氛围参考。' },
          { inlineData: { data: roomData.data, mimeType: roomData.mimeType } },
          {
            text: buildPrompt({
              angle,
              height,
              lighting,
              customPrompt,
              placementHint: `用户预览锚点约为画面 X=${Math.round(Number(placementX) * 100)}%, Y=${Math.round(Number(placementY) * 100)}%。这只是软参考；如果该位置不在真实地面可摆放区域，请自动选择更合理的客厅座位区。`,
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
      return Response.json({
        success: true,
        image: `data:${mimeType};base64,${generatedBase64}`,
        modelUsed,
        info: infoText,
        savedToSaas: false,
        needsSaasSave: true,
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

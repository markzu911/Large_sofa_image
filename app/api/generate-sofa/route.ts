import {
  generateImageWithGemini,
  getBase64FromUrlOrData,
  saveGeneratedImageToSaas,
  verifyBeforeGenerate,
} from '../../../api/_shared';

export const runtime = 'nodejs';
export const maxDuration = 300;

function buildPrompt({
  angle,
  height,
  lighting,
  customPrompt,
}: {
  angle: string;
  height: string;
  lighting: string;
  customPrompt: string;
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
2. 将沙发摆放在房间中合理的地面位置，保持完美的透视比例与空间深度，看起来像是一开始就摆在那里。
3. 必须生成沙发的真实接触阴影和投射阴影，绝不能有生硬抠图感。
4. 沙发本身的受光方向、高光、阴影必须与房间参考图中的光源方向完全吻合。
5. 当前设置：
   - 生成视角: ${angle}
   - 镜头高度: ${height}
   - 环境光线: ${lighting}
   ${customPrompt ? `- 附加氛围描述: ${customPrompt}` : ''}

【生成镜头与画面要求】
1. 构图：沙发完整入镜，作为绝对画面主体，占据中景位置。
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
      productImage,
      roomImage,
      angle = '45度侧切正面',
      height = '1.2米',
      lighting = '柔和自然光',
      aspectRatio = '4:3',
      imageSize = '1K',
      customPrompt = '',
    } = body;

    if (!productImage || !roomImage) {
      return Response.json({ success: false, errorMessage: '请上传或选择产品参考图与房间参考图' }, { status: 400 });
    }

    const isSaaS = userId && toolId && !String(userId).startsWith('mock_');
    if (isSaaS) {
      await verifyBeforeGenerate(userId, toolId);
    }

    const [productData, roomData] = await Promise.all([
      getBase64FromUrlOrData(productImage),
      getBase64FromUrlOrData(roomImage),
    ]);

    const { generatedBase64, mimeType, modelUsed, infoText } = await generateImageWithGemini({
      parts: [
        { text: '【产品参考图】必须优先还原此沙发的款式、比例、材质、颜色和细节。' },
        { inlineData: { data: productData.data, mimeType: productData.mimeType } },
        { text: '【房间参考图】仅用于空间结构、光线、地面、墙面和整体氛围参考。' },
        { inlineData: { data: roomData.data, mimeType: roomData.mimeType } },
        { text: buildPrompt({ angle, height, lighting, customPrompt }) },
      ],
      aspectRatio,
      imageSize,
    });

    if (isSaaS) {
      try {
        const savedImage = await saveGeneratedImageToSaas({
          userId,
          toolId,
          generatedBase64,
          mimeType,
        });
        return Response.json({ success: true, ...savedImage, modelUsed, info: infoText });
      } catch (saasErr: any) {
        return Response.json({
          success: false,
          errorMessage: `生图成功，但SaaS保存失败，结果未入库: ${saasErr.message || saasErr}`,
        }, { status: 502 });
      }
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

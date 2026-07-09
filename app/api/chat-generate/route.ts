import {
  generateImageWithGemini,
  getBase64FromUrlOrData,
  saveGeneratedImageToSaas,
  verifyBeforeGenerate,
} from '../../../api/_shared';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      userId,
      toolId,
      saasInfo,
      prompt,
      productImage,
      roomImage,
      aspectRatio = '4:3',
      imageSize = '1K',
      history = [],
    } = body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return Response.json({ success: false, errorMessage: '请输入对话生图需求' }, { status: 400 });
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

    const parts: any[] = [];
    if (productImage) {
      const productData = await getBase64FromUrlOrData(productImage).catch((imageErr: any) => {
        throw new Error(`读取沙发参考图失败: ${imageErr.message || imageErr}`);
      });
      parts.push({ text: '【沙发/商品参考图】最高优先级：保留款式、轮廓、颜色、材质纹理、缝线和结构比例。' });
      parts.push({ inlineData: { data: productData.data, mimeType: productData.mimeType } });
    }

    if (roomImage) {
      const roomData = await getBase64FromUrlOrData(roomImage).catch((imageErr: any) => {
        throw new Error(`读取房间参考图失败: ${imageErr.message || imageErr}`);
      });
      parts.push({ text: '【房间/场景参考图】用于空间结构、地面墙面、光线方向、镜头透视和整体氛围参考。' });
      parts.push({ inlineData: { data: roomData.data, mimeType: roomData.mimeType } });
    }

    const compactHistory = Array.isArray(history)
      ? history
          .filter((item: any) => item?.role && item?.content)
          .slice(-6)
          .map((item: any) => `${item.role === 'assistant' ? '助手' : '用户'}: ${String(item.content).slice(0, 500)}`)
          .join('\n')
      : '';

    parts.push({
      text: `
你是一位专业家居电商图像导演，正在根据用户的对话生成单张高质量沙发/家居电商图片。

【对话上下文】
${compactHistory || '无'}

【用户最新需求】
${prompt.trim()}

【必须遵守】
1. 输出必须是一张完整、连续、真实摄影风格的单张图片，不要拼图、分屏、海报文字、水印、LOGO 或界面截图。
2. 如果提供了沙发/商品参考图，必须优先严格还原商品款式、颜色、材质、比例和关键细节，不要擅自改款。
3. 如果提供了房间/场景参考图，场景只用于空间、光线、风格和透视参考；需要让商品自然融入并生成真实接触阴影。
4. 如果用户只用文字描述，就按文字生成高端家居电商摄影图，构图干净、主体明确、可直接用于商品展示。
5. 光影、比例、透视、地面接触关系必须真实，避免悬浮感、抠图感和塑料质感。
`,
    });

    let generatedBase64;
    let mimeType;
    let modelUsed;
    let infoText;
    try {
      ({ generatedBase64, mimeType, modelUsed, infoText } = await generateImageWithGemini({
        parts,
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
      try {
        const savedImage = await saveGeneratedImageToSaas({
          userId,
          toolId,
          generatedBase64,
          mimeType,
          saasInfo,
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
      errorMessage: err.message || '对话生图失败',
    }, { status: 500 });
  }
}

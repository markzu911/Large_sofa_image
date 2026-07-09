import {
  generateImageWithGemini,
  getBase64FromUrlOrData,
  verifyBeforeGenerate,
} from '../../../api/_shared';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
      parts.push({ text: '【房间/场景参考图】用于锁定真实房间构造、地面墙面、光线方向、镜头透视和整体氛围；可移动家具可以被商品合理替换。' });
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
3. 如果提供了房间/场景参考图，必须把它视为真实现场：锁定墙体关系、窗户/窗帘位置、门洞、电视墙/媒体墙朝向、固定柜体、吊顶/梁、地面纹理方向、墙角和整体空间比例。
4. 绝对禁止重建、翻转、旋转或重新装修房间；禁止把电视/电视墙移动到另一面墙、把电视朝向改成窗户、交换窗户与电视墙位置、改变墙体开口、改变窗户数量或重排房间骨架。
5. 可以为了展示产品，合理替换或移除原图中的可移动家具，例如原沙发、单椅、边几、茶几、抱枕、地毯、临时装饰物；但替换后必须仍然像在同一个房间里拍摄，不能改变不可移动的建筑结构和固定空间参照。
6. 必须先识别真实地面、主墙、地毯/茶几/电视墙/窗户/门洞/通道关系，把沙发放在最合理的客厅座位区，而不是随机居中或随意摆放。
7. 沙发落位必须满足室内设计常识：如果原图已有沙发/座椅，可以用商品沙发替换原有可移动座位家具；有电视墙/媒体墙时，沙发朝向应符合观看和会客逻辑，不能让电视墙突然换边或朝向窗户。
8. 沙发必须贴合地面透视，底座/脚部有明确接触点、接触阴影和投射阴影；不能悬浮、穿墙、压在不合理家具上或比例过大过小。
9. 可以选择沙发正面、侧面或45度斜侧等更适合产品展示的角度，但必须像摄影师在同一个真实房间里移动机位拍摄，不能因此改变电视墙、窗户、门洞和墙体的相对关系。
10. 远景/中景/近景必须通过真实摄影机距离、焦段、机位高度、景深和裁切范围来区分，不能只把沙发简单放大或缩小：
   - 远景：相机后退到房间入口/对角线位置，广角完整展示空间，沙发占比小但完整。
   - 中景：相机在沙发前方约2-3米，标准焦段，沙发为主体并保留地面接触和背景。
   - 近景：相机靠近沙发约0.8-1.4米，中长焦浅景深，突出材质细节，可自然裁切但保留地面接触边缘。
11. 如果用户只用文字描述，就按文字生成高端家居电商摄影图，构图干净、主体明确、可直接用于商品展示。
12. 光影、比例、透视、地面接触关系必须真实，避免悬浮感、抠图感和塑料质感。
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
      errorMessage: err.message || '对话生图失败',
    }, { status: 500 });
  }
}

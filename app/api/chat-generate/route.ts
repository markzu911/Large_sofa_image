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
      console.info('SaaS chat background save success:', {
        recordId: saved.recordId,
        url: saved.url,
      });
    } catch (err: any) {
      console.error('SaaS chat background save failed:', {
        saveStep: err.saveStep,
        message: err.message,
      });
    }
  };

  try {
    after(saveTask);
  } catch (err: any) {
    console.error('Failed to schedule SaaS chat background save, running best-effort fallback:', err.message || err);
    void saveTask();
  }
}

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
    let roomData: { data: string; mimeType: string } | null = null;
    let productData: { data: string; mimeType: string } | null = null;
    if (roomImage) {
      roomData = await getBase64FromUrlOrData(roomImage).catch((imageErr: any) => {
        throw new Error(`读取房间参考图失败: ${imageErr.message || imageErr}`);
      });
      parts.push({ text: '【房间/场景参考图】唯一空间来源：必须锁定真实房间构造、地面墙面、窗户、门洞、电视/媒体墙、固定柜体、吊顶、光线方向、镜头透视和整体氛围。' });
      parts.push({ inlineData: { data: roomData.data, mimeType: roomData.mimeType } });
    }

    if (productImage) {
      productData = await getBase64FromUrlOrData(productImage).catch((imageErr: any) => {
        throw new Error(`读取沙发参考图失败: ${imageErr.message || imageErr}`);
      });
      parts.push({ text: '【沙发/商品参考图】只提取沙发本体：保留款式、轮廓、颜色、材质纹理、缝线和结构比例；必须忽略这张图里的房间背景、墙柜、灯具、茶几、装饰和其他物体。' });
      parts.push({ inlineData: { data: productData.data, mimeType: productData.mimeType } });
    }

    const compactHistory = Array.isArray(history)
      ? history
          .filter((item: any) => item?.role && item?.content)
          .slice(-6)
          .map((item: any) => `${item.role === 'assistant' ? '助手' : '用户'}: ${String(item.content).slice(0, 500)}`)
          .join('\n')
      : '';

    const shotNameForPlan = /近景|特写|细节/.test(prompt)
      ? '近景：材质细节'
      : /远景|全景|空间全貌/.test(prompt)
      ? '远景：空间全貌'
      : /中景|主图/.test(prompt)
      ? '中景：电商主图'
      : '对话生图当前景别';
    const cameraSpecForPlan = prompt.match(/摄影机参数[:：]([^\n。]+)/)?.[1]?.trim()
      || '根据用户对话中的远景/中景/近景要求自适应';

    let placementPlan = '';
    if (roomData) {
      try {
        placementPlan = await generatePlacementPlanWithGemini({
          roomData: roomData.data,
          roomMimeType: roomData.mimeType,
          productData: productData?.data,
          productMimeType: productData?.mimeType,
          shotName: shotNameForPlan,
          cameraSpec: cameraSpecForPlan,
        });
        console.info('Generated chat placement plan:', placementPlan.slice(0, 800));
      } catch (planErr: any) {
        console.warn('Chat placement plan analysis failed, falling back to built-in placement guard:', planErr.message || planErr);
      }
    }

    parts.push({
      text: `
你是一位专业家居电商图像导演，正在根据用户的对话生成单张高质量沙发/家居电商图片。

【对话上下文】
${compactHistory || '无'}

【用户最新需求】
${prompt.trim()}

${placementPlan ? `【本次房间落位方案 - 必须优先执行】\n${placementPlan}\n\n执行要求：最终画面必须遵守上面的唯一锁定落点。远景/中景/近景只能通过相机距离、焦段、高度、景深和裁切变化实现，不能重新选择沙发位置，不能把沙发挪到窗前、门洞、通道、电视墙前、固定柜体前或房间中央。\n` : ''}

【必须遵守】
1. 输出必须是一张完整、连续、真实摄影风格的单张图片，不要拼图、分屏、海报文字、水印、LOGO 或界面截图。
2. 如果提供了沙发/商品参考图，只提取商品本体的款式、颜色、材质、比例和关键细节；忽略商品图里的背景空间和其他物体。
3. 如果提供了房间/场景参考图，它是唯一真实现场；锁定墙体、窗户、门洞、电视/媒体墙、固定柜体、吊顶、地面透视、光线方向和整体空间比例。
4. 可以合理替换或移除房间参考图里的可移动家具，但不要重建、翻转、旋转或重新装修房间。
5. 有本次落位方案时，沙发位置、朝向、禁放区和机位以该方案为准；没有方案时，也必须按真实室内设计逻辑选择稳定可放区，不能随机居中、挡窗、挡门、挡电视墙、遮挡动线或悬浮。
6. 如果窗前是主要采光面或落地窗/窗帘区域，窗前空地不是默认沙发区；除非落位方案明确允许，否则必须保留采光和通行。
7. 远景/中景/近景共用同一个物理落位，通过相机距离、焦段、机位高度、景深和裁切区分；可以正面、侧面、背侧或斜侧拍摄，但不要为了角度改变沙发落位或房间构造。
8. 近景是靠近已落位沙发拍局部材质和结构，可以自然裁切，不是把完整沙发整体巨大化后塞进窗前或房间中央。
9. 沙发必须贴合地面透视，底座/脚部有明确接触点、接触阴影和投射阴影；光影、比例、材质质感真实。
10. 如果用户只用文字描述，就按文字生成高端家居电商摄影图，构图干净、主体明确、可直接用于商品展示。
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
      errorMessage: err.message || '对话生图失败',
    }, { status: 500 });
  }
}

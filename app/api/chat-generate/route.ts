import { after } from 'next/server';
import {
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
    if (roomImage) {
      const roomData = await getBase64FromUrlOrData(roomImage).catch((imageErr: any) => {
        throw new Error(`读取房间参考图失败: ${imageErr.message || imageErr}`);
      });
      parts.push({ text: '【房间/场景参考图】唯一空间来源：必须锁定真实房间构造、地面墙面、窗户、门洞、电视/媒体墙、固定柜体、吊顶、光线方向、镜头透视和整体氛围。' });
      parts.push({ inlineData: { data: roomData.data, mimeType: roomData.mimeType } });
    }

    if (productImage) {
      const productData = await getBase64FromUrlOrData(productImage).catch((imageErr: any) => {
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

    parts.push({
      text: `
你是一位专业家居电商图像导演，正在根据用户的对话生成单张高质量沙发/家居电商图片。

【对话上下文】
${compactHistory || '无'}

【用户最新需求】
${prompt.trim()}

【必须遵守】
1. 输出必须是一张完整、连续、真实摄影风格的单张图片，不要拼图、分屏、海报文字、水印、LOGO 或界面截图。
2. 如果提供了沙发/商品参考图，只能提取商品沙发本体：款式、颜色、材质、比例和关键细节必须严格还原，不要擅自改款。
3. 必须完全忽略沙发/商品参考图里的背景空间和其他物体，包括墙面、柜墙、书架、木饰面、吊顶灯带、厨房/门洞、窗户、落地灯、茶几、玩偶、地毯、装饰品和地面材质，绝对不要把这些元素迁移到最终图。
4. 如果提供了房间/场景参考图，必须把它视为唯一真实现场：锁定墙体关系、窗户/窗帘位置、门洞、电视墙/媒体墙朝向、固定柜体、吊顶/梁、地面纹理方向、墙角、空旷区域和整体空间比例。
5. 绝对禁止重建、翻转、旋转或重新装修房间；禁止把电视/电视墙移动到另一面墙、把电视朝向改成窗户、交换窗户与电视墙位置、改变墙体开口、改变窗户数量、增加新的整面柜墙/书架或重排房间骨架。
6. 可以为了展示产品，合理替换或移除房间参考图中的可移动家具，例如原沙发、单椅、边几、茶几、抱枕、地毯、临时装饰物；但替换后必须仍然像在同一个房间里拍摄，不能改变不可移动的建筑结构和固定空间参照。
7. 必须先识别真实地面、主墙、地毯/茶几/电视墙/窗户/门洞/固定柜体/通道关系，再决定沙发落位和机位，最后融合产品；不要先把沙发居中再反向改房间。
8. 沙发落位必须满足室内设计常识：如果房间参考图已有沙发/座椅，可以用商品沙发替换原有可移动座位家具；有电视墙/媒体墙时，沙发必须放在电视/媒体墙对侧或斜对侧的可用地面上，座面朝向电视/媒体墙，长边与电视墙大致平行，保持合理观看距离。
9. 如果电视在画面左/右侧墙，大窗在后墙，沙发不能横在大窗前或房间中轴线上堵住采光；应退到电视对侧的下方/侧方开阔地面，朝向电视，保留窗前通道和视觉空白。
10. 如果窗前是主要采光面、阳台门或明显通道，禁止把大沙发背靠或横放在窗前，除非房间参考图原本就有不遮挡窗主体的窗前座位区。
11. 位置合理性强于画面居中：宁可让沙发偏右、偏左或偏下，也不能为了居中构图把大沙发摆到窗前、电视前、门口、走道中央或柜体前方。
12. 沙发必须贴合地面透视，底座/脚部有明确接触点、接触阴影和投射阴影；不能悬浮、穿墙、压在不合理家具上或比例过大过小。
13. 可以选择沙发正面、侧面或45度斜侧等更适合产品展示的角度，但必须像摄影师在同一个真实房间里移动机位拍摄，不能因此改变电视墙、窗户、门洞和墙体的相对关系。
14. 远景/中景/近景都必须先完成房间结构识别和合理沙发落位，再通过真实摄影机距离、焦段、机位高度、景深和裁切范围来区分，不能只把沙发简单放大或缩小，更不能为了景别改变沙发落位或房间构造：
   - 远景：相机后退到房间入口/对角线位置，广角完整展示空间，沙发占比小且尽量完整；不能为了远景全貌把沙发拖到窗前、房间中心或电视墙前。
   - 中景：相机在已经合理落位的沙发前方约2-3米，标准焦段，沙发为主体并保留地面接触和背景；不能为了电商主图居中而挡住窗户、门洞、走道、电视墙或固定柜体。
   - 近景：相机靠近已经合理落位的沙发约0.8-1.4米，中长焦浅景深，突出材质细节，可自然裁切，不要求整张沙发完整入镜，但必须保留地面接触边缘或明确接触阴影；不能为了近景特写重新选择背景或把沙发挪到窗前/通道/电视墙前。
15. 不要把大沙发摆在大窗正前方或房间中央来挡住采光和通道；不要为了拍到沙发正面而把电视墙、窗户、门洞或墙体关系换边；不要让沙发面向窗户却背离已有电视/媒体墙，除非房间参考图明确没有电视/媒体墙；不要因为远景/中景/近景任一景别要求而牺牲合理落位。
16. 如果用户只用文字描述，就按文字生成高端家居电商摄影图，构图干净、主体明确、可直接用于商品展示。
17. 光影、比例、透视、地面接触关系必须真实，避免悬浮感、抠图感和塑料质感。
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

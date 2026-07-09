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
}: {
  angle: string;
  height: string;
  lighting: string;
  customPrompt: string;
  placementHint: string;
  shotName: string;
  cameraSpec: string;
}) {
  return `
你是一位极其严谨的专业家居电商摄影师和空间合成专家。
你的任务是将提供的【产品参考图】中的沙发本体，完美、无缝地融入到【房间参考图】的真实客厅/房间空间中。

【参考图角色隔离 - 绝对最高优先级】
1. 【房间参考图】是唯一的房间结构、墙面、窗户、门洞、电视墙/媒体墙、固定柜体、地面、吊顶和光线来源。
2. 【产品参考图】只允许用于提取沙发本体：款式、轮廓、比例、材质、颜色、纹理和细节。
3. 必须完全忽略【产品参考图】里的背景空间和其他物体，包括但不限于墙面、柜墙、书架、木饰面、吊顶灯带、厨房/门洞、窗户、落地灯、茶几、玩偶、地毯、装饰品和地面材质。
4. 绝对禁止把【产品参考图】里的背景、家具、墙柜、灯具或空间布局迁移到最终画面。最终画面的房间必须一眼看出仍然是【房间参考图】里的那个房间。

【产品还原逻辑 - 绝对最高优先级】
1. 必须完全保留并严密还原【产品参考图】中“沙发本体”的全部造型与物理特征：
   - 整体款式、轮廓造型、座位数量必须100%一致。
   - 扶手设计和结构、靠背高度、倾斜角度。
   - 缝线走向、褶皱痕迹、坐垫数量和厚度。
   - 布料或皮革的真实材质纹理与原本的颜色。
   - 腿部结构（无论是金属、木质还是隐藏式底座）。
2. 绝对不允许对沙发进行款式改装或合并其他设计；也绝对不要复制产品图里的房间背景。

【房间构造锁定 - 绝对最高优先级】
1. 【房间参考图】代表一个真实房间，必须锁定原房间的墙体关系、窗户/窗帘位置、门洞、电视墙/媒体墙朝向、固定柜体、吊顶/梁、地面纹理方向、墙角、空旷区域和整体空间比例。
2. 绝对禁止重建、翻转、旋转或重新装修房间；禁止把电视/电视墙移动到另一面墙、把电视朝向改成窗户、交换窗户与电视墙位置、改变墙体开口、改变窗户数量、增加新的整面柜墙/书架或重排房间骨架。
3. 可以为了展示产品，合理替换或移除原图中的可移动家具，例如原沙发、单椅、边几、茶几、抱枕、地毯、临时装饰物；但替换后必须仍然像在同一个房间里拍摄，不能改变不可移动的建筑结构和固定空间参照。
4. 如果新镜头需要正面、侧面、背侧或斜侧商品视角，可以让摄影师在同一真实房间内移动机位拍摄；拍摄角度不固定，必须由房间结构、沙发合理落位和商品展示需求共同决定，不能生成一个布局相似但电视墙/窗户/墙体关系已经改变的新房间。
5. 当商品视角与房间结构发生冲突时，优先保持房间构造正确，再选择最接近且合理的商品拍摄角度。

【家具替换与落位逻辑 - 真实室内设计】
1. 【房间参考图】用于提供空间框架、墙面颜色、地面材质、光线方向、窗户布局、固定空间参照、可移动家具风格和整体氛围。
2. 必须先判断房间里的真实可摆放区域：地面平面、主墙面、地毯/茶几/电视墙/窗户/门洞/柜体/动线关系。执行顺序必须是先分析空间结构，再决定沙发落位和机位，最后融合产品；不要先把沙发居中再反向改房间。
3. 必须执行空间规划检查清单：
   - 先识别不可移动结构：电视/媒体墙、主背景墙、大窗/窗帘、门洞、阳台门、固定柜体、墙角、地面透视和主要通道。
   - 再标记禁放区：窗前采光区、门洞/通道、电视墙正前方、固定柜体前、墙体开口、过窄地面和会导致沙发漂浮/穿墙的位置。
   - 再标记可放区：原沙发/座椅区、地毯/茶几会客区、电视/媒体墙对侧或斜对侧的开阔地面、不会挡光挡路的空地。
   - 最后从可放区中选择最符合观看/会客逻辑的位置，不能从画面中心或商品角度倒推落位。
4. 沙发落位优先级：
   - 如果房间中原本有沙发或座椅，可以用【产品参考图】中的沙发替换原有可移动座位家具，保持会客区逻辑自然。
   - 有地毯或茶几时，沙发应与地毯/茶几形成自然会客区，前沿与茶几保持合理距离；如果茶几阻碍合理落位，可以轻微调整或替换茶几，但不能破坏房间骨架。
   - 有电视墙、媒体墙、壁炉墙或主背景墙时，沙发必须按观看/会客逻辑落位：放在电视/媒体墙对侧或斜对侧的可用地面上，主坐面朝向电视/媒体墙，整体形成合理观看关系并保持合理观看距离。
   - 如果电视在画面左/右侧墙，大窗在后墙，沙发不能横在大窗前或房间中轴线上堵住采光；应退到电视对侧的下方/侧方开阔地面，朝向电视，保留窗前通道和视觉空白。
   - 如果窗前是主要采光面、阳台门或明显通道，禁止把大沙发背靠或横放在窗前，除非房间参考图原本就有不遮挡窗主体的窗前座位区。
   - 没有明确家具时，选择画面下半部可见地面中最稳定的区域，保持四脚/底座完整接触地面。
   - 绝不能挡住门洞、主要通道、窗户主体、电视/媒体墙主体或固定柜体主体。
5. 位置合理性强于画面居中：宁可让沙发偏右、偏左或偏下，也不能为了居中构图把大沙发摆到窗前、电视前、门口、走道中央或柜体前方。
6. 必须按房间透视缩放沙发大小，近大远小；底座必须贴合地面透视线，不能悬浮、歪斜、穿墙或压在不合理物体上。
7. 必须生成沙发的真实接触阴影和投射阴影，阴影方向、软硬程度和长度要与房间光源一致，绝不能有生硬抠图感。
8. 沙发本身的受光方向、高光、阴影必须与房间参考图中的光源方向完全吻合。
9. 当前设置：
   - 景别类型: ${shotName}
   - 摄影机参数: ${cameraSpec}
   - 生成视角: ${angle}
   - 镜头高度: ${height}
   - 环境光线: ${lighting}
   - 落位参考: ${placementHint}
   ${customPrompt ? `- 附加氛围描述: ${customPrompt}` : ''}

【摄影机景别规则 - 必须严格执行】
1. 所有景别都必须先完成房间结构识别和合理沙发落位，再移动摄影机拍摄；景别只能改变相机位置、焦段、机位高度、景深和裁切范围，不能改变沙发落位或房间构造。
2. 远景：相机应后退到房间入口、走廊口或客厅对角线位置，广角拍完整空间；沙发尽量完整但占比小，房间环境清晰。不能为了远景全貌把沙发拖到窗前、房间中心或电视墙前。
3. 中景：相机站在已经合理落位的沙发前方约2-3米，标准焦段，沙发是主体但仍能看到地面接触和背景空间。不能为了电商主图居中而挡住窗户、门洞、走道、电视墙或固定柜体。
4. 近景：相机靠近已经合理落位的沙发约0.8-1.4米，中长焦浅景深，可自然裁切部分沙发，突出材质和结构；不要求整张沙发完整入镜，但必须保留地面接触边缘或明确接触阴影。不能为了近景特写重新选择背景或把沙发挪到窗前/通道/电视墙前。
5. 不能出现同一机位下只改变沙发大小的效果；透视、背景压缩、景深和裁切必须符合对应景别。
6. 摄影机可以选择沙发正面、侧面、背侧或斜侧等更适合产品展示的角度；角度不固定，合理即可，但必须像同一个房间里真实移动机位得到的照片，不能因此改变沙发落位、电视墙、窗户、门洞和墙体的相对关系。

【生成镜头与画面要求】
1. 构图：根据所选远景/中景/近景合理决定沙发画面占比，但必须保留清晰的地面接触关系和真实空间深度。
2. 画质：高端电商主图级别，照片级真实摄影，真实阴影，真实比例，单张完整照片。
3. 限制：画面中绝对不能出现任何文字、水印、额外品牌LOGO、人物、多图拼接、分屏、漫画插画风格。

【错误结果必须避免】
- 不要把大沙发摆在大窗正前方或房间中央来挡住采光和通道。
- 不要为了拍到沙发正面而把电视墙、窗户、门洞或墙体关系换边。
- 不要让沙发面向窗户却背离已有电视/媒体墙，除非房间参考图明确没有电视/媒体墙。
- 不要因为远景/中景/近景任一景别要求而牺牲合理落位；景别服从落位，构图服从房间结构。
- 不要把“生成视角”理解为固定角度命令；角度可以变化，沙发位置和房间结构不能为角度让路。

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

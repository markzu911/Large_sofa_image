import { after } from 'next/server';
import {
  createPlacementGuideFromPlan,
  generatePlacementPlanWithGemini,
  generateProductIdentityWithGemini,
  generateImageWithGemini,
  getBase64FromUrlOrData,
  renderPlacementGuidePngBase64,
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
    }

    if (productImage) {
      productData = await getBase64FromUrlOrData(productImage).catch((imageErr: any) => {
        throw new Error(`读取沙发参考图失败: ${imageErr.message || imageErr}`);
      });
    }

    let productIdentity = '';
    if (productData) {
      try {
        productIdentity = await generateProductIdentityWithGemini({
          productData: productData.data,
          productMimeType: productData.mimeType,
        });
        console.info('Generated chat product identity:', productIdentity.slice(0, 800));
      } catch (identityErr: any) {
        console.warn('Chat product identity analysis failed, falling back to built-in product guard:', identityErr.message || identityErr);
        productIdentity = '未单独返回商品身份分析；最终仍必须把产品参考图作为最高优先级，100% 保持同一件沙发的轮廓、结构、模块数量、扶手/靠背/坐垫形态、缝线、扣点、褶皱、材质纹理、颜色和附属物状态；禁止新增产品图没有的抱枕、文字、Logo、图案、标签或装饰。';
      }
    }

    if (roomData) {
      parts.push({ text: '【房间/场景参考图 - 原始底片/空间结构最高优先级】必须以这张图作为最终画面的房间底片和相机方向来源。锁定真实房间构造、地面墙面、窗户、门洞、电视/媒体墙、固定柜体、吊顶、光线方向、镜头透视、原座位区和整体氛围；电视在左墙就必须仍在左墙，窗户/窗帘/边柜/墙角不能互换方位。房间图里的原沙发/原座椅是空间落位线索，可以替换、保留或轻微调整，具体以最合理摆放为准；不要用房间图里的原沙发款式、抱枕、文字或装饰改变商品沙发。' });
      parts.push({ inlineData: { data: roomData.data, mimeType: roomData.mimeType } });
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
    const isCloseShot = /近景|特写|细节/.test(shotNameForPlan);
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

    const placementGuide = placementPlan ? createPlacementGuideFromPlan(placementPlan) : null;
    const placementGuideImage = placementGuide ? renderPlacementGuidePngBase64(placementGuide) : null;
    if (placementGuideImage) {
      parts.push({ text: `【自动落位遮罩图 - 内部辅助，不得渲染】红色区域为绝对禁放区，沙发主体任何部分都不能进入；绿色区域为沙发主体目标落位区，沙发中心和主要体量必须落入；绿色箭头表示主坐面/开口侧朝向。${placementGuide?.instruction || ''}` });
      parts.push({ inlineData: { data: placementGuideImage, mimeType: 'image/png' } });
    }

    if (productData) {
      parts.push({ text: '【沙发/商品参考图 - 只提取沙发本体】必须复刻这同一件沙发本体。先在脑中抠出沙发本体，只提取沙发的轮廓、结构、模块数量、扶手/靠背/坐垫形态、缝线、扣点、褶皱、材质纹理、原本颜色和真实固定附属物；这不是风格参考，禁止生成相似款或改款。除非商品图中清晰固定在沙发本体上，否则严禁新增任何文字、Logo、品牌名、商标、图案、刺绣、标签、抱枕、靠包、毯子或装饰。必须忽略并禁止复制这张图里的房间背景、墙面文字、墙柜/柜体、灯具、茶几、玩偶/公仔、地毯、餐桌、画作、窗帘、绿植、水印和所有其他非沙发物体。' });
      parts.push({ inlineData: { data: productData.data, mimeType: productData.mimeType } });
    }

    parts.push({
      text: `
你是一位专业家居电商图像导演，正在根据用户的对话生成单张高质量沙发/家居电商图片。

【对话上下文】
${compactHistory || '无'}

【用户最新需求】
${prompt.trim()}

${productIdentity ? `【产品身份锁定 - 最高优先级】\n${productIdentity}\n\n执行要求：最终沙发必须是商品参考图中的同一件产品，不是同风格沙发、相似款、概念款或重新设计款。只允许为适配房间透视、光线和摄影角度做自然投影变化；不得改变轮廓、结构、模块数量、扶手/靠背/坐垫形态、缝线、扣点、褶皱、材质纹理、颜色和附属物状态。产品图背景中的墙面文字、标题、标签、道具、茶几、玩偶/公仔、灯具、柜体、地毯、餐桌、画作、窗帘和房间装饰不是产品信息，不能复制到最终图，也不能影响目标房间落位。\n` : ''}

${placementPlan ? `【本次房间落位方案 - 必须优先执行】\n${placementPlan}\n\n执行要求：最终画面必须遵守上面的唯一锁定落点。远景/中景/近景只能通过相机距离、焦段、高度、景深和裁切变化实现，不能重新选择沙发位置，不能把沙发挪到窗前、门洞、通道、电视所在墙同侧、电视下方、电视旁边贴墙区、固定柜体前、原沙发前方或房间中央。如果房间里有原沙发/原座椅，先判断原座位区是否最合理；最合理则替换，不是最合理则可保留原家具并把产品放到更合理空位，但必须不拥挤、不挡路、不与原家具冲突。\n` : ''}

${placementGuideImage ? `【自动落位遮罩图规则】\n输入中包含一张内部空间坐标遮罩图：红色是绝对禁放区，绿色是沙发主体目标落位区，绿色箭头是主坐面/开口侧朝向。最终图必须遵守遮罩，但不要渲染遮罩颜色、箭头、边框或辅助图痕迹。${isCloseShot ? '当前是近景/细节图，遮罩表示未裁切房间里的物理落点，不是要求把完整沙发塞进最终画面；最终画面应该是从正确落点靠近后裁切出来的局部。' : ''}\n` : ''}

【必须遵守】
1. 输出必须是一张完整、连续、真实摄影风格的单张图片，不要拼图、分屏、海报文字、水印、LOGO 或界面截图。
2. 如果提供了沙发/商品参考图，它是最高优先级的商品身份来源；生成前先把商品图做“心理抠图”，只保留沙发本体，其他像素全部当作透明背景；最终必须是同一件商品，100% 保留轮廓、结构、模块数量、扶手/靠背/坐垫形态、颜色、材质、纹理、缝线、扣点、褶皱和关键细节。
3. 严禁私自添加商品参考图中没有的任何信息：文字、数字、Logo、商标、品牌名、印章、标签、刺绣、图案、徽章、贴纸、花纹、二维码、水印。抱枕/靠包/毯子/装饰件只在商品图中清晰固定在沙发本体上时才允许出现；不确定时按没有处理。
4. 如果提供了房间/场景参考图，它是唯一真实现场和原始底片；锁定相机方向、墙体方位、窗户、门洞、电视/媒体墙、固定柜体、吊顶、地面透视、光线方向和整体空间比例。禁止重新拍摄或旋转房间，电视在左墙就必须仍在左墙，不能变成后墙/中间背景墙。
5. 商品图里的背景空间和其他物体必须忽略并禁止复制：茶几、玩偶/公仔、灯、柜体、地毯、餐桌、画作、窗帘、绿植、墙面、文字、水印都不是产品，也不是房间参考。房间参考图里的装饰、文字、商标、画作内容、抱枕图案、临时摆件也不能转移到商品沙发或抱枕上。
6. 可以合理替换或移除房间参考图里的可移动家具，但不要重建、翻转、旋转或重新装修房间。
7. 如果房间参考图已有沙发、座椅、贵妃位或明确会客座位，原座位区是最高优先候选区：如果它最合理，就用产品沙发替换原座位区；如果另有更合理空位，可以不替换原家具，但必须保持真实占地、朝向、与茶几/地毯/电视/通道的关系，不能因为窗前、房间中央或画面中心有空地就随机选择位置。
8. 有本次落位方案时，沙发位置、朝向、禁放区和机位以该方案为准；没有方案时，也必须按真实室内设计逻辑选择稳定可放区，不能随机居中、挡窗、挡门、挡电视墙、遮挡动线或悬浮。
9. 如果窗前是主要采光面或落地窗/窗帘区域，窗前空地不是默认沙发区；除非落位方案明确允许，否则必须保留采光和通行。
10. 如果房间有电视/媒体墙，沙发必须落在电视对侧或斜对侧的观看区，主坐面朝向电视/媒体墙；禁止把沙发放在电视所在墙、电视下方或与电视同侧贴墙。
11. 如果电视/媒体墙在画面左侧墙，电视所在左侧 58% 区域、电视下方、电视旁边同墙贴墙区全部禁放；沙发主体和主要体量必须避开 X<58% 的电视同侧区，优先落在画面右半部或右下/中下观看区，主坐面朝左/左上看电视。
12. 如果电视/媒体墙在画面右侧墙，电视所在右侧 58% 区域、电视下方、电视旁边同墙贴墙区全部禁放；沙发主体和主要体量必须避开 X>42% 的电视同侧区，优先落在画面左半部或左下/中下观看区，主坐面朝右/右上看电视。
13. 如果电视/媒体墙在画面后墙/上方背景墙，电视下方和后墙同侧贴墙区禁放；沙发中心应落在画面下方前景观看区，主坐面朝后墙/上方看电视。
14. 远景/中景/近景共用同一个物理落位，通过原房间视角上的推近、裁切、焦段、机位高度、景深区分；不能切换到新的房间相机方向，不能为了角度改变沙发落位或房间构造。
15. 近景是靠近已合理落位的产品沙发拍局部材质和结构，必须自然裁切局部；不是把完整沙发整体巨大化后塞进窗前、房间中央或原沙发前方；保留原家具时也不能让它成为混乱背景或造成双主沙发冲突。如果近景里能看见完整沙发全貌并占满前景，就是错误近景。
16. 沙发必须贴合地面透视，底座/脚部有明确接触点、接触阴影和投射阴影；光影、比例、材质质感真实。
17. 绝对禁止结果：产品沙发被随意放在前景/房间中央/原沙发前方，导致挡通道、挡视线、和原家具拥挤冲突。保留原家具本身不是错误，错误是产品沙发没有合理功能位置。
18. 绝对禁止结果：电视在左墙却把沙发放在左墙电视旁/电视下方/电视同侧，电视在右墙却把沙发放在右墙电视旁/电视下方/电视同侧，或电视在后墙却把沙发贴在电视下方。
19. 沙发主坐面必须朝向电视/茶几/会客中心。相机可以从正面、侧面、背侧或斜侧拍，但不能为了看到商品正面而旋转沙发，使它背离电视/茶几或只面向镜头。
20. 大沙发优先落在稳定家具区：原座位区、电视对侧观看区、地毯/茶几后侧、靠墙开阔区或明确会客边界。除非原房间本来就是岛式沙发布局且四周通道充足，否则不要孤立摆在画面中央或前景。
21. 中景/近景通过相机靠近、焦段和裁切实现，不允许把完整大沙发物理放大并拖到前景。
22. 产品参考图的拍摄角度不等于目标房间的摆放角度；可以换相机角度展示同一件沙发，但不能为了照搬产品图构图而复制产品图背景或错误摆放。
23. 绝对禁止结果：原房间电视在左墙，最终图却把电视画到后墙/中间背景墙；原窗帘在右侧或后方，最终图却重构成另一个房间角度。
24. 如果用户只用文字描述，就按文字生成高端家居电商摄影图，构图干净、主体明确、可直接用于商品展示。

${isCloseShot ? `【本次是近景/材质细节 - 额外硬约束】
1. 只允许呈现产品沙发的局部，例如一段扶手、一段坐垫、一段靠背、缝线、材质颗粒和真实接触阴影。
2. 不要生成完整沙发全貌，不要让完整大沙发占满房间前景。
3. 背景可以是模糊的房间局部，但房间构造仍来自房间参考图，沙发物理落点仍在遮罩绿色目标区对应的真实位置。
4. 近景通过相机靠近和裁切实现，不是把沙发拖到镜头前，也不是把沙发尺寸放大。
` : ''}
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

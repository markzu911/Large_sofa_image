import { after } from 'next/server';
import {
  createPlacementGuideFromPlan,
  describePlacementGuideForPrompt,
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
  productIdentity,
  placementGuidePrompt,
}: {
  angle: string;
  height: string;
  lighting: string;
  customPrompt: string;
  placementHint: string;
  shotName: string;
  cameraSpec: string;
  placementPlan: string;
  productIdentity: string;
  placementGuidePrompt: string;
}) {
  const isCloseShot = /近景|特写|细节/.test(shotName);
  return `
你是一位极其严谨的专业家居电商摄影师和空间合成专家。
你的任务是把【产品参考图】中的同一件沙发本体，无缝融入【房间参考图】的真实空间，并生成单张照片级电商图片。

【参考图角色隔离】
1. 【房间参考图】是唯一的房间结构、墙面、窗户、门洞、电视墙/媒体墙、固定柜体、地面、吊顶和光线来源。
2. 【产品参考图】是最高优先级的商品身份来源，只允许用于复刻同一件沙发本体：款式、轮廓、比例、材质、颜色、纹理、结构和细节。
3. 忽略【产品参考图】里的所有背景空间和其他物体，最终画面必须一眼看出仍然是【房间参考图】里的房间。
4. 【房间参考图】里的装饰、文字、商标、画作内容、抱枕图案、临时摆件不能转移到产品沙发上；房间只提供空间、光线和可替换家具关系。

【房间底片锁定 - 最高空间优先级】
1. 把房间参考图当作需要编辑的原始底片，而不是灵感图。最终图必须保留原房间的相机方向、墙面方位、电视所在墙、窗户位置、右侧柜体、梁/吊顶和地面透视关系。
2. 禁止重新拍摄、重新构图或把房间旋转到另一个角度；禁止把左墙电视变成后墙电视、把右侧窗帘变成背景窗、把右侧边柜变成另一面墙。
3. 远景/中景/近景只允许在原房间相机方向基础上做轻微推近、裁切和焦段变化；不能为了产品展示去改变房间视角、墙体关系或电视位置。
4. 如果“拍摄角度自由”和“房间结构不变”冲突，永远优先房间结构不变。

【产品抠取边界 - 必须先执行】
1. 在生成前先把产品参考图做“心理抠图”：只保留沙发本体，其他像素全部当作透明背景。
2. 产品参考图中的茶几、玩偶/公仔、落地灯/弧形灯、吊灯、墙柜/柜体、餐桌、地毯、画作、窗帘、绿植、墙面、文字、水印和界面元素，全部不是产品，也不是可复制的配套物。
3. 最终画面里允许出现的非沙发物件，只能来自房间参考图中原本存在的物件，或为保持房间功能而合理保留/移走/轻微调整的房间原家具。严禁把产品图的非沙发物件搬到目标房间。
4. 产品参考图只锁定同一件沙发的外观，不锁定它在原产品图里的房间位置、茶几关系、灯具关系、柜体背景或拍摄构图。

【产品身份锁定 - 最高优先级】
${productIdentity}

硬性执行：
1. 最终沙发必须是产品参考图里的同一件商品，不是“同风格沙发”、不是“意式沙发概念图”、不是重新设计后的相似款。
2. 只允许为适配房间透视、光线和拍摄角度做摄影级投影变化；不得改变沙发本体的轮廓、结构、模块数量、扶手/靠背/坐垫形态、缝线、扣点、褶皱、材质纹理、颜色和附属物状态。
3. 如果产品图没有抱枕、靠包、毯子、文字、Logo、图案、标签或刺绣，最终产品沙发上也绝对不能出现这些东西；房间原有抱枕/装饰可以被移除或放在非产品区域，但不能套到商品沙发上。
4. 产品图背景中的墙面文字、标题、标签、道具、茶几、玩偶/公仔、灯、柜体、地毯、餐桌、画作和房间装饰不是产品信息，不能复制到最终图。
5. 产品样式必须不变，但产品图拍摄角度可以不是最终角度；允许从合理落位后的正面、侧面、背侧或斜侧拍摄同一件沙发，禁止为了照搬产品图视角而把沙发放到错误位置。

【产品还原】
1. 100% 保留沙发本体的款式、轮廓、座位数量、扶手/靠背结构、坐垫厚度、缝线、扣点/凹陷、褶皱、腿部/底座结构、材质纹理和原本颜色。
2. 不要擅自改款、增减模块、改变比例、简化细节、柔化轮廓、替换材质，或把产品图背景带入最终图。
3. 严禁私自添加产品参考图中没有的任何信息：文字、数字、Logo、商标、品牌名、印章、标签、刺绣、图案、徽章、贴纸、花纹、二维码、水印。
4. 抱枕、靠包、毯子、装饰件只在产品参考图中清晰存在时才允许出现；如果出现，必须保持原样。产品图里没有文字/Logo的抱枕，最终图也必须是纯净无字无Logo的抱枕。不确定时按“没有文字/Logo/图案”处理。
5. 可以移除房间原图中与产品无关的抱枕、临时装饰、文字物件；不要把它们复制到产品沙发或抱枕上。

【房间构造】
1. 锁定房间参考图中的墙体关系、窗户/窗帘、门洞、电视墙/媒体墙、固定柜体、吊顶/梁、地面透视、墙角、光线方向和整体空间比例。
2. 不要重建、翻转、旋转或重新装修房间；不要移动电视墙、窗户、门洞、固定柜体和墙体开口。
3. 可移动家具可以被商品沙发合理替换或轻微调整，但不可移动建筑结构必须保持不变。
4. 不要为了容纳产品图原始背景而新增产品图里的柜墙、灯具、茶几、画作或装饰；目标房间的建筑结构永远以房间参考图为准。
5. 电视墙方位是硬事实：房间图中电视在画面左侧墙时，最终图里电视也必须仍在左侧墙；不能把电视画到画面后方/中间墙，也不能让沙发贴近电视墙或挡住电视。

【原家具处理 - 智能评估】
1. 房间参考图里的原沙发、原座椅、原贵妃位、原休闲椅或会客主座是重要空间线索，不需要无条件替换。先判断“原座位区”是否是产品沙发最合理的落点。
2. 如果原座位区最合理，就用产品沙发替换原沙发/原座椅，保持原来的靠墙关系、主坐面朝向、与茶几/地毯/电视/通道的关系。
3. 如果房间里存在更合理的空位，可以不替换原家具，但产品沙发必须有明确功能位置：靠墙或贴合会客区，朝向电视/茶几/会客中心，不挡窗、门、通道、电视、固定柜体，也不能让空间变拥挤。
4. 禁止把产品沙发随意新增到原沙发前方、房间中央、窗前、通道或只为了近景而靠近镜头的位置。保留原家具时，它必须与产品沙发形成合理的组合关系，而不是双主沙发冲突。

【合理落位判定】
1. 先按室内设计逻辑选择落点，再按落点选择相机；不能先为了电商正面图把沙发放大居中，再反推房间。
2. 大沙发优先落在稳定家具区：原座位区、电视对侧观看区、地毯/茶几后侧、靠墙开阔区或明确会客边界。除非原房间本来就是岛式沙发布局且四周通道充足，否则不要孤立摆在画面中央或前景。
3. 沙发主坐面必须朝向电视/茶几/会客中心。相机可以从正面、侧面、背侧或斜侧拍，但“拍摄角度”不能改变沙发的物理坐向；不要为了看到沙发正面而让沙发背离电视/茶几或面对镜头。
4. 产品沙发必须按房间透视和真实家具尺寸缩放。中景/近景通过相机靠近、焦段和裁切实现，不允许把完整大沙发物理放大并拖到前景。
5. 如果产品图里沙发旁边有茶几、灯、柜体、墙面或玩偶，不要用这些物件来决定目标房间的摆放位置；落位只服从房间参考图里的电视、茶几/地毯、原座位区、窗户、门洞、通道和真实地面。

【电视墙几何硬约束】
1. 如果电视/媒体墙在画面左侧墙：电视所在左侧 58% 区域、电视下方、电视旁边同墙贴墙区全部禁放；产品沙发主体和主要体量必须避开 X<58% 的电视同侧区，优先落在画面右半部/右下/中下观看区，主坐面朝左/左上看电视。
2. 如果电视/媒体墙在画面右侧墙：电视所在右侧 58% 区域、电视下方、电视旁边同墙贴墙区全部禁放；产品沙发主体和主要体量必须避开 X>42% 的电视同侧区，优先落在画面左半部/左下/中下观看区，主坐面朝右/右上看电视。
3. 如果电视/媒体墙在画面后墙/上方背景墙：电视下方和后墙同侧贴墙区禁放；产品沙发中心应落在画面下方前景观看区，主坐面朝后墙/上方看电视。
4. 只要沙发背靠或贴近电视所在墙、位于电视下方、位于电视旁边同墙贴墙区、主坐面没有朝向电视、或把电视所在墙方位改了，都属于错误结果。不要生成这种画面。

【当前生成设置】
- 景别类型: ${shotName}
- 景别镜头策略: ${cameraSpec}
- 角度策略: ${angle}
- 机位高度策略: ${height}
- 环境光线: ${lighting}
- 落位参考: ${placementHint}
${customPrompt ? `- 附加描述: ${customPrompt}` : ''}

【本次房间落位方案 - 必须优先执行】
${placementPlan}

${placementGuidePrompt}

【自动落位遮罩图规则】
如果输入中包含【自动落位遮罩图】，它是内部空间坐标辅助图，不是最终画面内容。
1. 红色区域是禁放区，产品沙发主体、底座、靠背、扶手和坐垫都不能进入红色区域。
2. 绿色区域是产品沙发主体的目标落位区，沙发中心和主要体量必须落在绿色区域内。
3. 绿色箭头表示沙发主坐面/开口侧应朝向的方向。
4. 不要在最终图里渲染遮罩的颜色、箭头、边框或任何辅助图痕迹。
${isCloseShot ? '5. 当前是近景/细节图：遮罩表示未裁切房间里的物理落点，不是要求把完整沙发塞进最终画面；最终画面应该是从这个正确落点靠近后裁切出来的局部。' : ''}

【执行顺序 - 不可跳过】
1. 先在产品图中只抠取沙发本体，明确非沙发物件全部丢弃。
2. 再读取并执行“唯一锁定落点”：沙发中心区域、底部接触地面、主坐面朝向和禁入边界都以该方案为准。
3. 锁定房间底片：保持原房间相机方向和墙体方位，尤其电视所在墙不能变化。
4. 如果房间参考图里已有沙发/座椅，先判断原座位区是否是最合理落点。若是，产品沙发替换原座位；若不是，可选择更合理空位，但必须说明并遵守真实会客关系、朝向、离茶几/电视/墙面的距离和通行动线。
5. 再选择当前景别对应的相机机位：${shotName}。只允许在原房间视角上推近、裁切、微调焦段、机位高度和景深；不能切换到新的房间相机方向，也不能把左墙电视拍成后墙电视。
6. 最后融合产品沙发本体。不要为了画面居中、商品正面角度、近景放大或构图美观，把沙发重新放到原座位前方、窗前、房间中央、门洞、通道、电视所在墙同侧、电视下方、电视旁边贴墙区或固定柜体前。
7. 如果窗前是主要采光面或落地窗/窗帘区域，窗前空地不是默认沙发区；除非落位方案明确允许，否则必须保留采光和通行。
8. 如果房间有电视/媒体墙，沙发必须落在电视对侧或斜对侧的观看区，主坐面朝向电视/媒体墙；禁止把沙发放在电视所在墙、电视下方、电视旁边同墙贴墙区或与电视同侧贴墙。
9. 如果电视/媒体墙在画面左侧墙，沙发必须避开左侧 58% 电视墙禁放区，优先落在画面右半部或右下/中下开阔地并朝左；如果电视/媒体墙在画面右侧墙，沙发必须避开右侧 58% 电视墙禁放区，优先落在画面左半部或左下/中下开阔地并朝右；如果电视/媒体墙在后墙，沙发必须避开后墙电视下方，优先落在画面下方前景可用地面并朝后墙。
10. 绝对禁止结果：产品沙发被随意放在前景/房间中央/原沙发前方，导致挡通道、挡视线、和原家具拥挤冲突。保留原家具本身不是错误，错误是产品沙发没有合理功能位置。
11. 绝对禁止结果：为了电商主图把沙发实际坐向转成朝镜头，导致它没有面向电视/茶几/会客中心。镜头可以动，沙发坐向不能为了镜头乱转。
12. 绝对禁止结果：电视在左墙却把沙发放在左墙电视旁/电视下方/电视同侧，电视在右墙却把沙发放在右墙电视旁/电视下方/电视同侧，或电视在后墙却把沙发贴在电视下方。
13. 绝对禁止结果：原房间电视在左墙，最终图却把电视画到后墙/中间背景墙；原窗帘在右侧或后方，最终图却重构成另一个房间角度。
14. 绝对禁止结果：把产品图中的茶几、玩偶/公仔、灯、柜体、画作、地毯、餐桌、窗帘或背景墙复制到目标房间，或让它们影响目标房间落位。

【当前景别强制规则】
- 远景：产品沙发仍在唯一锁定落点，相机后退，展示完整房间结构；沙发占比小，不能把沙发移动到窗前或画面中心来凑全景。
- 中景：产品沙发仍在唯一锁定落点，相机靠近到电商主图距离；能看到底部接触线、地面透视和一部分真实背景，不能在原沙发前方随意新增一张，不能为了正面展示改变物理坐向。
- 近景：产品沙发仍在唯一锁定落点，相机靠近拍扶手/坐垫/靠背/缝线/材质，必须自然裁切局部；最终画面不能出现完整沙发全貌，不能把完整沙发整体巨大化，也不能重新选择窗前、通道、房间中央或旧沙发前方作为背景。如果能看见完整沙发轮廓并占据前景，就是错误近景。

${isCloseShot ? `【本次是近景/材质细节 - 额外硬约束】
1. 只允许呈现产品沙发的局部，例如一段扶手、一段坐垫、一段靠背、缝线、材质颗粒和真实接触阴影。
2. 不要生成完整沙发全貌，不要让完整大沙发占满房间前景。
3. 背景可以是模糊的房间局部，但房间构造仍来自房间参考图，沙发物理落点仍在遮罩绿色目标区对应的真实位置。
4. 近景通过相机靠近和裁切实现，不是把沙发拖到镜头前，也不是把沙发尺寸放大。
` : ''}

【景别与机位】
1. 远景/中景/近景共用同一个物理落位；差异来自原房间视角上的推近、裁切、焦段和景深，而不是沙发换位置、换大小贴图或房间换相机方向。
2. 摄影机可以轻微从正面、侧面、背侧或斜侧表达产品，但不能改变房间参考图的墙体方位和电视位置；相机角度与沙发主坐面朝向分开处理，不能用相机正面需求改变沙发坐向。
3. 沙发必须按房间透视缩放，底座/脚部贴合地面，并有真实接触阴影和投射阴影。
4. 如果产品图角度与房间最合理落位冲突，保持房间落位正确，但仍要复刻同一件沙发的真实结构；只改变可拍摄角度，不改变产品样式。

【画面质量】
照片级真实摄影，高端电商主图质感，光影、比例、透视、地面接触关系真实；不要出现任何新增文字、水印、品牌 LOGO、商标、标签、刺绣、图案、人物、拼图、分屏、漫画或插画风格。

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
      height = '自适应机位高度',
      lighting = '柔和自然光',
      aspectRatio = '4:3',
      imageSize = '1K',
      customPrompt = '',
      shotName = '中景：电商主图',
      cameraSpec = '自适应景别镜头，正面/侧面/背侧/斜侧均可',
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
    const placementHint = '不使用任何前端预览坐标或默认锚点；必须完全根据房间参考图自动识别最合理座位区。如果原房间已有沙发/座椅，先评估原座位区是否最合理：最合理则替换原座位区；如果有更合理空位，可以不替换，但必须保持真实会客关系、朝向和动线；有电视/媒体墙时必须在电视对侧或斜对侧，禁止电视同侧贴墙、电视下方和电视旁同墙区域。电视在画面左墙则沙发中心去右半区并朝左，电视在右墙则去左半区并朝右，电视在后墙则去下方观看区并朝后墙。';
    let productIdentity = '未单独返回商品身份分析；最终仍必须把产品参考图作为最高优先级，100% 保持同一件沙发的轮廓、结构、模块数量、扶手/靠背/坐垫形态、缝线、扣点、褶皱、材质纹理、颜色和附属物状态；禁止新增产品图没有的抱枕、文字、Logo、图案、标签或装饰。';
    try {
      productIdentity = await generateProductIdentityWithGemini({
        productData: productData.data,
        productMimeType: productData.mimeType,
      });
      console.info('Generated product identity:', productIdentity.slice(0, 800));
    } catch (identityErr: any) {
      console.warn('Product identity analysis failed, falling back to built-in product guard:', identityErr.message || identityErr);
    }

    let placementPlan = '空间落位分析未单独返回；请按房间参考图中的真实地面、原座位区、会客区、窗户、门洞、固定柜体、电视/媒体墙和主要通道，选择最稳定且不挡光不挡路的可摆放区域；如果已有原沙发/座椅，先评估原座位区是否最合理，最合理则替换，不是最合理则选择更合理空位并保证不拥挤不挡路；有电视/媒体墙时必须在电视对侧或斜对侧，不能在电视所在墙同侧、电视下方或电视旁同墙区域。电视在画面左墙则沙发中心去右半区并朝左，电视在右墙则去左半区并朝右，电视在后墙则去下方观看区并朝后墙。';
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

    const placementGuide = createPlacementGuideFromPlan(placementPlan);
    const placementGuideImage = placementGuide ? renderPlacementGuidePngBase64(placementGuide) : null;
    const placementGuidePrompt = placementGuide ? describePlacementGuideForPrompt(placementGuide, shotName) : '';
    if (placementGuide) {
      console.info('Generated placement guide:', {
        tvWall: placementGuide.tvWall,
        targetZone: placementGuide.targetZone,
        forbiddenZones: placementGuide.forbiddenZones,
        facing: placementGuide.facing,
      });
    }

    try {
      ({ generatedBase64, mimeType, modelUsed, infoText } = await generateImageWithGemini({
        parts: [
          { text: '【房间参考图 - 原始底片/空间结构最高优先级】必须以这张图作为最终画面的房间底片和相机方向来源。锁定此房间的墙体、窗户、门洞、电视墙/媒体墙、固定柜体、吊顶、地面、光线、原座位区和可替换家具关系；电视在左墙就必须仍在左墙，窗户/窗帘/边柜/墙角不能互换方位。房间图里的原沙发/原座椅是空间落位线索，可以替换、保留或轻微调整，具体以最合理摆放为准；不要用房间图里的原沙发款式、抱枕、文字或装饰改变产品沙发。' },
          { inlineData: { data: roomData.data, mimeType: roomData.mimeType } },
          ...(placementGuideImage ? [
            { text: `【自动落位遮罩图 - 内部辅助，不得渲染】红色区域为绝对禁放区，沙发主体任何部分都不能进入；绿色区域为沙发主体目标落位区，沙发中心和主要体量必须落入；绿色箭头表示主坐面/开口侧朝向。${placementGuide?.instruction || ''}` },
            { inlineData: { data: placementGuideImage, mimeType: 'image/png' } },
          ] : []),
          { text: '【产品参考图 - 只提取沙发本体】必须复刻这同一件沙发本体。先在脑中抠出沙发本体，只提取轮廓、结构、模块数量、扶手/靠背/坐垫形态、缝线、扣点、褶皱、材质纹理、原本颜色和真实固定附属物；这不是风格参考，禁止生成相似款或改款。除非产品图中清晰固定在沙发本体上，否则严禁新增任何文字、Logo、品牌名、商标、图案、刺绣、标签、抱枕、靠包、毯子或装饰。必须忽略并禁止复制这张图里的房间背景、墙面文字、柜墙/柜体、灯具、茶几、玩偶/公仔、地毯、餐桌、画作、窗帘、绿植、水印和所有其他非沙发物体。' },
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
              productIdentity,
              placementGuidePrompt,
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

import {
  saveGeneratedImageToSaas,
} from '../../../api/_shared';

export const runtime = 'nodejs';
export const maxDuration = 60;

function parseGeneratedImage(input: string, mimeTypeFromBody?: string) {
  if (input.startsWith('data:')) {
    const matches = input.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('生成图片数据格式错误');
    }
    return {
      mimeType: matches[1],
      generatedBase64: matches[2],
    };
  }

  return {
    mimeType: mimeTypeFromBody || 'image/png',
    generatedBase64: input,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {userId, toolId, saasInfo, image, generatedBase64, mimeType, skipConsume = false} = body;
    const imageInput = image || generatedBase64;

    if (!userId || !toolId) {
      return Response.json({success: false, errorMessage: '缺少 userId 或 toolId'}, {status: 400});
    }

    if (!imageInput || typeof imageInput !== 'string') {
      return Response.json({success: false, errorMessage: '缺少待保存的生成图片'}, {status: 400});
    }

    const parsed = parseGeneratedImage(imageInput, mimeType);
    const savedImage = await saveGeneratedImageToSaas({
      userId,
      toolId,
      generatedBase64: parsed.generatedBase64,
      mimeType: parsed.mimeType,
      saasInfo,
      skipConsume: Boolean(skipConsume),
    });

    return Response.json({
      success: true,
      savedToSaas: true,
      ...savedImage,
    });
  } catch (err: any) {
    console.error('SaaS save-result route failed:', {
      saveStep: err.saveStep,
      message: err.message,
    });
    return Response.json({
      success: false,
      savedToSaas: false,
      saveStep: err.saveStep,
      errorMessage: err.message || 'SaaS保存失败',
    }, {status: 502});
  }
}

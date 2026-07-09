import { launchTool } from '../../../../api/_shared';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { userId, toolId } = await req.json();

    if (!userId || !toolId) {
      return Response.json({
        success: true,
        data: {
          user: {
            id: 'mock_user_123',
            name: '试用体验账号',
            enterprise: '系统演示环境',
            integral: 999,
            role: 1,
          },
          tool: {
            id: 'mock_tool_456',
            name: '沙发智能空间生图系统',
            integral: 10,
            status: 'active',
          },
        },
      });
    }

    const data = await launchTool(userId, toolId);
    return Response.json(data);
  } catch (err: any) {
    return Response.json({
      success: true,
      data: {
        user: {
          id: 'mock_user_123',
          name: '预览调试用户',
          enterprise: '系统演示环境',
          integral: 500,
          role: 1,
        },
        tool: {
          id: 'mock_tool_456',
          name: '沙发智能空间生图系统',
          integral: 10,
          status: 'active',
        },
      },
      warning: err.message || 'SaaS launch failed, using preview fallback',
    });
  }
}

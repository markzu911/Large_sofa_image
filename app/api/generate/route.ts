import { POST as generateSofaPost } from '../generate-sofa/route';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  return generateSofaPost(req);
}

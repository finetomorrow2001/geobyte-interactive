import { serveCogRange } from '$lib/server/cog-range';
import type { RequestHandler } from './$types';

export const config = { runtime: 'nodejs22.x', regions: ['sfo1'], maxDuration: 30 };
export const GET: RequestHandler = ({ params }) => serveCogRange(params.key);

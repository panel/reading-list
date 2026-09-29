import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// The feeds inbox is now the home page (Slice 10); keep old links and filters working.
export const GET: RequestHandler = ({ url }) => redirect(308, `/${url.search}`);

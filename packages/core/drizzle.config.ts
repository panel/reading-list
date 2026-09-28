import { defineConfig } from 'drizzle-kit';

// Only used to generate SQL migrations from the schema. Migrations are applied
// with `wrangler d1 migrations apply` (see apps/web/package.json), never pushed.
export default defineConfig({
	schema: './src/db/schema.ts',
	out: '../../migrations',
	dialect: 'sqlite',
	strict: true
});

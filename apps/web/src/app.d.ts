// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Db, User } from '@reading-list/core/db';

declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		interface Locals {
			db: Db;
			user: User;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};

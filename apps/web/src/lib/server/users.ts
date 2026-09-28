import { eq } from 'drizzle-orm';
import { users, type Db, type User } from '@reading-list/core/db';

/** Returns the user for this email, creating it on first sign-in. */
export async function findOrCreateUser(db: Db, email: string): Promise<User> {
	const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
	if (existing) return existing;

	// onConflictDoNothing covers two first requests racing each other.
	await db.insert(users).values({ email }).onConflictDoNothing();
	const created = await db.query.users.findFirst({ where: eq(users.email, email) });
	if (!created) throw new Error(`Could not create user ${email}`);
	return created;
}

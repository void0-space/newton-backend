import { db } from './src/db/drizzle';
import { organization } from './src/db/schema/auth';

async function getOrganizationId() {
  try {
    const orgs = await db.select().from(organization).limit(1);
    if (orgs.length > 0) {
      console.log('Organization ID:', orgs[0].id);
      console.log('Organization Name:', orgs[0].name);
      return orgs[0].id;
    } else {
      console.log('No organizations found');
      return null;
    }
  } catch (error) {
    console.error('Error getting organization:', error);
    return null;
  }
}

getOrganizationId().then(() => process.exit(0));
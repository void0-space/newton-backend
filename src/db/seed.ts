import { db } from './drizzle';
import { user, organization, member } from './schema';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';

async function seed() {
  console.log('🌱 Seeding database...');

  try {
    // Create admin user
    const hashedPassword = await bcrypt.hash('admin123', 10);

    const [adminUser] = await db
      .insert(user)
      .values({
        id: createId(),
        name: 'Admin User',
        email: 'admin@whatsapp-api.com',
        emailVerified: true,
      })
      .returning();

    console.log(`✅ Created admin user: ${adminUser.email}`);

    // Create default organization
    const [defaultOrg] = await db
      .insert(organization)
      .values({
        id: createId(),
        name: 'Default Organization',
        slug: 'default',
        createdAt: new Date(),
      })
      .returning();

    console.log(`✅ Created default organization: ${defaultOrg.name}`);

    // Add admin user to organization as admin
    await db.insert(member).values({
      id: createId(),
      organizationId: defaultOrg.id,
      userId: adminUser.id,
      role: 'admin',
      createdAt: new Date(),
    });

    console.log(`✅ Added admin user to organization`);

    console.log('🎉 Database seeding completed successfully!');
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

seed()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

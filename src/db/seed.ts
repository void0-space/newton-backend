import { db } from './drizzle';
import { user, organization, member, plan } from './schema';
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

    // Create default pricing plans
    const plans = [
      {
        id: createId(),
        name: 'Starter',
        description: 'Perfect for small businesses getting started',
        monthlyPrice: '999.00',
        includedMessages: 1000,
        maxSessions: 1,
        features: ['1 WhatsApp Session', '1,000 messages/month', 'Basic support'],
      },
      {
        id: createId(),
        name: 'Professional',
        description: 'For growing businesses with higher volume needs',
        monthlyPrice: '2999.00',
        includedMessages: 5000,
        maxSessions: 3,
        features: ['3 WhatsApp Sessions', '5,000 messages/month', 'Priority support', 'Webhooks'],
      },
      {
        id: createId(),
        name: 'Enterprise',
        description: 'For large-scale operations',
        monthlyPrice: '9999.00',
        includedMessages: 25000,
        maxSessions: 10,
        features: [
          '10 WhatsApp Sessions',
          '25,000 messages/month',
          '24/7 support',
          'Webhooks',
          'Custom integrations',
        ],
      },
    ];

    for (const planData of plans) {
      await db.insert(plan).values(planData);
      console.log(`✅ Created plan: ${planData.name}`);
    }

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

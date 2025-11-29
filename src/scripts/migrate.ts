/**
 * Migration wrapper script that ensures process exits after migrations complete
 * This prevents Railway deployments from hanging on the db:migrate step
 */

import { spawn } from 'child_process';

const migrate = spawn('drizzle-kit', ['migrate', '--config', 'drizzle.config.ts'], {
  stdio: 'inherit',
  shell: true,
});

migrate.on('exit', (code) => {
  console.log(`\nMigrations completed with exit code: ${code}`);
  process.exit(code || 0);
});

migrate.on('error', (error) => {
  console.error('Migration error:', error);
  process.exit(1);
});

// Ensure process exits even if migration hangs
setTimeout(() => {
  console.error('Migration timeout - forcing exit');
  process.exit(1);
}, 5 * 60 * 1000); // 5 minute timeout

const { spawn } = require('child_process');

const migrate = spawn('drizzle-kit', ['migrate', '--config', 'drizzle.config.ts'], {
  stdio: 'inherit',
  shell: true,
});

migrate.on('exit', (code) => {
  process.exit(code || 0);
});

migrate.on('error', () => {
  process.exit(1);
});

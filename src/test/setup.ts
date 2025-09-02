import { beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';

beforeAll(() => {
  dotenv.config({ path: '.env.test' });
  process.env.NODE_ENV = 'test';
});

afterAll(() => {
  // Cleanup logic if needed
});
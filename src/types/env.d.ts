declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: string;
    DATABASE_URL: string;
    REDIS_URL: string;
    JWT_SECRET: string;
    ENCRYPTION_KEY: string;
    S3_ENDPOINT?: string;
    S3_BUCKET?: string;
    S3_REGION?: string;
    S3_ACCESS_KEY?: string;
    S3_SECRET_KEY?: string;
    S3_PUBLIC_URL?: string;
    RZP_KEY_ID?: string;
    RZP_KEY_SECRET?: string;
    RZP_WEBHOOK_SECRET?: string;
    WEBHOOK_URL?: string;
    API_PORT?: string;
    [key: string]: string | undefined;
  }
}

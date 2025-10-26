# WhatsApp API Backend

Multi-tenant WhatsApp API service backend built with Fastify, TypeScript, and better-auth.

## Features

- Multi-tenant architecture with organization-based isolation
- WhatsApp integration using Baileys
- API key management and authentication
- Message persistence and media handling
- Rate limiting and quota management
- Comprehensive testing and monitoring

## Tech Stack

- **Framework**: Fastify + TypeScript
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: better-auth with organization, admin, and API key plugins
- **Cache**: Redis
- **Storage**: AWS S3 compatible (MinIO for development)
- **Payments**: Polar.sh with better-auth integration
- **Testing**: Vitest
- **Monitoring**: Sentry, Prometheus metrics

## Development Setup

### Prerequisites

- Node.js 18+
- Docker and Docker Compose
- pnpm

### Getting Started

1. Clone the repository:
```bash
git clone <repo-url>
cd backend
```

2. Install dependencies:
```bash
pnpm install
```

3. Copy environment variables:
```bash
cp .env.example .env
```

4. Start development services:
```bash
docker-compose up -d
```

5. Run database migrations:
```bash
pnpm run db:migrate
```

6. Start the development server:
```bash
pnpm run dev
```

The server will start on http://localhost:4000

### Available Scripts

- `pnpm run dev` - Start development server with hot reload
- `pnpm run build` - Build for production
- `pnpm run start` - Start production server
- `pnpm run test` - Run tests
- `pnpm run test:coverage` - Run tests with coverage
- `pnpm run lint` - Run ESLint
- `pnpm run format` - Format code with Prettier
- `pnpm run db:generate` - Generate database migrations
- `pnpm run db:migrate` - Run database migrations
- `pnpm run db:studio` - Open Drizzle Studio

### Testing

Run the test suite:
```bash
pnpm run test
```

Run tests with coverage:
```bash
pnpm run test:coverage
```

### Database

This project uses Drizzle ORM with PostgreSQL. Database schema is defined in `src/db/schema/`.

To generate migrations after schema changes:
```bash
pnpm run db:generate
```

To apply migrations:
```bash
pnpm run db:migrate
```

### Docker

Build the Docker image:
```bash
docker build -t whatsapp-api-backend .
```

Run with Docker Compose (includes PostgreSQL and Redis):
```bash
docker-compose up
```

## API Endpoints

### Health & Status
- `GET /health` - Health check endpoint
- `GET /api/v1/status` - Service status information

### Authentication & Organizations
- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/organizations` - Create organization
- `GET /api/v1/organizations/:id` - Get organization details

### WhatsApp Sessions
- `POST /api/v1/whatsapp/sessions` - Create WhatsApp session
- `GET /api/v1/whatsapp/sessions/:id` - Get session status
- `DELETE /api/v1/whatsapp/sessions/:id` - Disconnect session

### Messaging
- `POST /api/v1/messages/send` - Send message
- `GET /api/v1/messages/:id` - Get message status
- `POST /api/v1/media/upload` - Upload media

### API Keys
- `POST /api/v1/api-keys` - Create API key
- `GET /api/v1/api-keys` - List API keys
- `DELETE /api/v1/api-keys/:id` - Revoke API key

### Webhooks
- `GET /api/v1/webhooks` - List all webhooks
- `POST /api/v1/webhooks` - Create webhook
- `GET /api/v1/webhooks/:id` - Get webhook details
- `PUT /api/v1/webhooks/:id` - Update webhook
- `DELETE /api/v1/webhooks/:id` - Delete webhook
- `POST /api/v1/webhooks/:id/test` - Test webhook
- `GET /api/v1/webhooks/:id/deliveries` - Get webhook delivery history
- `GET /api/v1/webhooks/events` - List available events

For detailed webhook documentation, see [Webhook Documentation](../docs/api/webhooks.md)

## Environment Variables

See `.env.example` for all required environment variables.

Key variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `BETTER_AUTH_SECRET` - Secret for better-auth
- `ENCRYPTION_KEY` - Key for encrypting sensitive data
- `POLAR_ACCESS_TOKEN` - Polar.sh organization access token
- `POLAR_WEBHOOK_SECRET` - Polar webhook secret for verification
- `POLAR_ENVIRONMENT` - 'sandbox' for development, 'production' for live

## Security

- All sensitive data is encrypted at rest
- API keys are hashed before storage
- Rate limiting is enforced per tenant and API key
- Input validation using Zod schemas
- HTTPS required in production

## Monitoring

- Health check endpoint at `/health`
- Metrics endpoint at `/metrics` (Prometheus format)
- Structured logging with Fastify's built-in logger
- Error tracking with Sentry

## License

Private - All rights reserved
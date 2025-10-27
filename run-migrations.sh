#!/bin/bash

echo "Waiting for database to be ready..."
sleep 10

echo "Running database migrations..."
docker-compose exec backend pnpm run db:migrate

echo "Migrations complete!"
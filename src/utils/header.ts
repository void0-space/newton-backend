import { FastifyRequest } from 'fastify';

export const convertHeaders = (request: FastifyRequest): Headers => {
  const headers = new Headers();
  Object.entries(request.headers).forEach(([key, value]) => {
    if (value) headers.append(key, value.toString());
  });
  return headers;
};

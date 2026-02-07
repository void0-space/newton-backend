import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

const jobIdSchema = z.object({
  jobId: z.string(),
});

export async function getMessageJobStatus(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { jobId } = jobIdSchema.parse(request.params);

    const jobStatus = await request.server.messageQueue.getJobStatus(jobId);

    if (!jobStatus) {
      return reply.status(404).send({
        error: 'Job not found',
        code: 'JOB_NOT_FOUND',
      });
    }

    return reply.send({
      success: true,
      job: {
        id: jobStatus.id,
        state: jobStatus.state,
        progress: jobStatus.progress,
        result: jobStatus.result,
        error: jobStatus.error,
        attemptsMade: jobStatus.attemptsMade,
        processedOn: jobStatus.processedOn,
        finishedOn: jobStatus.finishedOn,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Invalid request data',
        details: error.errors,
        code: 'VALIDATION_ERROR',
      });
    }

    request.log.error('Error getting job status:', error);
    return reply.status(500).send({
      error: 'Failed to get job status',
      code: 'JOB_STATUS_ERROR',
    });
  }
}
